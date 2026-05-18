"""站点配置。复用 seatpool_prod.site_configs 表 schema，只暴露公告/升级链接两个 key。"""
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

    @classmethod
    def set(cls, key: str, value: str, description: str = None) -> "SiteConfig":
        row = cls.query.filter_by(key=key).first()
        if row is None:
            row = cls(key=key, value=value, description=description)
            db.session.add(row)
        else:
            row.value = value
            if description is not None:
                row.description = description
        db.session.commit()
        return row
