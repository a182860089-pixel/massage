"""统一激活接口：POST /api/activation/redeem"""
from flask import Blueprint, jsonify, request

from ..services.activation_service import ActivationService
from ._common import (
    activation_rate_limited,
    get_client_ip,
    get_user_agent,
    validate_email,
)

bp = Blueprint("activation", __name__, url_prefix="/api/activation")


def _error(message: str, code: str = ""):
    return jsonify({"success": False, "message": message, "data": {"authorized": False, "reason_code": code or None}})


@bp.route("/redeem", methods=["POST"])
def redeem():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or not payload:
        return _error("请求体不能为空", "bad_request")

    card_key = (payload.get("card_key") or payload.get("activation_code") or "").strip()
    email = (payload.get("email") or "").strip().lower()

    if not card_key:
        return _error("请输入激活码", "bad_request")
    if not email:
        return _error("请输入邮箱", "bad_request")
    if not validate_email(email):
        return _error("邮箱格式不正确", "bad_email")

    if activation_rate_limited(card_key, email):
        return _error("请求过于频繁，请稍后再试", "rate_limited"), 429

    result = ActivationService.redeem(
        card_key=card_key,
        email=email,
        source="web",
        ip_addr=get_client_ip(),
        user_agent=get_user_agent(),
    )
    return jsonify({
        "success": result.success,
        "message": result.message,
        "data": result.to_data(),
    })
