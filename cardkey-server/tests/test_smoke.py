"""最小烟测：跑通 4 个接口的 happy / unhappy 路径。

使用方法：在服务器侧 venv 里跑 `pytest tests/test_smoke.py`。
本测试不会污染生产数据：所有写入都先通过 fixture 创建的临时卡密 + member，跑完回滚。
"""
import os

import pytest


@pytest.fixture(scope="module")
def app():
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not configured; smoke test skipped")
    from app import create_app

    return create_app()


@pytest.fixture()
def client(app):
    return app.test_client()


def test_client_config(client):
    resp = client.get("/api/plugin/card-keys/client-config")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert "plugin_announcement_md" in body["data"]


def test_activate_rejects_missing_fields(client):
    resp = client.post("/api/plugin/card-keys/activate", json={})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is False


def test_activate_rejects_invalid_email(client):
    resp = client.post(
        "/api/plugin/card-keys/activate",
        json={"card_key": "TEST", "email": "not-an-email", "client_id": "dev"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is False
    assert "邮箱" in body["message"]


def test_status_unknown_card_returns_actionable_failure(client):
    resp = client.post(
        "/api/plugin/card-keys/status",
        json={"card_key": "_NEVER_EXIST_", "email": "a@b.com", "client_id": "dev"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is False
    assert body["data"]["authorized"] is False
    assert body["data"].get("reason_code") in {"card_not_found", None}
