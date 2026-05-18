# cardkey-server

只承载 ChatGPT 对话保存助手插件四个接口的最小 Flask 后端。

```
POST /api/plugin/card-keys/activate
POST /api/plugin/card-keys/status
POST /api/plugin/card-keys/rebind
GET  /api/plugin/card-keys/client-config
```

剥离自 `/seatpool` 完整业务后端，**不带**任何邀请、空间、代理池、邮箱 OTP、Celery 等业务。
默认连原 PostgreSQL 库 `seatpool_prod` 同表同字段，**只读 + 写 plugin 相关表**，不污染其它业务数据。

## 与原服务的差异

- **去掉了跨站权威转发**：`PLUGIN_REMOTE_ENABLED` 与 `UnifiedActivationService` 整体移除。原始接口在校验时会尝试调上游 `https://seat.luming.cv` 做权威校验，本精简版直接以本地 DB 为权威。
- **去掉了 Member 完整模型**：插件流程只读 `member.email` 一个字段，本版本 `Member` 只声明 `id + email` 两列。
- `**SiteConfig` 表只暴露公告与升级链接两个 key**，其它无关 KEY 常量删掉。
- 业务行为（请求/响应字段、错误码文案、绑定/换绑事务）和原服务保持一致，不需要改插件代码。

## 运行

### 本地

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # 填 DATABASE_URL
python wsgi.py        # 调试用
```

### 生产

```bash
gunicorn -w 1 -k gthread --threads 4 --timeout 60 \
  -b 127.0.0.1:8801 'app:create_app()'
```

systemd 模板见 [deploy/cardkey-only.service.example](deploy/cardkey-only.service.example)。
nginx 灰度配置见 [deploy/nginx-cardkey-only.example.conf](deploy/nginx-cardkey-only.example.conf)。

## 验证

```bash
curl -s http://127.0.0.1:8801/api/plugin/card-keys/client-config | head
curl -s -X POST http://127.0.0.1:8801/api/plugin/card-keys/status \
  -H 'Content-Type: application/json' \
  -d '{"card_key":"PROBE","email":"a@b.com","client_id":"dev"}'
```

