"""插件卡密绑定，schema 与原 plugin_card_bindings 一致。"""
from ..extensions import db
from ..utils.timezone import now as china_now


class PluginCardBindingStatus:
    ACTIVE = "active"
    DISABLED = "disabled"


class PluginCardBinding(db.Model):
    __tablename__ = "plugin_card_bindings"

    id = db.Column(db.Integer, primary_key=True)

    card_key_id = db.Column(db.Integer, db.ForeignKey("card_keys.id"), nullable=False, unique=True, index=True)
    card_key = db.relationship("CardKey", backref=db.backref("plugin_binding", uselist=False))

    email = db.Column(db.String(256), nullable=False, index=True)
    client_id = db.Column(db.String(128), nullable=False, index=True)

    activated_at = db.Column(db.DateTime, default=china_now, nullable=False)
    last_seen_at = db.Column(db.DateTime, default=china_now, nullable=False)
    rebind_count = db.Column(db.Integer, default=0, nullable=False)
    status = db.Column(db.String(16), default=PluginCardBindingStatus.ACTIVE, nullable=False, index=True)

    created_at = db.Column(db.DateTime, default=china_now, nullable=False)
    updated_at = db.Column(db.DateTime, default=china_now, onupdate=china_now, nullable=False)

    def __repr__(self):
        return f"<PluginCardBinding card_key_id={self.card_key_id} email={self.email} client={self.client_id}>"
