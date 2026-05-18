"""Admin 登录与 session 守护。"""
from functools import wraps

from flask import flash, redirect, request, session, url_for

from ..models import AdminUser

SESSION_KEY_ADMIN_ID = "_admin_id"


def current_admin() -> AdminUser | None:
    admin_id = session.get(SESSION_KEY_ADMIN_ID)
    if not admin_id:
        return None
    admin = AdminUser.query.get(admin_id)
    if not admin or not admin.is_active:
        session.pop(SESSION_KEY_ADMIN_ID, None)
        return None
    return admin


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        admin = current_admin()
        if admin is None:
            return redirect(url_for("admin.login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


def super_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        admin = current_admin()
        if admin is None:
            return redirect(url_for("admin.login", next=request.path))
        if not admin.is_super:
            flash("需要超级管理员权限", "error")
            return redirect(url_for("admin.dashboard"))
        return view(*args, **kwargs)
    return wrapper
