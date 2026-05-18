"""Member 模型最小占位：只读 id + email，用于 CardKey.member 关联。"""
from ..extensions import db


class Member(db.Model):
    __tablename__ = "members"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(256), unique=True, nullable=False, index=True)

    def __repr__(self):
        return f"<Member {self.email}>"
