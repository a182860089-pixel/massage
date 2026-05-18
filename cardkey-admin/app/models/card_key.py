"""激活码（即卡密）。复用 seatpool_prod.card_keys 表 schema。"""
import secrets
import string
from datetime import timedelta

from ..extensions import db
from ..utils.timezone import as_china_naive, now as china_now


# 易混淆字符不在生成集合里：去掉 O, 0, I, l, 1
_GEN_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class CardKeyType:
    UNLIMITED = "unlimited"
    LIMITED = "limited"
    DAYPASS = "daypass"

    VALID_VALUES = {UNLIMITED, LIMITED, DAYPASS}


class CardKeyStatus:
    UNUSED = "unused"
    ACTIVE = "active"
    EXPIRED = "expired"
    USED_UP = "used_up"
    RENEWED = "renewed"
    DISABLED = "disabled"


class CardKeyPurpose:
    ACTIVATION = "activation"
    RENEWAL = "renewal"


class CardKey(db.Model):
    __tablename__ = "card_keys"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(16), unique=True, nullable=False, index=True)

    card_type = db.Column(db.String(16), default=CardKeyType.UNLIMITED, nullable=False)
    card_purpose = db.Column(db.String(16), default=CardKeyPurpose.ACTIVATION, nullable=False, index=True)

    validity_days = db.Column(db.Integer, default=30, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=True)
    first_activated_at = db.Column(db.DateTime, nullable=True)

    member_id = db.Column(db.Integer, db.ForeignKey("members.id"), nullable=True)
    member = db.relationship("Member", back_populates="card_key", foreign_keys=[member_id])
    bound_at = db.Column(db.DateTime, nullable=True)

    use_count = db.Column(db.Integer, default=0, nullable=False)
    status = db.Column(db.String(16), default=CardKeyStatus.UNUSED, nullable=False, index=True)
    is_batch_generated = db.Column(db.Boolean, default=False, nullable=False, index=True)
    activation_entry_type = db.Column(db.String(16), default="default", nullable=False, index=True)
    activation_url = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=china_now, nullable=False)
    updated_at = db.Column(db.DateTime, default=china_now, onupdate=china_now, nullable=False)

    @staticmethod
    def generate_key(length: int = 12) -> str:
        return "".join(secrets.choice(_GEN_ALPHABET) for _ in range(length))

    @classmethod
    def create_new(
        cls,
        card_type: str = CardKeyType.UNLIMITED,
        validity_days: int = 30,
        is_batch_generated: bool = False,
    ) -> "CardKey":
        if card_type not in CardKeyType.VALID_VALUES:
            card_type = CardKeyType.UNLIMITED
        if card_type == CardKeyType.DAYPASS and (validity_days is None or validity_days <= 0):
            validity_days = 1
        now = china_now()
        return cls(
            key=cls.generate_key(),
            card_type=card_type,
            card_purpose=CardKeyPurpose.ACTIVATION,
            validity_days=int(validity_days or 30),
            status=CardKeyStatus.UNUSED,
            is_batch_generated=is_batch_generated,
            activation_entry_type="default",
            created_at=now,
            updated_at=now,
        )

    @property
    def is_expired(self) -> bool:
        expires_at = as_china_naive(self.expires_at)
        return expires_at is not None and china_now() > expires_at

    @property
    def is_unlimited(self) -> bool:
        return self.card_type == CardKeyType.UNLIMITED

    @property
    def is_limited(self) -> bool:
        return self.card_type == CardKeyType.LIMITED

    @property
    def is_daypass(self) -> bool:
        return self.card_type == CardKeyType.DAYPASS

    def bind_to_member(self, member: "Member") -> None:
        now = china_now()
        self.member_id = member.id
        self.member = member
        self.bound_at = now
        self.status = CardKeyStatus.ACTIVE
        if self.first_activated_at is None:
            self.first_activated_at = now
            self.expires_at = now + timedelta(days=int(self.validity_days or 30))

    def __repr__(self):
        suffix = "..." if self.key and len(self.key) > 8 else ""
        prefix = (self.key or "")[:8]
        return f"<CardKey {prefix}{suffix} ({self.card_type}, {self.status})>"
