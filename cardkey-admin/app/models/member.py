"""用户（按邮箱建档）。复用 seatpool_prod.members 表 schema 子集。"""
from ..extensions import db
from ..utils.timezone import now as china_now


class Member(db.Model):
    __tablename__ = "members"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(256), unique=True, nullable=False, index=True)

    first_joined_at = db.Column(db.DateTime, nullable=True)
    workspace_limit_override = db.Column(db.Integer, nullable=True)

    created_at = db.Column(db.DateTime, default=china_now, nullable=False)
    updated_at = db.Column(db.DateTime, default=china_now, onupdate=china_now, nullable=False)

    card_key = db.relationship(
        "CardKey",
        back_populates="member",
        uselist=False,
        foreign_keys="CardKey.member_id"
    )

    def __repr__(self):
        return f"<Member {self.email}>"
