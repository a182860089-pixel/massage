"""用户端激活页与成功页。"""
from flask import Blueprint, redirect, render_template, request, url_for

from ..models import CardKey, CardKeyStatus, Member
from ..utils.formatters import (
    card_type_label,
    mask_card_key,
    mask_email,
    remaining_days,
    remaining_hours,
)
from ..utils.timezone import format_china_datetime

bp = Blueprint("web", __name__)


@bp.route("/", methods=["GET"])
def index():
    return render_template("user/activation.html")


@bp.route("/activation-success", methods=["GET"])
def activation_success():
    """通过 ?card=&email= 把刚激活的信息显示出来。
    后端再校验一次确保不能被伪造（必须真的激活了才能进）。"""
    card_key = (request.args.get("card") or "").strip()
    email = (request.args.get("email") or "").strip().lower()
    if not card_key or not email:
        return redirect(url_for("web.index"))

    card = CardKey.query.filter_by(key=card_key).first()
    if not card or card.status != CardKeyStatus.ACTIVE or not card.member_id:
        return redirect(url_for("web.index"))
    member = card.member or Member.query.get(card.member_id)
    if not member or (member.email or "").strip().lower() != email:
        return redirect(url_for("web.index"))

    ctx = {
        "card_masked": mask_card_key(card.key),
        "email_masked": mask_email(member.email),
        "card_type_label": card_type_label(card.card_type),
        "remaining_days": remaining_days(card.expires_at),
        "remaining_hours": remaining_hours(card.expires_at),
        "expires_at_str": format_china_datetime(card.expires_at, "%Y-%m-%d %H:%M"),
    }
    return render_template("user/activation_success.html", **ctx)
