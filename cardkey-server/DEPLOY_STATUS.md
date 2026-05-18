# 部署状态

## 当前已部署

- 服务器：`154.12.94.197` (Debian 12)
- 路径：`/opt/cardkey-only/`
- 进程：gunicorn，监听 `127.0.0.1:8801`
- 启动方式：**临时 `nohup` 模式**，PID 在 `/opt/cardkey-only/server.pid`
- 日志：`/opt/cardkey-only/server.log`
- DB：复用 `seatpool_prod`（同表同字段）
- nginx：**未动**，原 `seat.20050225.xyz` 仍由 `/seatpool` 服务承接

## 已完成的冒烟测试


| 项目                                          | 结果                                              |
| ------------------------------------------- | ----------------------------------------------- |
| `GET /healthz`                              | 200 `{"ok":true}`                               |
| `GET /api/plugin/card-keys/client-config`   | 200 返回公告 + 升级链接                                 |
| `POST /api/plugin/card-keys/status` 用不存在卡密  | 200 `success:false, reason_code:card_not_found` |
| `POST /api/plugin/card-keys/activate` 用非法邮箱 | 200 `success:false, message:邮箱格式不正确`            |
| **真实卡密 status 两端等价性对比**                     | **success/message/data 字段全部一致**                 |


## 还没做（需要你确认才会执行）

### 1. 把 cardkey-only 注册成 systemd 服务（让重启不丢失）

```bash
sudo cp /opt/cardkey-only/deploy/cardkey-only.service.example /etc/systemd/system/cardkey-only.service
# 编辑前确认 ExecStart 和 .env 路径
sudo systemctl daemon-reload
# 先把 nohup 实例停掉再启 systemd 单元
sudo kill "$(cat /opt/cardkey-only/server.pid)" 2>/dev/null || true
sudo systemctl enable --now cardkey-only.service
sudo systemctl status cardkey-only.service
```

### 2. nginx 切流量（**等你点头才会做**）

两份配置 diff 见 `[deploy/nginx-cardkey-only.example.conf](deploy/nginx-cardkey-only.example.conf)`：

- **方案 A 路径级灰度（推荐）**：仅把 `location ^~ /api/plugin/card-keys/` 转给 8801，原服务其它路径不动
- **方案 B 整 server block 切换**：seat.20050225.xyz 全部走 8801

切流量步骤（以方案 A 为例）：

```bash
sudo cp /etc/nginx/sites-enabled/seat.20050225.xyz.conf /etc/nginx/sites-enabled/seat.20050225.xyz.conf.bak.$(date +%s)
sudo vi /etc/nginx/sites-enabled/seat.20050225.xyz.conf   # 加入 location ^~ /api/plugin/card-keys/
sudo nginx -t
sudo systemctl reload nginx
```

**回滚一句话**：

```bash
sudo cp /etc/nginx/sites-enabled/seat.20050225.xyz.conf.bak.<ts> /etc/nginx/sites-enabled/seat.20050225.xyz.conf && sudo nginx -t && sudo systemctl reload nginx
```

## 重要：原服务一直在跑

精简版**没有**取代原服务，原 seatpool gunicorn 仍然占用 8000 端口、`seat.20050225.xyz` 仍指向它。切流量是单独一步、可秒级回滚。