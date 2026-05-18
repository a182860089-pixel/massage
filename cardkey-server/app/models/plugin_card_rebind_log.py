"""插件换绑日志，schema 与 plugin_card_rebind_logs 一致。"""
from ..extensions import db
from ..utils.timezone import now as china_now


class PluginCardRebindLog(db.Model):
    __tablename__ = "plugin_card_rebind_logs"

    id = db.Column(db.Integer, primary_key=True)

    card_key_id = db.Column(db.Integer, db.ForeignKey("card_keys.id"), nullable=False, index=True)
    card_key = db.relationship("CardKey", backref=db.backref("plugin_rebind_logs", lazy="dynamic"))

    email = db.Column(db.String(256), nullable=False, index=True)
    old_client_id = db.Column(db.String(128), nullable=True)
    new_client_id = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=china_now, nullable=False)

    def __repr__(self):
        return f"<PluginCardRebindLog card_key_id={self.card_key_id} email={self.email}>"
