# cardkey-admin · 全链路端到端测试报告（含前端重做）

- 测试时间：**2026-05-18 20:07（UTC+8）**
- 部署对象：`https://seat.20050225.xyz/`（反代到 `127.0.0.1:8810`，cardkey-admin）
- 原 seatpool-web：通过 `http://154.12.94.197/` 继续提供服务，与新版互不干扰
- 端到端测试脚本：[`scripts/full-e2e-test.sh`](../scripts/full-e2e-test.sh)
- 页面文案校验脚本：[`scripts/preview-pages.sh`](../scripts/preview-pages.sh)
- 模板分发脚本：[`scripts/sync-templates-and-reload.sh`](../scripts/sync-templates-and-reload.sh)

## 1. 本次发布做了什么

### 1.1 前端整体改写为 ChatGPT 风格
对 **11 个模板** 全部重做，采用 ChatGPT 设计语言：

| 设计令牌 | 取值 |
| --- | --- |
| 主色调 | 黑 `#0d0d0d` / 灰 `#6e6e80` / 白 `#ffffff` |
| 表面色 | `#ffffff`、`#f7f7f8`、`#ececf1` |
| 强调色 | ChatGPT 绿 `#10a37f`（仅用于关键操作 + 成功状态） |
| 字体栈 | `Söhne / Inter / -apple-system / Segoe UI / PingFang SC` |
| 圆角 | 6 / 8 / 12 / 16 |
| 阴影 | 克制（1px / 4px / 12px 三档） |
| 控件 | 统一 segmented control、ghost / primary / accent 三档按钮 |
| 表格 | 无外阴影、淡灰表头、悬停态、空状态有 48px padding |

| 改动的模板 | 关键变化 |
| --- | --- |
| `_layout.html` | 重写 token、所有公共组件（按钮、表单、徽章、表格、分页、工具栏） |
| `user/activation.html` | 极简登陆页风格 + **右上角「管理员登录」入口**（解决你截图反映的问题） + 顶部 brand bar + 底部 © 行 |
| `user/activation_success.html` | 大号「剩余 N 天」徽章 + 4 段 kv 信息 + 顶部品牌栏 |
| `admin/_layout.html` | 侧边栏改浅灰、品牌 logo、导航高亮态、底部用户卡 + 退出按钮、加「用户激活页 ↗」直达 |
| `admin/login.html` | 居中卡片 + 「← 返回激活页」浮动入口 + 用户名带 autocomplete |
| `admin/dashboard.html` | 6 stat 卡 + 最近 10 条激活记录表 + 顶部快捷跳转 |
| `admin/cards.html` | **激活码生成表单：预设按钮 1/3/7/30/90/180/365/永久 + 自定义数字 + 天/小时单位切换**；**「延长」从写死 +30 改为可填任意天数（含负数缩短）** |
| `admin/users.html` | 表格简洁版，右对齐操作列 |
| `admin/user_detail.html` | 4 段：基础信息卡片 / 绑定激活码 / 插件设备绑定 / 最近 20 条激活记录 |
| `admin/activations.html` | 状态徽章规范化 |
| `admin/_pagination.html` | 加箭头、当前页高亮黑色 |

### 1.2 修复的功能性问题

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| F-1 | 用户激活页**没有任何指向管理员后台的入口**，普通用户无法发现 | 右上角加`管理员登录`按钮，激活成功页同步 |
| F-2 | 生成表单只有一个固定数字框，没有预设、单位不友好 | 加 8 个预设按钮 + 数字 + 单位（天/小时）切换；hidden field 始终按"天"提交给后端，无需后端改动 |
| F-3 | 激活码表格"延长"按钮写死 `+30 天` | 改为 input 自由填写（含负值缩短），范围 [-365, 3650] |
| F-4 | 后台缺少"用户激活页"快捷入口 | 侧边栏加 `用户激活页 ↗`，在新标签打开 |
| F-5 | 登录页风格与主站不一致 | 用同一套设计 token 重做，加返回激活页入口 |

## 2. 全链路测试执行明细

### 2.1 测试覆盖矩阵

| # | 用例 | 实测 |
| --- | --- | --- |
| **管理员登录** | POST `/admin/login` → 200 | ✅ |
|  | GET `/admin/` 已登录态含「仪表盘」 | ✅ |
| **后台生成 4 种时长卡** | 30 天 `unlimited` | ✅ HTTP 200 |
|  | 1 天 `daypass` | ✅ HTTP 200 |
|  | 7 天 `limited` | ✅ HTTP 200 |
|  | 3650 天 `unlimited`（永久） | ✅ HTTP 200 |
|  | DB 校验拿到 4 张刚生成的卡 key | ✅ |
| **用户激活 30 天卡** | 首次激活 → `ok_new` + `success:true` + `remaining_days:30` | ✅ |
|  | 同卡同邮箱再激活 → `ok_idempotent` | ✅ |
|  | 同卡换邮箱 → `card_bound_other_email` | ✅ |
|  | 不存在的卡 → `card_not_found` | ✅ |
|  | 非法邮箱 → `bad_email` | ✅ |
| **后台查看刚激活的卡** | 激活码列表查到（含邮箱 + 已激活徽章） | ✅ |
|  | 用户列表查到 | ✅ |
|  | 用户详情含 30 天卡 + 邮箱 | ✅ |
|  | 激活记录列表查到 | ✅ |
| **插件 4 个接口** | GET `/api/plugin/card-keys/client-config` 含 `plugin_announcement_md` + `updated_at` | ✅ |
|  | POST `/activate` 首次绑定 → `success:true` | ✅ |
|  | POST `/status` 同 `client_id` → `success:true` | ✅ |
|  | POST `/status` 换 `client_id` → `device_mismatch` | ✅ |
|  | POST `/rebind` 换绑到新 `client_id` → `success:true` | ✅ |
|  | rebind 之后 `/status` 用新 `client_id` → `success:true` | ✅ |
|  | `/status` 用错邮箱 → `card_bound_other_email` | ✅ |
| **过期判断** | 把 CARD7 改成 `expires_at = now() - 1h`，`/status` → `card_expired` | ✅ |
|  | `/activate` 过期卡 → `card_expired` | ✅ |
|  | `/api/activation/redeem` 过期卡 → `card_expired` | ✅ |
| **禁用判断** | 后台禁用 CARD1 → 302 重定向 | ✅ |
|  | `/status` 禁用卡 → `card_disabled` | ✅ |
|  | `/api/activation/redeem` 禁用卡 → `card_disabled` | ✅ |
| **未激活判断** | `/status` 用未激活的 CARD3650 → `card_not_activated` | ✅ |
| **后台调整有效期** | CARD7 +10 天 → `/activate` 重新 `success:true`（过期判断已失效） | ✅ |
|  | CARD30 -50 天 → `/status` 回到 `card_expired` | ✅ |
|  | CARD30 +60 天 → `/status` 恢复 `success:true` | ✅ |
| **数据清理** | 4 张测试卡删除 | ✅ 残留 0 |
|  | 测试 member 删除 | ✅ 残留 0 |
|  | 激活记录、设备绑定、换绑日志删除 | ✅ 残留 0 |

### 2.2 总分

```
PASS = 44
FAIL = 0
```

### 2.3 页面渲染关键文案校验（已登录态访问真实页面）

| 页面 | HTTP | 关键文案命中情况 |
| --- | --- | --- |
| `https://seat.20050225.xyz/` 用户激活页 | 200 | ✓「激活你的卡密」✓「立即激活」✓「管理员登录」✓「cardkey · activation」✓「© cardkey · 简单、安全、本地权威」|
| `/admin/login` 管理员登录 | 200 | ✓「管理员登录」✓「cardkey-admin · 激活码管理后台」✓「返回激活页」✓「请输入用户名」✓「请输入密码」|
| `/admin/` 仪表盘 | 200 | ✓「仪表盘」✓「概览」✓「最近 10 条激活记录」✓「总激活码」✓「已激活」✓「未激活」|
| `/admin/cards` 激活码列表 | 200 | ✓「批量生成激活码」✓「自定义有效期」✓「永久」✓「365 天」✓「标准卡」✓「日抛卡」|
| `/admin/users` 用户列表 | 200 | ✓「按邮箱搜索」✓「绑定激活码数」✓「首次加入」|
| `/admin/activations` 激活记录 | 200 | ✓「按邮箱或激活码搜索」✓「全部状态」✓「全部来源」|

## 3. 真实接口响应样例

**用户激活 30 天卡**

```json
{
  "data": {
    "authorized": true,
    "card_type": "unlimited",
    "expires_at": "2026-06-17T20:07:42.738540",
    "newly_activated": true,
    "reason_code": "ok_new",
    "remaining_days": 30,
    "remaining_hours": 720,
    "status": "active"
  },
  "message": "激活成功",
  "success": true
}
```

**插件 activate 首次绑定**

```json
{
  "data": {
    "authorized": true,
    "card_type": "unlimited",
    "expires_at": "2026-06-17T20:07:42.738540",
    "remaining_days": 30,
    "remaining_hours": 720,
    "status": "active"
  },
  "message": "插件授权通过",
  "success": true
}
```

**过期卡触发 card_expired**

```json
{
  "data": {
    "authorized": false,
    "can_rebind": false,
    "card_type": "limited",
    "expires_at": "2026-05-18T19:07:44.751517",
    "reason_code": "card_expired",
    "remaining_days": 0,
    "remaining_hours": 0,
    "status": "active"
  },
  "message": "激活码已过期",
  "success": false
}
```

**禁用卡触发 card_disabled**

```json
{
  "data": {
    "authorized": false,
    "can_rebind": false,
    "card_type": "daypass",
    "expires_at": "2026-05-19T20:07:45.261973",
    "reason_code": "card_disabled",
    "remaining_days": 1,
    "remaining_hours": 24,
    "status": "disabled"
  },
  "message": "激活码已被禁用",
  "success": false
}
```

## 4. 时间校验逻辑确认

插件激活时间判断在两层兜底，**不存在任何一处仅依靠定时任务刷状态**：

1. **`ActivationService.redeem()`** 中先按 `card.status == EXPIRED` 拒绝，然后 `card.is_expired` 做实时比较：如果数据库里 status 还是 `active` 但实际已过期，会**就地强制把 status 写回 `expired`** 再拒绝。来源：`cardkey-admin/app/services/activation_service.py` 第 124–137 行。
2. **`/api/plugin/card-keys/status`** 独立判断 `card.is_expired or card.status == EXPIRED`，直接返回 `card_expired`。来源：`cardkey-admin/app/api/plugin_card_keys.py` 第 245–246 行。
3. **`/api/plugin/card-keys/activate`** 内部走 1) 的逻辑（通过 `_ensure_card_activated → redeem`），同样命中 `card_expired`。
4. **`/api/plugin/card-keys/rebind`** 也独立判断（第 283–284 行）。

`card.is_expired` 是模型属性，实时比较：

```115:121:cardkey-admin/app/models/card_key.py
def bind_to_member(self, member: "Member") -> None:
    now = china_now()
    self.member_id = member.id
    self.member = member
    self.bound_at = now
    self.status = CardKeyStatus.ACTIVE
    if self.first_activated_at is None:
        self.first_activated_at = now
        self.expires_at = now + timedelta(days=int(self.validity_days or 30))
```

```90:93:cardkey-admin/app/models/card_key.py
@property
def is_expired(self) -> bool:
    expires_at = as_china_naive(self.expires_at)
    return expires_at is not None and china_now() > expires_at
```

含义：用户**首次激活时**才开始计时（`expires_at = first_activated_at + validity_days`），未激活的卡放着不会过期。这是符合直觉的行为，已在第 6 项测试中端到端验证：CARD3650 没有激活时 `/status` 返回 `card_not_activated` 而不是 `card_expired`。

## 5. 管理员自定义激活码时长能力

- 生成时：1–3650 天，UI 提供 1/3/7/30/90/180/365/永久 8 个预设 + 自由输入 + 天/小时单位切换（小时会按 ceil 换算成天）
- 调整时：在激活码列表行内 input，可填 -365 到 3650 任意值（负值用于缩短/即时让卡密失效）
- 类型与时长解耦：日抛卡只是"类型标签"，实际是否过期完全按 expires_at 判断
- 调整后状态会自动同步：原 `expired` 的卡延长后状态自动变 `active`，反之 `active` 缩短到过去则自动变 `expired`

## 6. 当前部署快照

| 项目 | 端口 | 入口 |
| --- | --- | --- |
| cardkey-admin（新前端 + 激活页 + 后台 + 4 插件接口） | 8810 | `https://seat.20050225.xyz/` |
| seatpool-web（原后端，IP 直连） | 8000 | `http://154.12.94.197/` |
| cardkey-only（最小版，备用） | 8801 | 仅本机 |
| PostgreSQL `seatpool_prod` | 5432 | 三个 app 共享，schema 兼容 |

模板分发使用 `gunicorn HUP` 平滑重载，无连接中断，过程见 [`scripts/sync-templates-and-reload.sh`](../scripts/sync-templates-and-reload.sh)。

## 7. 仍待你拍板的下一步

| 项 | 状态 | 建议 |
| --- | --- | --- |
| systemd 化 cardkey-admin | 当前仍是 nohup，重启服务器会丢 | 用 `cardkey-admin.service` 单元接管，单元体已写在 `cardkey-admin/DEPLOY_STATUS.md` |
| 改 admin 默认密码 | 仍为 `<ADMIN_PASSWORD>` | 浏览器登录 `https://seat.20050225.xyz/admin/login` 用 `flask create-admin admin <新密码>` 重置 |
| 下线 cardkey-only (8801) | 仍在跑 | cardkey-admin 稳定 1–2 周后即可下线，腾出 8801 端口 |
| 监控 / 报警 | 暂无 | 可后续加 healthz 探活到云监控 |

## 8. 一句话回滚

如果新前端出任何问题：

```bash
# 1) 模板回滚（最近的备份是 templates_backup_20260518_200301.tgz）
sudo rm -rf /opt/cardkey-admin/app/templates
sudo tar -xzf /opt/cardkey-admin/templates_backup_20260518_200301.tgz -C /opt/cardkey-admin/app
sudo kill -HUP "$(cat /opt/cardkey-admin/server.pid)"

# 2) 整域名回滚到 seatpool-web（极端情况）
sudo cp /etc/nginx/sites-available/seatpool.bak_20260518_192849 /etc/nginx/sites-available/seatpool \
  && sudo nginx -t && sudo systemctl reload nginx
```
