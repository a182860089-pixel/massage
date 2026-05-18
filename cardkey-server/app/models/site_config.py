"""SiteConfig 精简：表与 schema 不变（与 seatpool 共享），只暴露 plugin 关心的两个 key。"""
from ..extensions import db
from ..utils.timezone import now as china_now


class SiteConfig(db.Model):
    __tablename__ = "site_configs"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(64), unique=True, nullable=False, index=True)
    value = db.Column(db.Text, nullable=True)
    description = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=china_now, nullable=False)
    updated_at = db.Column(db.DateTime, default=china_now, onupdate=china_now, nullable=False)

    KEY_PLUGIN_ANNOUNCEMENT_MD = "plugin_announcement_md"
    KEY_PLUGIN_UPGRADE_URL = "plugin_upgrade_url"

    @classmethod
    def get(cls, key: str, default: str = None) -> str:
        row = cls.query.filter_by(key=key).first()
        return row.value if row else default
