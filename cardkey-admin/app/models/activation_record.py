"""激活记录：每次站内/插件激活均落一条；管理员后台直接看这张表。

新建独立表 `activation_records`（不复用 seatpool_prod.unified_activation_records，
那张表字段冗余且与跨站架构耦合）。schema 简洁，由 cardkey-admin 自管。
"""
from ..extensions import db
from ..utils.timezone import now as china_now


class ActivationRecordStatus:
    SUCCEEDED = "succeeded"
    REJECTED = "rejected"


class ActivationRecord(db.Model):
    __tablename__ = "activation_records"
    # 注意：所有索引都通过 __table_args__ 集中声明，列定义里**不**再加 index=True，避免重名
    __table_args__ = (
        db.Index("ix_activation_records_email_created", "email", "created_at"),
        db.Index("ix_activation_records_card_key", "card_key"),
        db.Index("ix_activation_records_status", "status"),
        db.Index("ix_activation_records_card_key_id", "card_key_id"),
        db.Index("ix_activation_records_member_id", "member_id"),
        db.Index("ix_activation_records_created_at", "created_at"),
    )

    id = db.Column(db.Integer, primary_key=True)

    card_key = db.Column(db.String(16), nullable=False)
    email = db.Column(db.String(256), nullable=False)
    card_key_id = db.Column(db.Integer, nullable=True)
    member_id = db.Column(db.Integer, nullable=True)

    source = db.Column(db.String(16), nullable=False, default="web")  # web / plugin / admin
    status = db.Column(db.String(16), nullable=False, default=ActivationRecordStatus.SUCCEEDED)
    reason_code = db.Column(db.String(32), nullable=True)
    message = db.Column(db.String(256), nullable=True)

    activated_at = db.Column(db.DateTime, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True)
    card_type = db.Column(db.String(16), nullable=True)

    ip_addr = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(256), nullable=True)
    client_id = db.Column(db.String(128), nullable=True)

    created_at = db.Column(db.DateTime, default=china_now, nullable=False)

    def __repr__(self):
        return f"<ActivationRecord #{self.id} {self.email} {self.card_key} {self.status}>"
