# cardkey-admin 切流量后端到端测试报告

- 测试时间：2026-05-18 19:33（UTC+8）
- 测试对象：`https://seat.20050225.xyz` 已切流量到 `cardkey-admin` (`127.0.0.1:8810`)
- 原 `seatpool-web` (`127.0.0.1:8000`) 改为通过 `http://154.12.94.197/` 直连
- 测试脚本：[`scripts/e2e-after-switch.sh`](../scripts/e2e-after-switch.sh)
- 数据库回滚脚本：[`scripts/restore-rebind-after-test.sh`](../scripts/restore-rebind-after-test.sh) + [`scripts/restore-rebind-fix.sh`](../scripts/restore-rebind-fix.sh)

## 切流量变更摘要

| 项目 | 改动前 | 改动后 |
| --- | --- | --- |
| `https://seat.20050225.xyz/*` | 反代到 `127.0.0.1:8000` (seatpool-web) | 反代到 `127.0.0.1:8810` (**cardkey-admin**) |
| 原 `seatpool-web` 暴露方式 | 通过域名 https | 通过 `http://154.12.94.197/`（IP 直连，nginx 上挂在 `default_server`） |
| `/novnc/` 与 `/admin/task-preview/ws` | 挂在域名下 | 挪到 IP 直连 server block 下 |
| nginx 配置文件 | `/etc/nginx/sites-available/seatpool` | 同位置，备份在 `seatpool.bak_20260518_192849` |
| `cardkey-admin` 进程 | `127.0.0.1:8810`（已部署，未对外） | `127.0.0.1:8810`（已对外，via seat 域名） |
| `seatpool-web` 进程 | `127.0.0.1:8000` | `127.0.0.1:8000`（不动） |
| TLS 证书 | Certbot `seat.20050225.xyz`（不动） | 复用现证书，浏览器无任何告警 |

## 端到端测试结果总览

> **PASS=33  FAIL=0**

### [A] 后台未登录访问（4 页 + 登录页）

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `GET /admin/login` | 200 + 含 `cardkey-admin` / `管理员登录` | PASS |
| `GET /admin/` 未登录 | 302 → `/admin/login` | PASS |
| `GET /admin/cards` 未登录 | 302 | PASS |
| `GET /admin/users` 未登录 | 302 | PASS |
| `GET /admin/activations` 未登录 | 302 | PASS |

### [A2] 后台登录后访问（admin / <ADMIN_PASSWORD>）

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| 登录 POST `/admin/login` | 200 + 重定向到 `/admin/` | PASS |
| `GET /admin/` 登录后 | 200 + 含「仪表盘」 | PASS |
| `GET /admin/cards` 登录后 | 200 + 含「激活码」 | PASS |
| `GET /admin/users` 登录后 | 200 + 含「用户」 | PASS |
| `GET /admin/activations` 登录后 | 200 + 含「激活记录」 | PASS |

### [B] 用户激活页

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `GET /` | 200 + 含「激活码」（表单字段） | PASS |

### [C] 4 个插件接口（通过 `https://seat.20050225.xyz` 走）

> 用现网真实 active 卡（`card_key_id=42264`, email `codex-plugin-test-74e96b97@example.com`）做端到端，按真实插件调用顺序验证。

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `GET /api/plugin/card-keys/client-config` | 200 + 含 `plugin_announcement_md` + `updated_at` | PASS |
| `POST /api/plugin/card-keys/activate` 用新 client_id | 200 + `reason_code:device_mismatch`（卡已绑别的设备） | PASS |
| `POST /api/plugin/card-keys/status` 同 client_id | 200 + `reason_code:device_mismatch` | PASS |
| `POST /api/plugin/card-keys/rebind` 换到新 client_id | 200 + `success:true`，`message:换绑成功` | PASS |
| 换绑后 `POST /api/plugin/card-keys/status` 用新 client_id | 200 + `success:true`，`message:插件授权有效` | PASS |
| `POST /api/plugin/card-keys/status` 用**错邮箱** | `reason_code:card_bound_other_email` | PASS |
| `POST /api/plugin/card-keys/rebind` 用**错邮箱** | `reason_code:card_bound_other_email` | PASS |

#### 真实响应样例（rebind 成功）

```json
{
  "data": {
    "authorized": true,
    "card_type": "unlimited",
    "expires_at": "2026-06-09T14:39:29.967689",
    "remaining_days": 22,
    "remaining_hours": 524,
    "status": "active"
  },
  "message": "换绑成功",
  "success": true
}
```

### [D] `/api/activation/redeem`（网页激活接口）边界

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| 空 body `{}` | `reason_code:bad_request` | PASS |
| 非法邮箱 | `reason_code:bad_email` | PASS |
| 不存在的卡 | `reason_code:card_not_found` | PASS |

### [E] 原 seatpool-web 通过 IP 直连仍能用

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `GET http://154.12.94.197/` | 200，body 不含 `cardkey-admin` 关键字 | PASS |
| `GET http://154.12.94.197/api/plugin/card-keys/client-config` | 200（seatpool-web 自有同名接口，作旁证） | OK |

## 关键观测

1. **插件不需要发版**：插件原本就是用 `seat.20050225.xyz` 激活、状态校验、换绑，4 个接口的请求 / 响应字段（含 `success`、`message`、`data.{authorized, card_type, status, expires_at, remaining_days, remaining_hours, reason_code, can_rebind}`）与现网 100% 兼容，已通过现网真实 active 卡端到端跑通。
2. **后台路由完整生效**：4 个后台页 + 登录页 + 用户激活页均在 `seat.20050225.xyz` 下 200，含期望的页面文案 / 模板。
3. **路由隔离正确**：通过域名访问完全走 cardkey-admin；通过 IP 访问完全走 seatpool-web，互不污染（用关键字 `cardkey-admin` 做反向断言）。
4. **TLS 复用 Certbot 现证书**：浏览器无证书告警，DNS 没动。
5. **数据回退到位**：测试期间 `card_key_id=42264` 的 plugin binding 被 rebind 到 `e2e-new-*`，**测试结束后已精确还原**为测试紧邻前的 client_id `8cf2d4a9-5d4b-4daf-b6ff-ca81f97d2036`，相关 `plugin_card_rebind_logs` 中 `e2e-%` 记录也已清理；插件用户感知为零。

## nginx 改动 diff（关键片段）

```nginx
# /etc/nginx/sites-available/seatpool 改动前：location / -> 8000

# 改动后：
server {
    server_name seat.20050225.xyz;
    location / {
        proxy_pass http://127.0.0.1:8810;   # 切到 cardkey-admin
        ...
    }
    listen 443 ssl; ... (Certbot 不动)
}

server {
    listen 80 default_server;
    server_name _;
    location /novnc/ { alias /usr/share/novnc/; ... }
    location /admin/task-preview/ws { proxy_pass http://127.0.0.1:6080; ... }
    location / {
        proxy_pass http://127.0.0.1:8000;   # IP 直连仍走 seatpool-web
        ...
    }
}
```

## 一句话回滚（如果有任何不对劲）

```bash
sudo cp /etc/nginx/sites-available/seatpool.bak_20260518_192849 /etc/nginx/sites-available/seatpool \
  && sudo nginx -t \
  && sudo systemctl reload nginx
```

回滚后 `seat.20050225.xyz` 立刻回到原 seatpool-web 行为，与切流量前一致。

## 仍待你拍板的下一步

1. **systemd 化 cardkey-admin**：当前仍是 `nohup`，重启服务器会丢失。建议挂 `cardkey-admin.service`（脚本已经在 `cardkey-admin/DEPLOY_STATUS.md` 里）。
2. **改 admin 默认密码**：现在仍是 `<ADMIN_PASSWORD>`，先 `ssh -L 8810:127.0.0.1:8810 root@154.12.94.197` 端口转发本地登录改一次，或者通过 https 直接登录 `https://seat.20050225.xyz/admin/login` 改密。
3. **下线 cardkey-only (8801)**：原最小版 `cardkey-server` 已无人引用，可以停掉腾出端口。但**先不要动**，等 cardkey-admin 稳定一段时间再说。
