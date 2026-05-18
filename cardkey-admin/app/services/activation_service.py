"""统一激活逻辑：唯一的「激活码 → 邮箱绑定 + 设过期」入口。

设计意图：
- 网站激活页 / 插件 activate 接口 / 管理员后台手动激活 都调这一个函数
- 本地 DB 即权威，不调任何外部服务（不联系 luming、不上 ChatGPT）
- 7 个明确分支，返回结果稳定可枚举
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import CardKey, CardKeyStatus, Member, ActivationRecord, ActivationRecordStatus
from ..utils.timezone import as_china_naive, china_now


@dataclass
class RedeemResult:
    success: bool
    reason_code: str
    message: str
    card_key: Optional[CardKey] = None
    member: Optional[Member] = None
    newly_activated: bool = False

    def to_data(self) -> dict:
        """生成统一的 data payload，给 API 层用。"""
        card = self.card_key
        expires_at = as_china_naive(card.expires_at) if card else None
        remaining_days = None
        remaining_hours = None
        if expires_at:
            diff_seconds = (expires_at - china_now()).total_seconds()
            from math import ceil
            remaining_days = max(0, ceil(diff_seconds / 86400)) if diff_seconds > 0 else 0
            remaining_hours = max(0, ceil(diff_seconds / 3600)) if diff_seconds > 0 else 0

        return {
            "authorized": self.success,
            "card_type": card.card_type if card else None,
            "status": card.status if card else None,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "remaining_days": remaining_days,
            "remaining_hours": remaining_hours,
            "reason_code": self.reason_code or None,
            "newly_activated": self.newly_activated,
        }


REASON_MESSAGES = {
    "card_not_found": "激活码不存在",
    "card_disabled": "激活码已被禁用",
    "card_expired": "激活码已过期",
    "card_consumed": "激活码已使用完毕",
    "card_bound_other_email": "激活码已绑定其他邮箱",
    "ok_new": "激活成功",
    "ok_idempotent": "已经激活过，状态有效",
}


class ActivationService:
    """单一职责：把激活码 + 邮箱变成「成员已激活」的状态。"""

    @classmethod
    def redeem(
        cls,
        card_key: str,
        email: str,
        *,
        source: str = "web",
        ip_addr: str = "",
        user_agent: str = "",
        client_id: str = "",
    ) -> RedeemResult:
        normalized_card_key = (card_key or "").strip()
        normalized_email = (email or "").strip().lower()

        card = CardKey.query.filter_by(key=normalized_card_key).first()
        if not card:
            cls._log_record(
                card_key=normalized_card_key,
                email=normalized_email,
                card=None,
                member=None,
                source=source,
                status=ActivationRecordStatus.REJECTED,
                reason_code="card_not_found",
                message=REASON_MESSAGES["card_not_found"],
                ip_addr=ip_addr,
                user_agent=user_agent,
                client_id=client_id,
            )
            return RedeemResult(
                success=False,
                reason_code="card_not_found",
                message=REASON_MESSAGES["card_not_found"],
            )

        if card.status == CardKeyStatus.DISABLED:
            cls._log_record(
                card_key=normalized_card_key, email=normalized_email,
                card=card, member=None, source=source,
                status=ActivationRecordStatus.REJECTED,
                reason_code="card_disabled",
                message=REASON_MESSAGES["card_disabled"],
                ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
            )
            return RedeemResult(success=False, reason_code="card_disabled",
                                message=REASON_MESSAGES["card_disabled"], card_key=card)

        if card.status in {CardKeyStatus.USED_UP, CardKeyStatus.RENEWED}:
            cls._log_record(
                card_key=normalized_card_key, email=normalized_email,
                card=card, member=None, source=source,
                status=ActivationRecordStatus.REJECTED,
                reason_code="card_consumed",
                message=REASON_MESSAGES["card_consumed"],
                ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
            )
            return RedeemResult(success=False, reason_code="card_consumed",
                                message=REASON_MESSAGES["card_consumed"], card_key=card)

        if card.status == CardKeyStatus.EXPIRED or card.is_expired:
            # 强制对齐状态（防止 status 没被定时任务刷过）
            card.status = CardKeyStatus.EXPIRED
            db.session.commit()
            cls._log_record(
                card_key=normalized_card_key, email=normalized_email,
                card=card, member=None, source=source,
                status=ActivationRecordStatus.REJECTED,
                reason_code="card_expired",
                message=REASON_MESSAGES["card_expired"],
                ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
            )
            return RedeemResult(success=False, reason_code="card_expired",
                                message=REASON_MESSAGES["card_expired"], card_key=card)

        # 已激活：检查邮箱是否一致
        if card.status == CardKeyStatus.ACTIVE and card.member_id:
            member = card.member or Member.query.get(card.member_id)
            if member is None or (member.email or "").strip().lower() != normalized_email:
                cls._log_record(
                    card_key=normalized_card_key, email=normalized_email,
                    card=card, member=None, source=source,
                    status=ActivationRecordStatus.REJECTED,
                    reason_code="card_bound_other_email",
                    message=REASON_MESSAGES["card_bound_other_email"],
                    ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
                )
                return RedeemResult(success=False, reason_code="card_bound_other_email",
                                    message=REASON_MESSAGES["card_bound_other_email"], card_key=card)

            # 幂等：同一卡 + 同一邮箱再来一次激活，直接返回成功（不重复扣 use_count）
            cls._log_record(
                card_key=normalized_card_key, email=normalized_email,
                card=card, member=member, source=source,
                status=ActivationRecordStatus.SUCCEEDED,
                reason_code="ok_idempotent",
                message=REASON_MESSAGES["ok_idempotent"],
                ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
            )
            return RedeemResult(success=True, reason_code="ok_idempotent",
                                message=REASON_MESSAGES["ok_idempotent"],
                                card_key=card, member=member, newly_activated=False)

        # 未激活分支：unused → active
        member = cls._get_or_create_member(normalized_email)
        try:
            card.bind_to_member(member)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            # 极端并发情况下重新读
            card = CardKey.query.filter_by(key=normalized_card_key).first()
            if card and card.status == CardKeyStatus.ACTIVE and card.member_id == member.id:
                pass
            else:
                cls._log_record(
                    card_key=normalized_card_key, email=normalized_email,
                    card=card, member=member, source=source,
                    status=ActivationRecordStatus.REJECTED,
                    reason_code="conflict",
                    message="激活冲突，请稍后再试",
                    ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
                )
                return RedeemResult(success=False, reason_code="conflict",
                                    message="激活冲突，请稍后再试", card_key=card)

        cls._log_record(
            card_key=normalized_card_key, email=normalized_email,
            card=card, member=member, source=source,
            status=ActivationRecordStatus.SUCCEEDED,
            reason_code="ok_new",
            message=REASON_MESSAGES["ok_new"],
            ip_addr=ip_addr, user_agent=user_agent, client_id=client_id,
        )
        return RedeemResult(success=True, reason_code="ok_new",
                            message=REASON_MESSAGES["ok_new"],
                            card_key=card, member=member, newly_activated=True)

    @classmethod
    def _get_or_create_member(cls, email: str) -> Member:
        member = Member.query.filter_by(email=email).first()
        if member:
            return member
        member = Member(email=email)
        db.session.add(member)
        try:
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
            member = Member.query.filter_by(email=email).first()
        return member

    @classmethod
    def _log_record(cls, **kwargs) -> None:
        card = kwargs.get("card")
        member = kwargs.get("member")
        record = ActivationRecord(
            card_key=kwargs["card_key"],
            email=kwargs["email"],
            card_key_id=card.id if card else None,
            member_id=member.id if member else None,
            source=kwargs["source"],
            status=kwargs["status"],
            reason_code=kwargs.get("reason_code"),
            message=kwargs.get("message"),
            activated_at=card.bound_at if (card and card.bound_at) else None,
            expires_at=card.expires_at if card else None,
            card_type=card.card_type if card else None,
            ip_addr=kwargs.get("ip_addr") or None,
            user_agent=kwargs.get("user_agent") or None,
            client_id=kwargs.get("client_id") or None,
        )
        db.session.add(record)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
