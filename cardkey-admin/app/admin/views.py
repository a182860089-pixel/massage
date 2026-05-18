"""管理后台路由。
极简集合：登录 / 仪表盘 / 激活码列表+生成+禁用+导出 / 用户列表+详情 / 激活记录列表。"""
import io
from datetime import datetime, timedelta

from flask import (
    Blueprint,
    Response,
    abort,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from sqlalchemy import desc, func, or_

from ..extensions import db
from ..models import (
    ActivationRecord,
    ActivationRecordStatus,
    AdminUser,
    CardKey,
    CardKeyStatus,
    CardKeyType,
    Member,
    PluginCardBinding,
)
from ..utils.formatters import (
    card_status_label,
    card_type_label,
    mask_card_key,
    remaining_days,
)
from ..utils.timezone import as_china_naive, china_now, format_china_datetime
from .auth import SESSION_KEY_ADMIN_ID, current_admin, login_required, super_required

bp = Blueprint("admin", __name__, url_prefix="/admin")


@bp.context_processor
def inject_helpers():
    return {
        "admin": current_admin(),
        "card_type_label": card_type_label,
        "card_status_label": card_status_label,
        "mask_card_key": mask_card_key,
        "remaining_days": remaining_days,
        "format_china_datetime": format_china_datetime,
    }


# ---------------- 登录 / 登出 ----------------

@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_admin() is not None:
        return redirect(url_for("admin.dashboard"))

    error = None
    username = ""

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        admin = AdminUser.query.filter_by(username=username).first()
        if admin and admin.is_active and admin.check_password(password):
            admin.update_last_login()
            db.session.commit()
            session.permanent = True
            session[SESSION_KEY_ADMIN_ID] = admin.id
            next_url = request.args.get("next") or url_for("admin.dashboard")
            if not next_url.startswith("/"):
                next_url = url_for("admin.dashboard")
            return redirect(next_url)
        error = "用户名或密码错误"

    return render_template("admin/login.html", error=error, username=username)


@bp.route("/logout", methods=["GET", "POST"])
def logout():
    session.pop(SESSION_KEY_ADMIN_ID, None)
    return redirect(url_for("admin.login"))


# ---------------- 仪表盘 ----------------

@bp.route("/", methods=["GET"])
@login_required
def dashboard():
    total_cards = db.session.query(func.count(CardKey.id)).scalar() or 0
    active_cards = db.session.query(func.count(CardKey.id)).filter(CardKey.status == CardKeyStatus.ACTIVE).scalar() or 0
    expired_cards = db.session.query(func.count(CardKey.id)).filter(CardKey.status == CardKeyStatus.EXPIRED).scalar() or 0
    unused_cards = db.session.query(func.count(CardKey.id)).filter(CardKey.status == CardKeyStatus.UNUSED).scalar() or 0
    total_users = db.session.query(func.count(Member.id)).scalar() or 0
    total_activations = db.session.query(func.count(ActivationRecord.id)).filter(
        ActivationRecord.status == ActivationRecordStatus.SUCCEEDED
    ).scalar() or 0

    recent_activations = (
        ActivationRecord.query
        .filter(ActivationRecord.status == ActivationRecordStatus.SUCCEEDED)
        .order_by(desc(ActivationRecord.created_at))
        .limit(10)
        .all()
    )

    return render_template(
        "admin/dashboard.html",
        stats={
            "total_cards": total_cards,
            "active_cards": active_cards,
            "expired_cards": expired_cards,
            "unused_cards": unused_cards,
            "total_users": total_users,
            "total_activations": total_activations,
        },
        recent_activations=recent_activations,
    )


# ---------------- 激活码列表 ----------------

@bp.route("/cards", methods=["GET"])
@login_required
def cards():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    card_type = (request.args.get("card_type") or "").strip()
    page = max(1, int(request.args.get("page", 1) or 1))
    per_page = min(100, max(10, int(request.args.get("per_page", 30) or 30)))

    query = CardKey.query.outerjoin(Member, CardKey.member_id == Member.id)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(CardKey.key.ilike(like), Member.email.ilike(like)))
    if status:
        query = query.filter(CardKey.status == status)
    if card_type:
        query = query.filter(CardKey.card_type == card_type)

    total = query.count()
    items = (
        query
        .order_by(desc(CardKey.created_at))
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return render_template(
        "admin/cards.html",
        items=items,
        q=q,
        status_filter=status,
        card_type_filter=card_type,
        page=page,
        per_page=per_page,
        total=total,
        page_count=max(1, (total + per_page - 1) // per_page),
        statuses=[
            ("unused", "未激活"),
            ("active", "已激活"),
            ("expired", "已过期"),
            ("used_up", "已用完"),
            ("disabled", "已禁用"),
        ],
        card_types=[
            ("unlimited", "标准卡"),
            ("limited", "限用卡"),
            ("daypass", "日抛卡"),
        ],
    )


@bp.route("/cards/generate", methods=["POST"])
@login_required
def cards_generate():
    raw_count = request.form.get("count") or "1"
    raw_validity = request.form.get("validity_days") or "30"
    raw_type = (request.form.get("card_type") or CardKeyType.UNLIMITED).strip()

    try:
        count = max(1, min(int(raw_count), 1000))
    except (TypeError, ValueError):
        flash("数量需要是整数", "error")
        return redirect(url_for("admin.cards"))
    try:
        validity_days = max(1, min(int(raw_validity), 3650))
    except (TypeError, ValueError):
        flash("有效期需要是整数", "error")
        return redirect(url_for("admin.cards"))

    if raw_type not in CardKeyType.VALID_VALUES:
        flash("卡密类型无效", "error")
        return redirect(url_for("admin.cards"))

    created_keys = []
    for _ in range(count):
        card = CardKey.create_new(
            card_type=raw_type,
            validity_days=validity_days,
            is_batch_generated=count > 1,
        )
        db.session.add(card)
        created_keys.append(card)
    db.session.commit()

    flash(f"已生成 {count} 个激活码", "success")
    if count == 1:
        flash(f"激活码：{created_keys[0].key}", "info")
    else:
        keys_preview = " · ".join(c.key for c in created_keys[:5])
        flash(f"前 5 个：{keys_preview} ... 共 {count} 个，可用「导出 TXT」下载完整列表", "info")
    return redirect(url_for("admin.cards", status="unused"))


@bp.route("/cards/<int:card_id>/toggle", methods=["POST"])
@login_required
def cards_toggle(card_id: int):
    card = CardKey.query.get(card_id)
    if not card:
        abort(404)
    if card.status == CardKeyStatus.DISABLED:
        if card.member_id and card.expires_at and as_china_naive(card.expires_at) > china_now():
            card.status = CardKeyStatus.ACTIVE
        elif card.member_id:
            card.status = CardKeyStatus.EXPIRED
        else:
            card.status = CardKeyStatus.UNUSED
        db.session.commit()
        flash("已启用", "success")
    else:
        card.status = CardKeyStatus.DISABLED
        db.session.commit()
        flash("已禁用", "success")
    return redirect(request.referrer or url_for("admin.cards"))


@bp.route("/cards/<int:card_id>/extend", methods=["POST"])
@login_required
def cards_extend(card_id: int):
    card = CardKey.query.get(card_id)
    if not card:
        abort(404)
    try:
        days = int(request.form.get("extend_days", 30))
    except (TypeError, ValueError):
        flash("延长天数需要是整数", "error")
        return redirect(url_for("admin.cards"))
    days = max(-365, min(days, 3650))
    base = as_china_naive(card.expires_at) or china_now()
    card.expires_at = base + timedelta(days=days)
    if card.status == CardKeyStatus.EXPIRED and card.expires_at > china_now():
        card.status = CardKeyStatus.ACTIVE
    elif card.expires_at <= china_now() and card.status == CardKeyStatus.ACTIVE:
        card.status = CardKeyStatus.EXPIRED
    db.session.commit()
    flash(f"已调整有效期 {days:+d} 天，新过期时间 {format_china_datetime(card.expires_at)}", "success")
    return redirect(request.referrer or url_for("admin.cards"))


@bp.route("/cards/export", methods=["GET"])
@login_required
def cards_export():
    status = (request.args.get("status") or "").strip()
    card_type = (request.args.get("card_type") or "").strip()
    q = (request.args.get("q") or "").strip()

    query = CardKey.query
    if status:
        query = query.filter(CardKey.status == status)
    if card_type:
        query = query.filter(CardKey.card_type == card_type)
    if q:
        query = query.filter(CardKey.key.ilike(f"%{q}%"))

    items = query.order_by(desc(CardKey.created_at)).limit(10000).all()

    buf = io.StringIO()
    buf.write("# 激活码导出\n")
    buf.write(f"# 导出时间: {format_china_datetime(china_now())}\n")
    buf.write(f"# 总数: {len(items)}\n")
    buf.write(f"# 状态过滤: {status or '全部'}  类型过滤: {card_type or '全部'}\n")
    buf.write("#\n")
    buf.write("# 激活码,类型,状态,有效期(天),过期时间,绑定邮箱\n")
    for c in items:
        email = c.member.email if c.member else ""
        expires = format_china_datetime(c.expires_at) if c.expires_at else ""
        buf.write(f"{c.key},{c.card_type},{c.status},{c.validity_days},{expires},{email}\n")

    fname = f"activation-codes-{china_now().strftime('%Y%m%d-%H%M%S')}.txt"
    return Response(
        buf.getvalue(),
        mimetype="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


# ---------------- 用户列表 ----------------

@bp.route("/users", methods=["GET"])
@login_required
def users():
    q = (request.args.get("q") or "").strip()
    page = max(1, int(request.args.get("page", 1) or 1))
    per_page = 30

    query = Member.query
    if q:
        query = query.filter(Member.email.ilike(f"%{q}%"))

    total = query.count()
    items = query.order_by(desc(Member.created_at)).offset((page - 1) * per_page).limit(per_page).all()

    # 统计每个用户绑定的激活码数量
    member_ids = [m.id for m in items]
    card_counts = {}
    if member_ids:
        rows = (
            db.session.query(CardKey.member_id, func.count(CardKey.id))
            .filter(CardKey.member_id.in_(member_ids))
            .group_by(CardKey.member_id)
            .all()
        )
        card_counts = {mid: cnt for mid, cnt in rows}

    return render_template(
        "admin/users.html",
        items=items,
        card_counts=card_counts,
        q=q,
        page=page,
        per_page=per_page,
        total=total,
        page_count=max(1, (total + per_page - 1) // per_page),
    )


@bp.route("/users/<int:member_id>", methods=["GET"])
@login_required
def user_detail(member_id: int):
    member = Member.query.get(member_id)
    if not member:
        abort(404)
    cards = CardKey.query.filter_by(member_id=member.id).order_by(desc(CardKey.created_at)).all()
    bindings = (
        db.session.query(PluginCardBinding)
        .filter(PluginCardBinding.email == member.email)
        .order_by(desc(PluginCardBinding.last_seen_at))
        .all()
    )
    recent_activations = (
        ActivationRecord.query
        .filter_by(email=member.email)
        .order_by(desc(ActivationRecord.created_at))
        .limit(20)
        .all()
    )
    return render_template(
        "admin/user_detail.html",
        member=member,
        cards=cards,
        bindings=bindings,
        recent_activations=recent_activations,
    )


# ---------------- 激活记录列表 ----------------

@bp.route("/activations", methods=["GET"])
@login_required
def activations():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    source = (request.args.get("source") or "").strip()
    page = max(1, int(request.args.get("page", 1) or 1))
    per_page = 50

    query = ActivationRecord.query
    if q:
        like = f"%{q}%"
        query = query.filter(or_(ActivationRecord.email.ilike(like), ActivationRecord.card_key.ilike(like)))
    if status:
        query = query.filter(ActivationRecord.status == status)
    if source:
        query = query.filter(ActivationRecord.source == source)

    total = query.count()
    items = query.order_by(desc(ActivationRecord.created_at)).offset((page - 1) * per_page).limit(per_page).all()

    return render_template(
        "admin/activations.html",
        items=items,
        q=q,
        status_filter=status,
        source_filter=source,
        page=page,
        per_page=per_page,
        total=total,
        page_count=max(1, (total + per_page - 1) // per_page),
    )
