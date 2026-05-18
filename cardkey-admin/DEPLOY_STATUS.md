# cardkey-admin 部署状态

> 最新更新：2026-05-18，`seat.20050225.xyz` 已切到 cardkey-admin，端到端测试全部通过，见 [`TEST_REPORT_20260518.md`](./TEST_REPORT_20260518.md)。

## 部署位置

- 服务器：`154.12.94.197`
- 路径：`/opt/cardkey-admin/`
- 进程：gunicorn，监听 `127.0.0.1:8810`
- 启动方式：nohup（PID 在 `/opt/cardkey-admin/server.pid`，重启会丢失，systemd 单元待定）
- 日志：`/opt/cardkey-admin/server.log`
- DB：复用 `seatpool_prod`（与原服务、cardkey-only 共享）
- 新增表：`activation_records`（自管，不污染原有表）

## 对外暴露（已上线）

- `https://seat.20050225.xyz/` → cardkey-admin 用户激活页
- `https://seat.20050225.xyz/admin/login` → cardkey-admin 后台登录
- `https://seat.20050225.xyz/api/plugin/card-keys/{client-config,activate,status,rebind}` → 插件 4 接口（与现网 100% 兼容，插件不需要发版）
- `https://seat.20050225.xyz/api/activation/redeem` → 网页统一激活接口
- 原 seatpool-web 不再走域名，改为 `http://154.12.94.197/`（nginx default_server，反代到 `127.0.0.1:8000`）
- TLS 证书：复用 Certbot 现有 `seat.20050225.xyz` 证书，无任何浏览器告警

nginx 关键配置：[`scripts/switch-nginx-to-cardkey-admin.sh`](../scripts/switch-nginx-to-cardkey-admin.sh) 落盘版，备份在 `/etc/nginx/sites-available/seatpool.bak_20260518_192849`。

一句话回滚：

```bash
sudo cp /etc/nginx/sites-available/seatpool.bak_20260518_192849 /etc/nginx/sites-available/seatpool \
  && sudo nginx -t && sudo systemctl reload nginx
```

## 已建账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `<ADMIN_PASSWORD>` | 超级管理员 |

> 强烈建议登录后用 `flask create-admin admin <新密码>` 重置一次密码。

## 已通过的端到端冒烟

| 场景 | 结果 |
| --- | --- |
| `GET /healthz` | 200 `{"ok":true}` |
| `GET /` (激活页) | 200 HTML |
| `GET /admin/login` | 200 HTML |
| `GET /api/plugin/card-keys/client-config` | 200 + 完整公告 |
| `POST /api/activation/redeem` 空 body | `bad_request` |
| `POST /api/activation/redeem` 不存在卡密 | `card_not_found` |
| `POST /api/activation/redeem` 用真实 unused 卡 + 新邮箱 | `success, reason_code:ok_new, 剩余 30 天` |
| `POST /api/activation/redeem` 同卡同邮箱再次激活 | `success, reason_code:ok_idempotent` (幂等) |
| `POST /api/activation/redeem` 同卡换别的邮箱 | `card_bound_other_email` |
| `POST /api/plugin/card-keys/activate` 用真实 active 卡 + 新设备 | `device_mismatch` (can_rebind:true) |
| `POST /api/plugin/card-keys/status` 用真实 active 卡 + 新设备 | 同上 |

## 历史方案对比（仅作存档）

切流量前曾对比过三种方案：

| 方案 | 描述 | 实际采用 |
| --- | --- | --- |
| A | 新增独立子域名 `admin.20050225.xyz` / `card.20050225.xyz`（需要改 DNS） | 否 |
| B | 复用 `seat.20050225.xyz` + 子路径前缀 | 否（路径与原 seatpool `/admin/*` 冲突太多） |
| **C** | **复用 `seat.20050225.xyz` 整 server block 切换；原 seatpool-web 改用 IP 直连** | **是**（插件本身就用 seat 域名激活，无需发版） |

## 临时验证（无需公网，仍可走 SSH 端口转发）

```bash
ssh -L 8810:127.0.0.1:8810 root@154.12.94.197
# 然后浏览器打开 http://127.0.0.1:8810/
```

## systemd 化（重启不丢）

```bash
sudo tee /etc/systemd/system/cardkey-admin.service > /dev/null <<EOF
[Unit]
Description=cardkey-admin
After=network.target postgresql@15-main.service
Wants=postgresql@15-main.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cardkey-admin
EnvironmentFile=/opt/cardkey-admin/.env
ExecStart=/opt/cardkey-admin/.venv/bin/python -m gunicorn \
  -w 1 -k gthread --threads 4 --timeout 60 --graceful-timeout 30 \
  --chdir /opt/cardkey-admin \
  -b 127.0.0.1:8810 'app:create_app()'
Restart=always
RestartSec=3
StandardOutput=append:/opt/cardkey-admin/server.log
StandardError=append:/opt/cardkey-admin/server.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo kill "$(cat /opt/cardkey-admin/server.pid)" 2>/dev/null || true
sudo systemctl enable --now cardkey-admin.service
sudo systemctl status cardkey-admin.service
```

## 影响范围

- ✅ 已动 nginx：`seat.20050225.xyz` 反代切到 8810；新增 `default_server` 处理 IP 直连 → 8000
- ✅ 没动原 seatpool-web（仍在 8000 端口跑），改走 IP 直连
- ✅ 没动 cardkey-only（仍在 8801 端口跑，可后续下线）
- ✅ 在 `seatpool_prod` 库里新建了 `activation_records` 表（cardkey-admin 自管）
- ✅ 复用了 `card_keys / members / plugin_card_bindings / plugin_card_rebind_logs / site_configs / admin_users` 表
- ✅ 测试期间被修改的 `plugin_card_bindings`（`card_key_id=42264`）已精确还原为测试前状态
