# cardkey-admin

激活码管理系统 —— 从 `/seatpool` 派生而来的精简版本，专注于「激活码 + 邮箱」的本地激活流程。

## 目标

- 用户在网站或插件输入「激活码 + 邮箱」即可在本地立即激活，无需「加入 ChatGPT 团队空间」
- 管理员可以增删改查激活码、查看用户、查看激活记录
- UI 统一显示「剩余 N 天」，不再有「无限版」字样

## 与 cardkey-server 的区别

| 项目 | cardkey-server | cardkey-admin |
| --- | --- | --- |
| 用途 | 仅承载 4 个插件接口的最小后端 | 完整的管理后台 + 用户激活页 + 插件接口 |
| UI | 无 | 4 个管理页面 + 1 个用户激活页 |
| 部署 | `127.0.0.1:8801` | `127.0.0.1:8810` |
| DB | 共用 `seatpool_prod` | 共用 `seatpool_prod` |

## 路由总览

| 类型 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 用户 | GET | `/` | 激活页（激活码 + 邮箱表单） |
| 用户 | GET | `/activation-success` | 激活成功页（显示剩余天数） |
| 公开 API | POST | `/api/activation/redeem` | 统一激活：将 unused 卡密绑定到邮箱并设过期 |
| 公开 API | GET | `/api/plugin/card-keys/client-config` | 插件远程配置（沿用） |
| 公开 API | POST | `/api/plugin/card-keys/activate` | 插件激活：复用统一激活 + 绑定 client_id |
| 公开 API | POST | `/api/plugin/card-keys/status` | 插件状态校验（沿用） |
| 公开 API | POST | `/api/plugin/card-keys/rebind` | 插件换绑设备（沿用） |
| 后台 | GET/POST | `/admin/login` | 管理员登录 |
| 后台 | GET | `/admin/` | 仪表盘（统计概览） |
| 后台 | GET | `/admin/cards` | 激活码列表 + 操作 |
| 后台 | POST | `/admin/cards/generate` | 单个/批量生成激活码 |
| 后台 | POST | `/admin/cards/<id>/toggle` | 启用/禁用激活码 |
| 后台 | GET | `/admin/cards/export` | 导出 TXT |
| 后台 | GET | `/admin/users` | 用户列表 |
| 后台 | GET | `/admin/users/<id>` | 用户详情 |
| 后台 | GET | `/admin/activations` | 激活记录列表 |
| 后台 | GET/POST | `/admin/logout` | 登出 |

## 运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 填 DATABASE_URL 和 SECRET_KEY
python wsgi.py        # 调试
# 生产
gunicorn -w 1 -k gthread --threads 4 --timeout 60 -b 127.0.0.1:8810 'app:create_app()'
```
