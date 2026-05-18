"""管理员用户。复用 seatpool_prod.admin_users 表 schema。"""
from werkzeug.security import generate_password_hash, check_password_hash

from ..extensions import db
from ..utils.timezone import now as china_now


class AdminUser(db.Model):
    __tablename__ = "admin_users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    is_super = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    last_login_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=china_now, nullable=False)
    updated_at = db.Column(db.DateTime, default=china_now, onupdate=china_now, nullable=False)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def update_last_login(self) -> None:
        self.last_login_at = china_now()

    def __repr__(self):
        return f"<AdminUser {self.username}>"
