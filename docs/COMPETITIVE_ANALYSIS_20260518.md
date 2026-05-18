# ChatGPT 保存助手 · 竞品对比与升级路线

- 调研时间：2026-05-18
- 我方产品：`ChatGPT 对话保存助手 v2.0.1`（项目代号 `chat-massage`）
- 已部署后端：`https://seat.20050225.xyz`（cardkey-admin）

## 一、本项目能力盘点（深度分析）

> 数据源：`manifest.json` + `PROJECT_OVERVIEW.md` + `src/utils/*` + `src/content/*` 实际代码

### 1. 核心能力

| # | 能力 | 实现 | 备注 |
| - | - | - | - |
| C1 | 多格式导出 | HTML / Markdown / PDF / JSON 同时落盘 | 4 个 exporter 互独立 |
| C2 | **自动保存** | `MutationObserver` + URL 监听，对话变化时防抖 2s 自动写盘 | **业界独家**，下面会展开 |
| C3 | **本地目录授权** | File System Access API 把对话直接写入用户选的本地文件夹 | **业界独家** |
| C4 | 附件采集 | `uploads/`（用户上传）+ `generated/`（GPT 生成）+ `context/`（上下文 JSON） | 通过 MAIN world 拦截 fetch 抓取 |
| C5 | **上下文延续** | 把保存过的对话作为上下文重新喂回 ChatGPT 继续聊 | **业界独家** |
| C6 | 模型用量统计 | 跟踪 GPT-5 / Pro / Thinking 等 quota | UsageMonitor 解析 ChatGPT API 响应 |
| C7 | **卡密激活付费体系** | `seat.20050225.xyz` 后端 + cardkey-admin 后台 | **业界独家**（国内场景） |
| C8 | 自研 PDF v2 | AST → renderer → Worker 渲染管线 | 长对话自动切片 |
| C9 | 选择性导出 | SelectionManager 支持单选 + Shift 多选 | 与头部竞品持平 |
| C10 | 提示模板 | 自定义 prompt 模板（免费版限 2 个） | 配额由 FeatureQuotaManager 控制 |
| C11 | 远程公告/升级配置 | `/api/plugin/card-keys/client-config` | 6 小时刷新 |

### 2. 当前不足（深度扫描代码后发现）

| # | 缺陷 | 证据 |
| - | - | - |
| G1 | **不支持 Canvas / Deep Research / Web Search / Thought Process 等高级消息类型** | `parser.js` grep 后只发现 `thinking`/`streaming` 状态字段，没有 Canvas / 来源链接 / 推理步骤的解析逻辑 |
| G2 | **只支持 ChatGPT 单家平台** | `manifest.json` host 只有 `chatgpt.com` + `chat.openai.com`；竞品普遍 10+ 平台 |
| G3 | **没有批量/全量导出** | popup 里只有「立即导出当前对话」，没有"导出全部对话/侧边栏批量"按钮 |
| G4 | **没有 Notion / Obsidian / 飞书 / 语雀 同步** | grep 全项目无相关代码 |
| G5 | **PDF 自定义粒度不如头部竞品** | ChatGPT 导出器（v6.3.0）开放 18 项 PDF 设置（页码、目录、CJK 字体、字体族、字体大小、Deep Research/Web Search 是否包含、思维过程是否包含等），本项目 PDF v2 配置面相对窄 |
| G6 | **没有云搜索 / 全文检索** | 有 `searchIndex.js` 但只是本地索引模块，没有"在所有历史对话里搜关键词跳转"的 UI 入口 |
| G7 | **没有团队协作 / 共享** | 单设备绑定，可换绑但不可"团队同享一张卡" |
| G8 | **PDF 转换需要内置 jspdf + html2canvas，扩展体积偏大** | manifest 注入了 6 个第三方 lib |
| G9 | **不支持其它语言界面** | i18n 文件不存在，UI 仅中文 |
| G10 | **没有移动端 / Edge / Firefox 兼容声明** | Chrome Web Store 提交说明只声明 Chrome |

## 二、竞品扫描（2026-05 数据）

> 数据源：Chrome Web Store + 各官网 + 头部对比站

### 2.1 头部 5 个竞品快照

| 竞品 | 用户数 | 评分 | 核心卖点 | 商业模式 |
| - | - | - | - | - |
| **ChatGPT 导出器**（Mark Zhao） | 100,000+ | 4.8 ⭐ (1603) | 18 项 PDF 设置 / Canvas / Deep Research / 选择性导出 / 群聊导出 / 34 种语言 | 免费 + PDF 每日 3 次免费，其他付费 |
| **AI Exporter**（Save to PDF/Word/MD/Notion） | 90,000+ | 4.8 ⭐ | **10+ AI 平台**（ChatGPT/Claude/Gemini/NotebookLM…）+ **Notion 同步** + 超长对话 | 免费 + 付费 |
| **ExportGPT** | 10,000+ | 3.4 ⭐ | 侧边栏按钮 + Markdown/PDF/HTML/Excel/截图 | 免费 + Pro |
| **AI Chats Exporter** | 906 | 4.6 ⭐ | **批量导出多 tab + 跨平台** + Notion/Obsidian | 主打 local-first |
| **GPT2Notes** | — | — | **Auto Sync**（监听对话变化自动同步到 Notion）+ batch | SaaS 订阅 |

### 2.2 关键能力交叉对比

| 能力 | 我方 | ChatGPT 导出器 | AI Exporter | ExportGPT | AI Chats Exporter | GPT2Notes |
| - | :-: | :-: | :-: | :-: | :-: | :-: |
| HTML 导出 | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Markdown 导出 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDF 导出 | ✅（自研 v2）| ✅（精雕细琢）| ✅ | ✅ | ✅ | — |
| JSON 导出 | ✅ | ✅ | ✅ | — | ❌ | ✅ |
| CSV 导出 | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| TXT 导出 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 截图导出 | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| 复制到剪贴板 | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **自动保存到本地** | ✅**独家** | ❌ | ❌ | ❌ | ❌ | ❌ |
| 自动同步到 Notion | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| 同步到 Obsidian | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **附件/生成文件保存** | ✅**独家** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **上下文延续** | ✅**独家** | ❌ | ❌ | ❌ | ❌ | ❌ |
| 批量/全量导出 | ❌ | ✅（选择性）| ✅ | ❌ | ✅（多 tab）| ✅ |
| 选择性消息导出 | ✅ | ✅ | — | — | — | — |
| 群聊导出 | ❌ | ✅ | — | — | — | — |
| Canvas 渲染 | ❌ | ✅ | — | — | — | — |
| Deep Research 引用 | ❌ | ✅ | — | — | — | — |
| Web Search 来源 | ❌ | ✅ | — | — | — | — |
| Thought Process 思维链 | ❌ | ✅ | — | — | — | — |
| 数学公式 / 代码 / 表格 | 部分 | ✅ | ✅ | ✅ | ✅ | ✅ |
| **多 AI 平台** | ❌（仅 ChatGPT） | ❌（仅 ChatGPT） | ✅（10+） | ❌ | ✅（4+） | ❌ |
| **卡密激活付费** | ✅**独家** | ❌ | ❌ | ❌ | ❌ | ❌ |
| 模型用量监控 | ✅**独家** | ❌ | ❌ | ❌ | ❌ | ❌ |
| 多语言 UI | ❌ | ✅（34） | ✅ | — | — | — |

## 三、SWOT 分析

### 优势（Strengths）

1. **本地优先 + 自动后台保存**：File System Access API 全程不上云，符合"我的数据我做主"原则。这是所有竞品都没有做透的方向（GPT2Notes/Auto Sync 同步到 Notion，但仍是云）
2. **附件 + 上下文 + 主对话三件套保全**：竞品基本只保存对话文本，本项目把附件、生成文件、上下文 JSON 一并落盘
3. **上下文延续是杀手锏**：把昨天的对话直接喂回 ChatGPT 续聊，这事别家完全没做
4. **完整的商业基础设施已经就绪**：卡密激活 + 后台管理 + 状态校验 + 换绑 全链路已经端到端跑通，无需再造
5. **PDF 渲染自研 AST 管线**：长对话切片、CJK 字体内嵌、不依赖第三方 SaaS

### 劣势（Weaknesses）

1. **品类内容覆盖度落后**：Canvas / Deep Research / Web Search / Thought Process 都没解析，PDF 在长对话之外的极致打磨也不够
2. **平台覆盖太窄**：只 ChatGPT，错过 Claude / Gemini / DeepSeek / Grok 等大流量
3. **批量导出缺失**：无法一键导出历史全部对话，对从其它工具迁来的用户体验不友好
4. **UI 入口少**：popup 只有"导出当前对话"，没有侧边栏按钮、没有右键菜单、没有快捷键
5. **没有云端备份后路**：极端情况下本地文件被删就真没了

### 机会（Opportunities）

1. **国内市场对"卡密激活"高度友好**，海外竞品几乎都是 SaaS 月费，国内用户付费意愿低；卡密 1 次买断更对路
2. **企业/团队场景**：合规要求"对话不能上 Notion / 不能出公司网"的客户群体，恰好需要本地保存
3. **教育 / 律师 / 医生场景**：自动保存 + 附件齐全 + 本地权威是刚需
4. **Cursor / Claude / Gemini 三家也是同样形态**：能复用 80% 代码扩到其它平台
5. **MCP / API 化**：把本地保存的对话/附件二次开发成可被 AI 检索的本地知识库

### 威胁（Threats）

1. **ChatGPT 导出器**用户数 100k，势能远大于我方，他们若做"自动保存本地"会直接侵蚀
2. **OpenAI 官方"Data Export"功能** 会越做越强，导出能力被官方原生覆盖是中长期风险
3. **MV3 政策**收紧：File System Access API、`world: "MAIN"` 注入未来都可能被限
4. **付费模式认知度低**：海外用户看到"激活码"会怀疑是盗版渠道
5. **AI 平台 DOM 频繁变更**：parser 维护成本高，没多平台覆盖时单点风险大

## 四、升级路线建议（按优先级）

### P0 · 不立即做就会被竞品反超

| 编号 | 升级项 | 工作量 | 收益 | 备注 |
| - | - | - | - | - |
| P0-1 | 解析 Canvas / Deep Research / Web Search / Thought Process | 2-3 天 | 拉齐 ChatGPT 导出器特性，避免长尾用户流失 | 改 `parser.js`，加 4 个新消息类型 |
| P0-2 | 批量导出 / 全量导出全部历史对话 | 2 天 | 用户首次使用就把全历史拿到手，留存大幅提升 | 调 ChatGPT `/backend-api/conversations` 列表 API，循环导出，加进度条 |
| P0-3 | 复制到剪贴板（Markdown / 富文本） | 0.5 天 | 用户期望最频繁的小功能 | 在 popup 加按钮 + content 注入消息行按钮 |
| P0-4 | 侧边栏导出按钮 / 右键菜单 / 键盘快捷键（Ctrl+S） | 1 天 | 入口可见度 ×10 | 多入口收口到一个 `triggerExport()` |

### P1 · 显著扩大用户盘

| 编号 | 升级项 | 工作量 | 收益 | 备注 |
| - | - | - | - | - |
| P1-1 | 扩展支持 Claude / Gemini / DeepSeek | 3-5 天/平台 | 海外用户盘扩 3 倍 | parser 接口抽象，多个 host_permissions |
| P1-2 | i18n 多语言（en / ja / ko / ru / es） | 1-2 天 | Chrome Web Store 海外曝光显著上升 | 资源文件 + popup 切语言 |
| P1-3 | 同步到 Notion / Obsidian / Logseq | 3-5 天 | 把"本地优先"扩到"本地 + 选定云"，竞争维度齐了 | OAuth + 一段 markdown 写入 API |
| P1-4 | PDF 自定义粒度（页码 / 目录 / 字体族 / Token 统计 / 时间戳显隐 / 主题色） | 2-3 天 | 与 ChatGPT 导出器拉齐 | 在 popup 加设置面板 |

### P2 · 提升商业化深度

| 编号 | 升级项 | 工作量 | 收益 | 备注 |
| - | - | - | - | - |
| P2-1 | **后台「卡密商城」前台页面**（用户在 `seat.20050225.xyz` 直接付款拿卡） | 5-7 天 | 卡密销售自助化，不再依赖外部渠道 | 接微信/支付宝/Stripe |
| P2-2 | **企业版**：一张企业卡支持 N 设备 / 团队管理 | 3-5 天 | 客单价提升 5-10 倍 | cardkey-admin 加 team_keys 表 |
| P2-3 | **激活码后台「使用统计」**：每天激活/活跃/复检趋势图 | 2 天 | 销售决策依据 | dashboard 加几张图表 |
| P2-4 | **续费卡**：现有卡可续期不换号 | 2 天 | 用户粘性 ×2 | cardkey-server 端已经预留 `card_purpose=renewal` 字段 |

### P3 · 差异化护城河

| 编号 | 升级项 | 工作量 | 收益 | 备注 |
| - | - | - | - | - |
| P3-1 | **本地知识库索引**：把所有保存的对话 + 附件做向量化，本地全文搜 | 7-10 天 | 真正的"我的 ChatGPT 历史长记忆" | 用 `transformers.js` 在浏览器跑 embedding |
| P3-2 | **导出包再被 ChatGPT 引用**（已有上下文延续，扩成"上下文搜索 + 推荐"） | 5 天 | 把"保存"升级为"我的知识助手" | 在续聊时按相似度自动选 N 段历史 |
| P3-3 | **MCP Server 化**：把本地保存目录暴露为 MCP，给 Cursor / Claude Desktop 当数据源 | 3-5 天 | 与新生态绑定 | 用 Node 写个 stdio server |
| P3-4 | **加密压缩归档**：长期不用的对话自动归档为加密 zip | 2 天 | 用户硬盘友好 | 用 Web Crypto 做 AES-GCM |

## 五、推荐的「下两周」组合

> 一句话：拉齐基本功 + 拿下 1 个差异化招牌

- **第 1 周**：P0-1（高级消息类型）+ P0-2（批量导出）+ P0-3（剪贴板）
- **第 2 周**：P1-3（Notion 同步）+ P2-1（后台卡密商城前台原型）

理由：

1. P0-1 + P0-2 + P0-3 直接对齐 ChatGPT 导出器；
2. P1-3 是被问得最多的能力，做完同时也补齐"本地 + 云"两条腿；
3. P2-1 把商业基础设施变成销售自助渠道，是把"已经做完的卡密后台"变成现金流的关键最后一公里。

## 六、待你决策的问题

1. 是先扩平台（Claude/Gemini/DeepSeek）还是先补深度（Canvas/Deep Research）？
2. Notion 同步要不要做？做的话希望走 Notion 官方 OAuth 还是用户自己粘 API key？
3. 「卡密商城前台」要不要做？还是继续靠外部渠道分发卡？
4. 企业版（团队卡）有没有客户在问？
5. 多语言 i18n 优先级？（影响 Chrome Web Store 海外曝光，但工作量小）
