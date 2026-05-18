"""插件专用卡密 API —— 精简版。

与原 /seatpool/app/api/plugin_card_keys.py 行为对齐：
- 请求体、响应字段、错误文案、reason_code 完全一致
- 删除跨站权威转发（PLUGIN_REMOTE_ENABLED / _forward_plugin_request_if_needed / _fetch_authoritative_plugin_card）
- 删除 UnifiedActivationService 的依赖，本地 DB 即权威
"""
import math
import re

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError

from ..models import (
    db,
    CardKey,
    CardKeyStatus,
    PluginCardBinding,
    PluginCardBindingStatus,
    PluginCardRebindLog,
    SiteConfig,
)
from ..utils.rate_limit import is_rate_limited
from ..utils.timezone import as_china_naive, now as china_now


bp = Blueprint("plugin_card_keys", __name__, url_prefix="/api/plugin/card-keys")


PLUGIN_AUTH_FAILURE_MESSAGE = "插件授权校验未通过"
PLUGIN_DEVICE_MISMATCH_MESSAGE = "该卡密已绑定其他设备，请点击换绑设备"
PLUGIN_NOT_ACTIVATED_MESSAGE = "插件尚未激活，请先点击验证激活"

_EMAIL_PATTERN = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _validate_email(email: str) -> bool:
    return bool(_EMAIL_PATTERN.match(email or ""))


def _get_client_ip() -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return (request.remote_addr or "").strip()


def _is_rate_limited(card_key: str, email: str) -> bool:
    window = int(current_app.config.get("PLUGIN_RATE_LIMIT_WINDOW_SECONDS", 60))
    limit = int(current_app.config.get("PLUGIN_RATE_LIMIT_MAX_REQUESTS", 20))
    identifiers = [
        _get_client_ip(),
        str(card_key or "").strip(),
        str(email or "").strip().lower(),
    ]
    for identifier in identifiers:
        if not identifier:
            continue
        if is_rate_limited(f"plugin_card:{identifier}", limit=limit, window_seconds=window):
            return True
    return False


def _normalize_effective_datetime(value):
    return as_china_naive(value)


def _build_data(authorized: bool, card: CardKey | None = None) -> dict:
    card_type = None
    status = None
    expires_at = None
    remaining_days = None
    remaining_hours = None

    if card:
        card_type = card.card_type
        status = card.status
        normalized_expires_at = _normalize_effective_datetime(card.expires_at)
        if normalized_expires_at:
            expires_at = normalized_expires_at.isoformat()
            diff = normalized_expires_at - china_now()
            remaining_days = max(0, math.ceil(diff.total_seconds() / 86400))
            remaining_hours = max(0, math.ceil(diff.total_seconds() / 3600))

    return {
        "authorized": authorized,
        "card_type": card_type,
        "status": status,
        "expires_at": expires_at,
        "remaining_days": remaining_days,
        "remaining_hours": remaining_hours,
    }


def _response(success: bool, message: str, authorized: bool, card: CardKey | None = None, extra_data: dict | None = None):
    data = _build_data(authorized=authorized, card=card)
    if isinstance(extra_data, dict) and extra_data:
        data.update(extra_data)
    return jsonify({"success": success, "message": message, "data": data})


def _masked_auth_failure(card: CardKey | None = None, extra_data: dict | None = None):
    return _response(False, PLUGIN_AUTH_FAILURE_MESSAGE, False, card, extra_data=extra_data)


def _actionable_auth_failure(reason: str, card: CardKey | None = None, extra_data: dict | None = None):
    normalized = str(reason or "").strip()
    payload = dict(extra_data or {})

    if normalized == "设备不匹配":
        payload.update({"reason_code": "device_mismatch", "can_rebind": True})
        return _response(False, PLUGIN_DEVICE_MISMATCH_MESSAGE, False, card, extra_data=payload)
    if normalized in {"插件绑定不存在，请先激活", "插件尚未激活，请先调用 activate"}:
        payload.update({"reason_code": "binding_missing", "can_rebind": False})
        return _response(False, PLUGIN_NOT_ACTIVATED_MESSAGE, False, card, extra_data=payload)
    if normalized == "卡密不存在":
        payload.update({"reason_code": "card_not_found", "can_rebind": False})
        return _response(False, "卡密不存在", False, card, extra_data=payload)
    if normalized == "卡密尚未激活":
        payload.update({"reason_code": "card_not_activated", "can_rebind": False})
        return _response(False, "卡密尚未激活", False, card, extra_data=payload)
    if normalized == "卡密已过期":
        payload.update({"reason_code": "card_expired", "can_rebind": False})
        return _response(False, "卡密已过期", False, card, extra_data=payload)
    if normalized == "卡密已被禁用":
        payload.update({"reason_code": "card_disabled", "can_rebind": False})
        return _response(False, "卡密已被禁用", False, card, extra_data=payload)
    if normalized == "插件绑定状态不可用":
        payload.update({"reason_code": "binding_inactive", "can_rebind": False})
        return _response(False, "插件绑定状态不可用，请重新验证激活", False, card, extra_data=payload)

    return _masked_auth_failure(card, extra_data=payload)


def _build_effective_card_data(card: CardKey | None) -> dict:
    if card is None:
        return {
            "card_type": None,
            "status": None,
            "expires_at": None,
            "remaining_days": None,
            "remaining_hours": None,
        }
    effective_expires_at = _normalize_effective_datetime(card.expires_at)
    remaining_days = None
    remaining_hours = None
    if effective_expires_at:
        diff = effective_expires_at - china_now()
        remaining_days = max(0, math.ceil(diff.total_seconds() / 86400))
        remaining_hours = max(0, math.ceil(diff.total_seconds() / 3600))
    return {
        "card_type": str(card.card_type or "").strip() or None,
        "status": str(card.status or "").strip() or None,
        "expires_at": effective_expires_at.isoformat() if effective_expires_at else None,
        "remaining_days": remaining_days,
        "remaining_hours": remaining_hours,
    }


def _build_plugin_client_config_response() -> dict:
    announcement_md = SiteConfig.get(SiteConfig.KEY_PLUGIN_ANNOUNCEMENT_MD, "") or ""
    upgrade_url = SiteConfig.get(SiteConfig.KEY_PLUGIN_UPGRADE_URL, "") or ""

    related_rows = SiteConfig.query.filter(
        SiteConfig.key.in_([
            SiteConfig.KEY_PLUGIN_ANNOUNCEMENT_MD,
            SiteConfig.KEY_PLUGIN_UPGRADE_URL,
        ])
    ).all()
    updated_candidates = [row.updated_at for row in related_rows if getattr(row, "updated_at", None)]
    updated_at = (max(updated_candidates) if updated_candidates else china_now()).isoformat()

    data = {
        "plugin_announcement_md": announcement_md,
        "plugin_upgrade_url": upgrade_url,
        "updated_at": updated_at,
    }
    return {
        "success": True,
        "action": "pluginGetClientConfig",
        "message": "ok",
        "data": data,
        "plugin_announcement_md": announcement_md,
        "plugin_upgrade_url": upgrade_url,
        "updated_at": updated_at,
    }


def _parse_payload():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return None, None, None, _response(False, "请求体不能为空", False, None)

    card_key = (data.get("card_key") or "").strip()
    email = (data.get("email") or "").strip().lower()
    client_id = (data.get("client_id") or "").strip()

    if not card_key:
        return None, None, None, _response(False, "请输入卡密", False, None)
    if not email:
        return None, None, None, _response(False, "请输入邮箱", False, None)
    if not client_id:
        return None, None, None, _response(False, "请输入 client_id", False, None)
    if not _validate_email(email):
        return None, None, None, _response(False, "邮箱格式不正确", False, None)

    if _is_rate_limited(card_key, email):
        return None, None, None, (_response(False, "请求过于频繁，请稍后再试", False, None), 429)

    return card_key, email, client_id, None


def _validate_card_for_plugin(card_key: str, email: str):
    card = CardKey.query.filter_by(key=card_key).first()
    if not card:
        return False, "卡密不存在", None, None

    effective_card_data = _build_effective_card_data(card)

    effective_status = str(card.status or "").strip()
    if effective_status == CardKeyStatus.DISABLED:
        return False, "卡密已被禁用", card, effective_card_data

    effective_expires_at = _normalize_effective_datetime(card.expires_at)
    if not effective_expires_at:
        return False, "卡密尚未激活", card, effective_card_data

    if effective_expires_at <= china_now():
        return False, "卡密已过期", card, effective_card_data

    # 必须是已绑定会员卡密，且邮箱与绑定会员一致
    if not card.member_id or not card.member:
        return False, "卡密未绑定会员，无法用于插件授权", card, effective_card_data

    if (card.member.email or "").strip().lower() != email:
        return False, "邮箱与卡密绑定会员不匹配", card, effective_card_data

    return True, "", card, effective_card_data


def _validate_binding_for_auth(binding: PluginCardBinding | None, email: str, client_id: str):
    if not binding:
        return False, "插件绑定不存在，请先激活"

    if binding.status != PluginCardBindingStatus.ACTIVE:
        return False, "插件绑定状态不可用"

    if (binding.email or "").strip().lower() != email:
        return False, "邮箱与插件绑定不匹配"

    if binding.client_id != client_id:
        return False, "设备不匹配"

    return True, ""


@bp.route("/client-config", methods=["GET"])
def plugin_client_config():
    return jsonify(_build_plugin_client_config_response())


@bp.route("/activate", methods=["POST"])
def activate_plugin_card_key():
    try:
        card_key, email, client_id, error_resp = _parse_payload()
        if error_resp:
            return error_resp

        is_valid, message, card, effective_card_data = _validate_card_for_plugin(card_key, email)
        if not is_valid:
            return _actionable_auth_failure(message, card, extra_data=effective_card_data)

        now = china_now()
        binding = PluginCardBinding.query.filter_by(card_key_id=card.id).first()

        if not binding:
            binding = PluginCardBinding(
                card_key_id=card.id,
                email=email,
                client_id=client_id,
                activated_at=now,
                last_seen_at=now,
                status=PluginCardBindingStatus.ACTIVE,
            )
            db.session.add(binding)
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                binding = PluginCardBinding.query.filter_by(card_key_id=card.id).first()
                if not binding:
                    return _response(False, "插件激活失败，请稍后重试", False, card, extra_data=effective_card_data)

        if (binding.email or "").strip().lower() != email:
            return _actionable_auth_failure("邮箱与插件绑定不匹配", card, extra_data=effective_card_data)
        if binding.email != email:
            binding.email = email

        if binding.client_id != client_id:
            return _actionable_auth_failure("设备不匹配", card, extra_data=effective_card_data)

        binding.last_seen_at = now
        if binding.status != PluginCardBindingStatus.ACTIVE:
            binding.status = PluginCardBindingStatus.ACTIVE
        db.session.commit()
        return _response(True, "插件授权通过", True, card, extra_data=effective_card_data)
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("[plugin-card] activate failed: %s", e)
        return _response(False, f"服务器错误: {str(e)}", False, None), 500


@bp.route("/status", methods=["POST"])
def plugin_card_key_status():
    try:
        card_key, email, client_id, error_resp = _parse_payload()
        if error_resp:
            return error_resp

        is_valid, message, card, effective_card_data = _validate_card_for_plugin(card_key, email)
        if not is_valid:
            return _actionable_auth_failure(message, card, extra_data=effective_card_data)

        binding = PluginCardBinding.query.filter_by(card_key_id=card.id).first()
        binding_ok, binding_message = _validate_binding_for_auth(binding, email, client_id)
        if not binding_ok:
            return _actionable_auth_failure(binding_message, card, extra_data=effective_card_data)

        binding.last_seen_at = china_now()
        db.session.commit()
        return _response(True, "插件授权有效", True, card, extra_data=effective_card_data)
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("[plugin-card] status failed: %s", e)
        return _response(False, f"服务器错误: {str(e)}", False, None), 500


@bp.route("/rebind", methods=["POST"])
def rebind_plugin_card_key():
    try:
        card_key, email, client_id, error_resp = _parse_payload()
        if error_resp:
            return error_resp

        is_valid, message, card, effective_card_data = _validate_card_for_plugin(card_key, email)
        if not is_valid:
            return _actionable_auth_failure(message, card, extra_data=effective_card_data)

        binding = PluginCardBinding.query.filter_by(card_key_id=card.id).first()
        if not binding:
            return _actionable_auth_failure("插件绑定不存在，请先激活", card, extra_data=effective_card_data)

        if binding.status != PluginCardBindingStatus.ACTIVE:
            return _actionable_auth_failure("插件绑定状态不可用", card, extra_data=effective_card_data)

        if (binding.email or "").strip().lower() != email:
            return _actionable_auth_failure("邮箱与插件绑定不匹配", card, extra_data=effective_card_data)

        now = china_now()
        if binding.client_id == client_id:
            binding.last_seen_at = now
            db.session.commit()
            return _response(True, "当前设备已绑定，无需换绑", True, card, extra_data=effective_card_data)

        old_client_id = binding.client_id
        binding.client_id = client_id
        binding.rebind_count = (binding.rebind_count or 0) + 1
        binding.last_seen_at = now

        log = PluginCardRebindLog(
            card_key_id=card.id,
            email=email,
            old_client_id=old_client_id,
            new_client_id=client_id,
            created_at=now,
        )
        db.session.add(log)
        db.session.commit()
        return _response(True, "换绑成功", True, card, extra_data=effective_card_data)
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("[plugin-card] rebind failed: %s", e)
        return _response(False, f"服务器错误: {str(e)}", False, None), 500
