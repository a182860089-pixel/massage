"""插件接口：保持与现网 /api/plugin/card-keys/* 4 个端点完全兼容的请求/响应格式。

与原 seatpool 版本的差异：
- 不调用任何跨站权威服务（UnifiedActivationService 已删除）
- 本地 DB 即权威
- activate 走统一激活逻辑：未激活的卡密会自动 unused→active 绑定到邮箱
"""
import math

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import (
    CardKey,
    CardKeyStatus,
    PluginCardBinding,
    PluginCardBindingStatus,
    PluginCardRebindLog,
    SiteConfig,
)
from ..services.activation_service import ActivationService
from ..utils.timezone import as_china_naive, now as china_now
from ._common import (
    get_client_ip,
    get_user_agent,
    plugin_rate_limited,
    validate_email,
)

bp = Blueprint("plugin_card_keys", __name__, url_prefix="/api/plugin/card-keys")

PLUGIN_AUTH_FAILURE_MESSAGE = "插件授权校验未通过"
PLUGIN_DEVICE_MISMATCH_MESSAGE = "该激活码已绑定其他设备，请点击换绑设备"
PLUGIN_NOT_ACTIVATED_MESSAGE = "插件尚未激活，请先点击验证激活"


def _build_data(authorized: bool, card: CardKey | None = None) -> dict:
    card_type = None
    status = None
    expires_at = None
    remaining_days = None
    remaining_hours = None

    if card:
        card_type = card.card_type
        status = card.status
        normalized_expires_at = as_china_naive(card.expires_at)
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
    data = _build_data(authorized, card)
    if isinstance(extra_data, dict) and extra_data:
        data.update(extra_data)
    return jsonify({"success": success, "message": message, "data": data})


def _actionable_auth_failure(reason: str, card: CardKey | None = None, extra_data: dict | None = None):
    normalized = str(reason or "").strip()
    payload = dict(extra_data or {})

    if normalized == "设备不匹配":
        payload.update({"reason_code": "device_mismatch", "can_rebind": True})
        return _response(False, PLUGIN_DEVICE_MISMATCH_MESSAGE, False, card, extra_data=payload)
    if normalized in {"插件绑定不存在，请先激活", "插件尚未激活，请先调用 activate"}:
        payload.update({"reason_code": "binding_missing", "can_rebind": False})
        return _response(False, PLUGIN_NOT_ACTIVATED_MESSAGE, False, card, extra_data=payload)
    if normalized == "card_not_found" or normalized == "激活码不存在":
        payload.update({"reason_code": "card_not_found", "can_rebind": False})
        return _response(False, "激活码不存在", False, card, extra_data=payload)
    if normalized == "card_not_activated":
        payload.update({"reason_code": "card_not_activated", "can_rebind": False})
        return _response(False, "激活码尚未激活", False, card, extra_data=payload)
    if normalized == "card_expired" or normalized == "激活码已过期":
        payload.update({"reason_code": "card_expired", "can_rebind": False})
        return _response(False, "激活码已过期", False, card, extra_data=payload)
    if normalized == "card_disabled" or normalized == "激活码已被禁用":
        payload.update({"reason_code": "card_disabled", "can_rebind": False})
        return _response(False, "激活码已被禁用", False, card, extra_data=payload)
    if normalized == "插件绑定状态不可用":
        payload.update({"reason_code": "binding_inactive", "can_rebind": False})
        return _response(False, "插件绑定状态不可用，请重新验证激活", False, card, extra_data=payload)
    if normalized == "card_bound_other_email":
        payload.update({"reason_code": "card_bound_other_email", "can_rebind": False})
        return _response(False, "邮箱与激活码绑定的账号不匹配", False, card, extra_data=payload)
    if normalized == "card_consumed":
        payload.update({"reason_code": "card_consumed", "can_rebind": False})
        return _response(False, "激活码已使用完毕", False, card, extra_data=payload)

    payload.update({"reason_code": payload.get("reason_code") or "auth_failed"})
    return _response(False, PLUGIN_AUTH_FAILURE_MESSAGE, False, card, extra_data=payload)


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
        return None, None, None, _response(False, "请输入激活码", False, None)
    if not email:
        return None, None, None, _response(False, "请输入邮箱", False, None)
    if not client_id:
        return None, None, None, _response(False, "请输入 client_id", False, None)
    if not validate_email(email):
        return None, None, None, _response(False, "邮箱格式不正确", False, None)

    if plugin_rate_limited(card_key, email):
        return None, None, None, (_response(False, "请求过于频繁，请稍后再试", False, None), 429)

    return card_key, email, client_id, None


def _ensure_card_activated(card_key: str, email: str, client_id: str):
    """先复用统一激活逻辑保证卡已激活（unused → active 自动绑定），再返回当前 card 对象。"""
    result = ActivationService.redeem(
        card_key=card_key,
        email=email,
        source="plugin",
        ip_addr=get_client_ip(),
        user_agent=get_user_agent(),
        client_id=client_id,
    )
    return result


@bp.route("/client-config", methods=["GET"])
def plugin_client_config():
    return jsonify(_build_plugin_client_config_response())


@bp.route("/activate", methods=["POST"])
def activate_plugin_card_key():
    try:
        card_key, email, client_id, error_resp = _parse_payload()
        if error_resp:
            return error_resp

        result = _ensure_card_activated(card_key, email, client_id)
        if not result.success:
            return _actionable_auth_failure(result.reason_code, result.card_key, extra_data={})

        card = result.card_key
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
                    return _response(False, "插件激活失败，请稍后重试", False, card)

        if (binding.email or "").strip().lower() != email:
            return _actionable_auth_failure("card_bound_other_email", card)
        if binding.email != email:
            binding.email = email

        if binding.client_id != client_id:
            return _actionable_auth_failure("设备不匹配", card)

        binding.last_seen_at = now
        if binding.status != PluginCardBindingStatus.ACTIVE:
            binding.status = PluginCardBindingStatus.ACTIVE
        db.session.commit()
        return _response(True, "插件授权通过", True, card)
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

        card = CardKey.query.filter_by(key=card_key).first()
        if not card:
            return _actionable_auth_failure("card_not_found", None)
        if card.status == CardKeyStatus.DISABLED:
            return _actionable_auth_failure("card_disabled", card)
        if card.status in {CardKeyStatus.USED_UP, CardKeyStatus.RENEWED}:
            return _actionable_auth_failure("card_consumed", card)
        if card.is_expired or card.status == CardKeyStatus.EXPIRED:
            return _actionable_auth_failure("card_expired", card)
        if card.status != CardKeyStatus.ACTIVE or not card.member_id:
            return _actionable_auth_failure("card_not_activated", card)
        if (card.member.email or "").strip().lower() != email:
            return _actionable_auth_failure("card_bound_other_email", card)

        binding = PluginCardBinding.query.filter_by(card_key_id=card.id).first()
        if not binding:
            return _actionable_auth_failure("插件绑定不存在，请先激活", card)
        if binding.status != PluginCardBindingStatus.ACTIVE:
            return _actionable_auth_failure("插件绑定状态不可用", card)
        if (binding.email or "").strip().lower() != email:
            return _actionable_auth_failure("card_bound_other_email", card)
        if binding.client_id != client_id:
            return _actionable_auth_failure("设备不匹配", card)

        binding.last_seen_at = china_now()
        db.session.commit()
        return _response(True, "插件授权有效", True, card)
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

        card = CardKey.query.filter_by(key=card_key).first()
        if not card:
            return _actionable_auth_failure("card_not_found", None)
        if card.status == CardKeyStatus.DISABLED:
            return _actionable_auth_failure("card_disabled", card)
        if card.is_expired or card.status == CardKeyStatus.EXPIRED:
            return _actionable_auth_failure("card_expired", card)
        if card.status != CardKeyStatus.ACTIVE or not card.member_id:
            return _actionable_auth_failure("card_not_activated", card)
        if (card.member.email or "").strip().lower() != email:
            return _actionable_auth_failure("card_bound_other_email", card)

        binding = PluginCardBinding.query.filter_by(card_key_id=card.id).first()
        if not binding:
            return _actionable_auth_failure("插件绑定不存在，请先激活", card)
        if binding.status != PluginCardBindingStatus.ACTIVE:
            return _actionable_auth_failure("插件绑定状态不可用", card)
        if (binding.email or "").strip().lower() != email:
            return _actionable_auth_failure("card_bound_other_email", card)

        now = china_now()
        if binding.client_id == client_id:
            binding.last_seen_at = now
            db.session.commit()
            return _response(True, "当前设备已绑定，无需换绑", True, card)

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
        return _response(True, "换绑成功", True, card)
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("[plugin-card] rebind failed: %s", e)
        return _response(False, f"服务器错误: {str(e)}", False, None), 500
