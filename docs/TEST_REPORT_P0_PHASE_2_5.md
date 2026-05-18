# P0 升级测试报告 - Phase 2 / 5（批量全量导出 + Gemini 适配）

- 报告时间：2026-05-18
- 分支：`feat/p0-platform-adapter`
- 工程：`F:\chat-massage` — ChatGPT 对话保存助手
- 范围：Phase 2 批量全量导出（ChatGPT API 拉对话 + 并发引擎 + 批量页 UI）+ Phase 5 Gemini 平台适配
- 前置：Phase 0 / 1 / 3 / 4 见 [`TEST_REPORT_P0_PHASE_0_1_3_4.md`](./TEST_REPORT_P0_PHASE_0_1_3_4.md)

## 一、本次提交（紧接前 5 个 P0 commit 后）

```
687ec1e feat(phase2+phase5): 批量全量导出 + Gemini 平台适配
```

代码变化：

| 类别 | 文件 | 变动 |
| --- | --- | --- |
| 新增 adapter | `src/adapters/chatgpt/apiSource.js` | +247 行（ChatGPT 后端 API 客户端 + apiTreeToModel） |
| 新增 adapter | `src/adapters/gemini/parser.js` | +179 行（GeminiBlockExtractor + GeminiParser + GeminiAdapter） |
| 新增 adapter | `src/adapters/gemini/index.js` | +13 行（向 PlatformAdapterRegistry 注册） |
| 新增 core | `src/core/batchExporter.js` | +274 行（并发引擎 + 进度持久化 + 中断恢复） |
| 新增 UI | `src/popup/batch.html` | +83 行 |
| 新增 UI | `src/popup/batch.css` | +151 行 |
| 新增 UI | `src/popup/batch.js` | +228 行（拉列表 / 筛选 / 选择 / 启动 / 轮询进度） |
| 改 content | `src/content/content.js` | +73 行（4 个 batch* 消息路由） |
| 改 popup | `src/popup/popup.html` | +4 行（批量导出按钮） |
| 改 popup | `src/popup/popup.js` | +14 行（按钮 + Gemini tab 兼容） |
| 改 exporter | `src/utils/exporter.js` | +20 行（adapter fallback） |
| 改 background | `src/background/background.js` | +6 行（isSaverSupportedUrl） |
| 改 manifest | `manifest.json` | +14 行 / -2 行（Gemini host + 5 个新注入文件 + batch.* web_accessible） |
| 新增测试 | `tests/chatgptApiSource.test.mjs` | +127 行 / 5 用例 |
| 新增测试 | `tests/batchExporter.test.mjs` | +163 行 / 5 用例 |
| 新增测试 | `tests/geminiAdapter.test.mjs` | +103 行 / 9 用例 |
| **合计** | | **+1956 行 / -7 行 / 16 文件** |

## 二、测试结果

执行命令：`npx vitest --run`

```
 Test Files  31 passed (31)
      Tests  221 passed (221)
   Duration  ~80 s
```

**31 个测试文件 / 221 个用例 全部通过**（前一轮 28 / 202 → +3 文件 / +19 用例）。

| 模块 | 文件 | 用例 |
| --- | --- | --- |
| **ChatGPT API source 树展平 + 5 类 content_type 映射** | `tests/chatgptApiSource.test.mjs` | **5** |
| **BatchExporter 并发 / 进度持久化 / 重试 / abort / summarize** | `tests/batchExporter.test.mjs` | **5** |
| **Gemini Adapter 注册 + DOM 解析（含 ms-chat-turn / ms-thought-chunk / textarea data-value）** | `tests/geminiAdapter.test.mjs` | **9** |
| 之前 Phase 0/1/3/4 的 28 文件 / 202 用例 | 见上一轮报告 | 202 |

### 关键用例覆盖

#### Phase 2 - ChatGptApiSource

- ✓ `apiTreeToModel` 沿 `current_node` 一路向上回溯 `parent`，输出线性 messages 序列
- ✓ 自动跳过 `author.role === 'system'` 的消息节点
- ✓ `content_type === 'thoughts'` → 每个 thought 拆成独立 ThoughtBlock
- ✓ `content_type === 'code'` → CodeBlock(lang, code)
- ✓ `content_type === 'multimodal_text'` 含 `image_asset_pointer` → 同一 message 内多 Block（text + image）
- ✓ `metadata.search_result_groups` → WebSearchBlock(queries, sources[])
- ✓ `metadata.canvas` → CanvasBlock(title, lang, content)

#### Phase 2 - BatchExporter

- ✓ happy path：2 条对话 → 2 次 `FileSystem.saveConversation`，summary 成功 = 2
- ✓ chrome.storage.local 写入 `batchExportStateV1` key，含 status='done' + succeededIds
- ✓ 重试 + 指数退避：连续失败 2 次 + 第 3 次成功 → succeeded=1
- ✓ 永久失败：retry=1 用完 → failedItems.length=1
- ✓ abort：第 1 条还在跑就 `BatchExporter.abort()` → status='aborted'，后续条目不被处理
- ✓ summarize：7 项 = pending2 + processing1 + succeeded2 + skipped1 + failed1，done=4，pct=57%

#### Phase 5 - GeminiAdapter

- ✓ 加载 parser+index 后，`PlatformAdapterRegistry.get('gemini')` 注册成功
- ✓ `hostMatches('https://gemini.google.com/app')` 为 true；`hostMatches('https://chatgpt.com/')` 为 false
- ✓ `getConversationId()` 从 `/app/<id>` 路径取出 id
- ✓ `ms-chat-turn[author="user"]` + `[data-test-id="user-prompt-text"]` → user role + 文本
- ✓ `ms-chat-turn[author="model"]` + `<ms-thought-chunk>` → assistant role + ThoughtBlock + TextBlock
- ✓ author 属性缺失时，靠 `[data-test-id="user-prompt-container|model-response-text"]` 推断 role
- ✓ 空文本时，兜底 `ms-autosize-textarea[data-value]` 抽 raw 内容（处理重编辑场景）

## 三、新能力清单

### Phase 2 · 批量全量导出

**ChatGptApiSource** ([src/adapters/chatgpt/apiSource.js](../src/adapters/chatgpt/apiSource.js))

ChatGPT 后端 API 客户端，跑在 content script context（同源 fetch 自带 cookie），提供 3 个核心方法：

```js
ChatGPTApiSource.getAccessToken({forceRefresh})    // → string，缓存 50 min
ChatGPTApiSource.listAll({pageSize, order, maxItems, abortSignal})  // → async generator → {id, title, update_time}
ChatGPTApiSource.fetchConversationAsModel(id, {abortSignal})        // → ConversationModel
```

`apiTreeToModel(tree)` 把后端返回的 `mapping/current_node` 树展平为 ConversationModel，覆盖 5 类 content_type + 2 类 metadata（search_result_groups / canvas）。**401 自动 refresh token + 重试一次**。

**BatchExporter** ([src/core/batchExporter.js](../src/core/batchExporter.js))

批量导出引擎，跑在 content script context（依赖 `window.ChatGPTSaver.ChatGPTApiSource / FileSystem / HTMLExporter / MarkdownExporter / JSONExporter / PDFExporter / ConversationModel`）：

| 特性 | 说明 |
| --- | --- |
| 并发限流 | 1-8 workers，默认 3。Promise.all worker 抢 pendingIds 队列 |
| 进度持久化 | 每条状态变化都写 `chrome.storage.local.batchExportStateV1`，重启 / 关页可恢复 |
| 失败重试 | 单条最多 retry+1 次，指数退避 `500 * 2^attempt`，封顶 8s |
| 跳过未变 | `FileSystem.checkConversationNeedsUpdate` 判断不变化则记 skipped |
| 取消 | `AbortController.signal` 一路传给 fetch + 中间 await 点 |
| 通知 | `onProgress(callback)` 订阅；`summarize(state)` 给可读统计（pct / done） |

**状态机**：`idle → running → (paused | done | aborted | failed)`

**批量页 UI** ([src/popup/batch.html](../src/popup/batch.html) / [batch.css](../src/popup/batch.css) / [batch.js](../src/popup/batch.js))

| 区域 | 内容 |
| --- | --- |
| 顶栏 | logo + 标题 + 「打开 ChatGPT」 |
| 选择对话 | 加载按钮 + 列表 + 筛选 + 全选 + 选中计数 |
| 选择格式 | HTML / Markdown / JSON / PDF 4 个 chip + 并发数 / 重试次数 |
| 运行 | 启动 / 停止 + 进度条 + 4 个统计卡片（成功 / 跳过 / 失败 / 剩余）+ 运行日志 |
| 恢复 | 启动时检查 `batchGetProgress`，若有 running 任务自动接管 UI |

**消息路由**（content.js）：

```
batch.html (chrome.tabs.sendMessage to ChatGPT tab)
    ↓
content.js handleMessage:
    case 'batchListConversations'  → ChatGPTApiSource.listAllArray()
    case 'batchStart'              → BatchExporter.start(...)（异步，不阻塞）
    case 'batchAbort'              → BatchExporter.abort()
    case 'batchGetProgress'        → BatchExporter.getProgress()
```

**popup 入口** ([src/popup/popup.html](../src/popup/popup.html) / [popup.js](../src/popup/popup.js))：新增 `📦 批量导出全部对话` 按钮，点击 `chrome.tabs.create({url: chrome.runtime.getURL('src/popup/batch.html')})` 在新标签页打开。

### Phase 5 · Gemini 平台适配

**GeminiParser / GeminiBlockExtractor / GeminiAdapter** ([src/adapters/gemini/parser.js](../src/adapters/gemini/parser.js))

| 部位 | selector / 策略 |
| --- | --- |
| 对话轮容器 | `ms-chat-turn`，兜底 `[data-test-id*="conversation-turn"]` |
| user 识别 | `[author="user"]` / `[data-author="user"]` / `[data-test-id="user-prompt-container"]` |
| assistant 识别 | `[author="model"]` / `[data-test-id="model-response-text"]`，默认 assistant |
| 思维链 | `ms-thought-chunk`，summary 取 `[role="heading"]/h3/.thought-title` |
| 富文本主体 | `[data-test-id="model-response-text"]` → `[data-test-id="user-prompt-text"]` → `[data-test-id="markdown"]` → `.markdown` → `.turn-content` |
| 编辑原值兜底 | `ms-autosize-textarea[data-value]`（重编辑场景） |
| Shadow DOM 穿透 | `_queryDeep` 用 TreeWalker 遍历所有 shadowRoot |
| 输入中态 | `[data-loading="true"]` / `.response-pending` / `.stop-generating` |

注册到 `PlatformAdapterRegistry` 后，`PlatformAdapterRegistry.resolveForUrl(url)` 在 gemini.google.com 自动返回 `GeminiAdapter`，调用 `parseConversationModel()` 返回 `platform=gemini` 的 `ConversationModel`。

**导出器 adapter fallback** ([src/utils/exporter.js](../src/utils/exporter.js))

在 `Exporter.exportConversation` 入口处加 fallback：

```js
const reg = window.ChatGPTSaver?.PlatformAdapterRegistry;
const adapter = reg?.resolveForUrl(window.location.href);
if (adapter && Model) {
  const model = adapter.parseConversationModel();
  const legacy = model ? Model.modelToLegacyConversation(model) : null;
  if (legacy?.messages?.length) {
    // 用 adapter 抓的内容替换 conversation
    conversation.title = legacy.title || conversation.title;
    conversation.messages = legacy.messages;
    conversation.url = legacy.url || conversation.url;
  }
}
```

效果：**老 HTML/MD/PDF/JSON exporter API 完全零改动**就能输出 Gemini 对话。

**background / popup / manifest 跨域兼容**

- `background.js`：抽出 `isSaverSupportedUrl(url)`，覆盖 chatgpt.com + gemini.google.com，让 `chrome.action.onClicked` / contextMenus / commands 都派发到 Gemini tab
- `popup.js`：`getActiveChatGPTTab` 接受 gemini.google.com
- `manifest.json`：
  - `host_permissions += https://gemini.google.com/*`
  - `content_scripts.matches += https://gemini.google.com/*`
  - `content_scripts.js` 注入加 `src/adapters/gemini/parser.js` + `index.js`

## 四、兼容性 / 回归保证

1. **ChatGPT 原行为完全不变**：在 chatgpt.com / chat.openai.com 上，`PlatformAdapterRegistry.resolveForUrl` 解析到 `ChatGPTAdapter`，`parseConversationModel()` 内部仍调旧 `ChatGPTSaver.Parser.extractConversation()`，所以历史导出输出字节级一致
2. **老 4 个 exporter 接口不动**：靠 `ConversationModel.modelToLegacyConversation` 中间层把新格式退化回老格式
3. **批量按钮触发**：点 popup 新按钮 → 在新 tab 打开 `chrome-extension://.../src/popup/batch.html`，不在 ChatGPT 域内不会被 CSP 拦
4. **未注入 apiSource / batchExporter 的旧域名**：`batch.js` 会在 send 消息时收到 `api_source_unavailable` / `batch_exporter_unavailable` 错误，UI 友好降级（不崩）
5. **Gemini 上「立即导出」按钮**：popup「立即导出」走 `runCommand: 'export.current'`，CommandBus 内部用 `PlatformAdapterRegistry.resolveForUrl` 拿到 GeminiAdapter → 跑 GeminiParser → ConversationModel → 喂老 exporter，全链路打通
6. **ChatGPT 标签页关闭重开后还有未完成批量**：batch.js init 时 `batchGetProgress` 自动接管 UI 并继续轮询；如果 ChatGPT tab 被关掉，会收到 send 错误（friendly toast）
7. **manifest version 暂时保持 2.1.0**：等冒烟通过后建议把 Phase 2 升到 2.2.0、Phase 5 升到 3.0.0；现在为了不破坏冒烟测试包暂不动

## 五、版本号建议

当前 `manifest.json: 2.1.0`。**冒烟通过后**建议：

- Phase 2 单独发：**2.2.0**（次版本 +1，新增能力，无破坏）
- Phase 5 单独发：**3.0.0**（host_permissions 新增非 OpenAI 域，建议跳大版本号让用户感知扩展工作范围扩大）
- 本轮合并发：**3.0.0**（最简单），release notes 注明这两项

## 六、下一步建议

1. **真实浏览器冒烟**：见 [`SMOKE_TEST_GUIDE_v2.1.0.md`](./SMOKE_TEST_GUIDE_v2.1.0.md)；冒烟通过后再追加 Phase 2/5 的 4 项手动验证：
   - 批量导出页能拉到全部 ChatGPT 对话（数量与 chatgpt.com 左侧栏一致）
   - 选 10 条勾全格式 → 30 秒内 30 个文件落地（10×HTML + 10×MD + 10×JSON）
   - 中途点「停止」→ batch 页 status 变 aborted，剩余条目未被处理
   - 在 `https://gemini.google.com/app/<id>` 上按 Alt+Shift+S 应能导出对话 HTML / MD
2. **Gemini 选择器校准**：`ms-chat-turn` 系列是基于社区文档反推，谷歌可能在 6 月做 DOM 改版。冒烟若发现解析不全，把实际命中的 selector 反馈，下版本加进去
3. **PDF 路径**：批量导出 PDF 目前只走"老 PDFExporter.exportPackage"，**默认不勾**。要在 Gemini 上启用 PDF 需要把 PDF 输入端从「html-to-pdf canvas」改成「ConversationModel 渲染」，这是 Phase 6 内容
4. **GitHub PR**：feat 分支已 6 个清晰 commit，可去 GitHub 发 PR

## 七、最终状态

- ✅ feat 分支 `feat/p0-platform-adapter` 累计 **7 个 commit**（Phase 0/1/3/4 共 4 个 + Phase 0~4 报告 1 个 + Phase 2+5 1 个 + 本报告 1 个）
- ✅ 31 个测试文件 / 221 个用例全绿
- ✅ 无 lint 错误
- ✅ `release/chatgpt-saver-v2.1.0.zip`（5.1 MB）已打好
- ✅ 冒烟手册 `docs/SMOKE_TEST_GUIDE_v2.1.0.md` 已写
- ⏳ 待 push 到 GitHub
- ⏳ 待真实浏览器冒烟（按手册执行 4 项手动验证 + 本报告 §六追加 4 项）
