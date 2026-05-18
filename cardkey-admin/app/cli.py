"""flask CLI：创建/重置管理员账号。"""
import click

from .extensions import db
from .models import AdminUser


def register_cli(app):
    @app.cli.command("create-admin")
    @click.argument("username")
    @click.argument("password")
    @click.option("--super/--not-super", "is_super", default=True)
    def create_admin(username: str, password: str, is_super: bool):
        """创建/重置管理员账号。

        用法：FLASK_APP=app flask create-admin USERNAME PASSWORD
        """
        existing = AdminUser.query.filter_by(username=username).first()
        if existing:
            existing.set_password(password)
            existing.is_super = is_super
            existing.is_active = True
            db.session.commit()
            click.echo(f"已重置管理员密码: {username}")
            return
        admin = AdminUser(username=username, is_super=is_super, is_active=True)
        admin.set_password(password)
        db.session.add(admin)
        db.session.commit()
        click.echo(f"已创建管理员: {username} (super={is_super})")
