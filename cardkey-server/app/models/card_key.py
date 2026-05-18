"""CardKey 模型，精简版：保留与 plugin 流程相关的列与计算属性，去掉 binding_histories 关系。"""
from datetime import timedelta

from ..extensions import db
from ..utils.timezone import as_china_naive, now as china_now


class CardKeyType:
    UNLIMITED = "unlimited"
    LIMITED = "limited"
    DAYPASS = "daypass"


class CardKeyStatus:
    UNUSED = "unused"
    ACTIVE = "active"
    EXPIRED = "expired"
    USED_UP = "used_up"
    RENEWED = "renewed"
    DISABLED = "disabled"


class CardKey(db.Model):
    """复用现有 card_keys 表，schema 与 seatpool 完全一致。"""
    __tablename__ = "card_keys"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(16), unique=True, nullable=False, index=True)

    card_type = db.Column(db.String(16), default=CardKeyType.UNLIMITED, nullable=False)
    card_purpose = db.Column(db.String(16), default="activation", nullable=False, index=True)

    validity_days = db.Column(db.Integer, default=30, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=True)
    first_activated_at = db.Column(db.DateTime, nullable=True)

    member_id = db.Column(db.Integer, db.ForeignKey("members.id"), nullable=True)
    member = db.relationship("Member", foreign_keys=[member_id])
    bound_at = db.Column(db.DateTime, nullable=True)

    use_count = db.Column(db.Integer, default=0, nullable=False)
    status = db.Column(db.String(16), default=CardKeyStatus.UNUSED, nullable=False, index=True)
    is_batch_generated = db.Column(db.Boolean, default=False, nullable=False, index=True)
    activation_entry_type = db.Column(db.String(16), default="default", nullable=False, index=True)
    activation_url = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=china_now, nullable=False)
    updated_at = db.Column(db.DateTime, default=china_now, onupdate=china_now, nullable=False)

    @property
    def is_expired(self) -> bool:
        expires_at = as_china_naive(self.expires_at)
        if expires_at is None:
            return False
        return china_now() > expires_at

    @property
    def is_unlimited(self) -> bool:
        return self.card_type == CardKeyType.UNLIMITED

    @property
    def is_limited(self) -> bool:
        return self.card_type == CardKeyType.LIMITED

    @property
    def is_daypass(self) -> bool:
        return self.card_type == CardKeyType.DAYPASS

    @property
    def remaining_hours(self):
        expires_at = as_china_naive(self.expires_at)
        if not expires_at:
            return None
        remaining_seconds = (expires_at - china_now()).total_seconds()
        if remaining_seconds <= 0:
            return 0
        return int((remaining_seconds + 3599) // 3600)

    def __repr__(self):
        suffix = "..." if self.key and len(self.key) > 8 else ""
        prefix = (self.key or "")[:8]
        return f"<CardKey {prefix}{suffix} ({self.card_type}, {self.status})>"
