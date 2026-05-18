# P0 升级测试报告 - Phase 0 / 1 / 3 / 4

- 报告时间：2026-05-18
- 分支：`feat/p0-platform-adapter`（main 保持干净，未污染）
- 工程：`F:\chat-massage` — ChatGPT 对话保存助手
- 范围：Phase 0 地基重构 + Phase 1 高级消息解析 + Phase 3 剪贴板 + Phase 4 多入口
- 不在本次：Phase 2 批量导出（下一轮）、Phase 5 Gemini 全功能对齐（下一轮）

## 一、本次提交（4 个 commit）

```
c30d1a3 feat(commands+contextMenus): Phase 4 多入口 - Alt+Shift+S/C/E + 右键菜单
0a88c3f feat(clipboard+ui):           Phase 3 剪贴板 - Markdown / 富文本 + popup 两个新按钮
1bc3141 feat(exporter):                Phase 1 高级 Block 渲染 - Canvas/Thought/WebSearch/DeepResearch
7df3f13 feat(core+adapters):           Phase 0 platform-adapter 地基
```

代码变化：

| 类别 | 文件 | 变动 |
| --- | --- | --- |
| 新增 core | `src/core/model.js` | +388 行 |
| 新增 core | `src/core/commandBus.js` | +87 行 |
| 新增 core | `src/core/clipboard.js` | +148 行 |
| 新增 core | `src/core/exporter.js` | +72 行 |
| 新增 adapter | `src/adapters/_base.js` | +71 行 |
| 新增 adapter | `src/adapters/chatgpt/parser.js` | +305 行 |
| 新增 adapter | `src/adapters/chatgpt/index.js` | +18 行 |
| 改 exporter | `src/utils/htmlExporter.js` | +103 行（4 类高级 Block 样式） |
| 改 exporter | `src/utils/mdExporter.js` | +82 行（4 类高级 Block turndown 规则） |
| 改 content | `src/content/content.js` | +118 行（CommandBus 绑定 + runCommand 路由） |
| 改 background | `src/background/background.js` | +93 行（commands + contextMenus） |
| 改 popup | `src/popup/popup.html` | +16 行（2 个复制按钮 + 快捷键卡片） |
| 改 popup | `src/popup/popup.js` | +46 行（按钮 wire-up + runCommand 通用入口） |
| 改 popup | `src/popup/popup.css` | +10 行（.mono 样式） |
| 改 manifest | `manifest.json` | +31 行 / -4 行（version 2.1.0 + 权限 + 注入 7 个新文件 + 3 个快捷键） |
| 新增测试 | `tests/coreModel.test.mjs` | +103 行 / 17 用例 |
| 新增测试 | `tests/commandBus.test.mjs` | +52 行 / 7 用例 |
| 新增测试 | `tests/clipboard.test.mjs` | +95 行 / 7 用例 |
| 新增测试 | `tests/platformAdapterRegistry.test.mjs` | +40 行 / 3 用例 |
| 新增测试 | `tests/chatgptAdapter.test.mjs` | +147 行 / 7 用例 |

## 二、测试结果

执行命令：`npx vitest --run`

```
 Test Files  28 passed (28)
      Tests  202 passed (202)
   Duration  ~23 s
```

**全部 28 个测试文件 + 202 个用例通过**，覆盖：

| 模块 | 文件 | 用例数 |
| --- | --- | --- |
| ConversationModel 8 类 Block + 双向 normalize | tests/coreModel.test.mjs | 17 |
| CommandBus 注册 / 分发 / any handler | tests/commandBus.test.mjs | 7 |
| ClipboardManager Markdown / 富文本 / writeText | tests/clipboard.test.mjs | 7 |
| PlatformAdapterRegistry 注册 / URL 路由 | tests/platformAdapterRegistry.test.mjs | 3 |
| **ChatGPT Adapter 4 类高级 Block 识别** | tests/chatgptAdapter.test.mjs | **7** |
| 旧 parser / observer / exporter / cardKeyManager / accessManager... | 23 个已有文件 | 161 |

### ChatGPT Adapter 高级消息识别测试（关键）

- ✓ 思维链：`<details><summary>Thought for 8 seconds</summary>...</details>` → ThoughtBlock(summary, detailsHtml, durationMs=8000)
- ✓ Canvas：消息内"Open canvas"按钮 + 外部 `<section data-canvas-id>` → CanvasBlock(title='Story', content)
- ✓ Web Search：`<details>Searching the web` + 链接列表 → WebSearchBlock(sources × 2)
- ✓ 软兜底：没有高级特征的普通消息 → 全部 text block，行为与旧 parser 一致

## 三、新能力清单

### Phase 0 · platform-adapter 地基

**统一数据模型** `ConversationModel`（[src/core/model.js](src/core/model.js)）：

- 8 类 Block：`text` `code` `image` `attachment` `canvas` `thought` `web_search` `deep_research`
- `normalizeConversation()`：支持新格式（`blocks[]`）和老格式（`content+textContent`）双向消化
- `modelToLegacyConversation()`：把高级 Block 转回 HTML 标签喂给老 4 个 exporter，**实现「老代码不动也支持新类型」**
- `blockToPlainText()`：每类 Block 都有可控的 plain-text 转换（思维链可选展开详情等）

**命令总线** `CommandBus`（[src/core/commandBus.js](src/core/commandBus.js)）：

- 9 个预设命令（导出、批量、3 种复制、卡密、后台）
- 注册 / 分发 / any-handler 兜底
- 用于把快捷键 / 右键 / popup / 侧边栏按钮 全部收口到一处

**剪贴板** `ClipboardManager`（[src/core/clipboard.js](src/core/clipboard.js)）：

- `writeText(text)` — 纯文本，优先 `navigator.clipboard`，失败回退 `execCommand('copy')`
- `writeRich(html, text)` — 富文本，用 `ClipboardItem` 同时塞 `text/html` + `text/plain`，粘到 Notion/Word 是富文本，粘到 typora 是 Markdown
- `conversationToMarkdown(model)` / `conversationToRichHtml(model)` — 转换工具

**平台 adapter 注册中心** `PlatformAdapterRegistry`（[src/adapters/_base.js](src/adapters/_base.js)）：

- 注册多平台 adapter；`resolveForUrl(url)` 根据 host 路由
- 为后续 Gemini adapter 留好接口
- 所有 adapter 至少实现：`hostMatches / parseConversationModel / getMessageElements / getTitle / isTyping / getConversationId`

### Phase 1 · ChatGPT 4 类高级消息识别

[src/adapters/chatgpt/parser.js](src/adapters/chatgpt/parser.js) - `ChatGPTBlockExtractor.extractBlocks(messageEl)`：

| Block 类型 | 识别启发式 | 输出字段 |
| --- | --- | --- |
| Thought | `<details>` summary 含 "thought/thinking/reasoning/思考"；或 `[data-message-content-type="thoughts"]`；或 `[data-testid*="reasoning"]` | summary, detailsHtml, detailsText, durationMs |
| Canvas | 消息内 `[data-canvas-id]` 占位；外部 `<aside>` / `<section data-canvas-id>` 内容；"Open canvas" 按钮 | canvasId, title, lang, content |
| Web Search | `[data-testid*="web_search"]`；或 `<details>` summary 含 "searching/sources/搜索"；或 `[data-source-id]` 列表 | queries[], sources[{title, url, snippet}] |
| Deep Research | `[data-testid*="research"]`；或长文本 (>1500 字) + 多 `[N]` 标注 + 多 `<a href>` | reportHtml, reportText, citations[] |

**软兜底**：任何识别不到的子树都回退为 text block，不破坏现有行为。

### Phase 3 · 剪贴板

**popup 两个新按钮**：

- 「复制为 Markdown」→ Alt+Shift+C 同效
- 「复制为富文本」→ HTML + 纯文本同时写剪贴板

**ClipboardManager 输出样例**（思维链 + Canvas + Web Search 三种 block 都被翻译）：

```markdown
## ChatGPT

[Thinking] Thought for 8 seconds

[Canvas: My Canvas]
\`\`\`python
def hello():
    print("world")
\`\`\`

[Web Search] redis windows
  1. Redis Docs https://redis.io/docs
  2. MS Redis https://github.com/microsoftarchive/redis
```

### Phase 4 · 多入口

**键盘快捷键** (manifest `commands`)：

| 快捷键 | commandId | 动作 |
| --- | --- | --- |
| `Alt+Shift+S` | save-now | 立即保存当前对话 |
| `Alt+Shift+C` | copy-markdown | 复制为 Markdown |
| `Alt+Shift+E` | open-saver-panel | 打开侧边栏 |

**右键菜单** (`chrome.contextMenus`)：仅在 chatgpt.com / chat.openai.com 出现 4 项：

1. 💾 立即保存当前对话
2. 📋 复制当前对话为 Markdown
3. 📄 复制当前对话为富文本（HTML）
4. 🗂 打开保存助手侧边栏

**统一收敛路径**：

```
快捷键 / 右键 / popup 按钮
    ↓ chrome.tabs.sendMessage({action:'runCommand', commandId, args})
content.js handleMessage
    ↓ CommandBus.dispatch(commandId, args)
buildConversationMarkdown / buildConversationRich
    ↓
PlatformAdapterRegistry.resolveForUrl → adapter.parseConversationModel()
    ↓
ConversationModel
    ↓
ClipboardManager.writeText / writeRich
```

## 四、兼容性 / 回归保证

1. **旧 popup「立即导出」按钮**：仍走 `action:'exportNow'`，调用旧 `window.ChatGPTSaver.Exporter.exportConversation(formats, force, options)`，未改动
2. **旧 ChatGPTSaver.Parser / HTMLExporter / MarkdownExporter / JSONExporter / PDFExporter 全部保留 API**，无任何破坏性改动
3. 没有识别到高级 Block 的普通消息，走的代码路径与之前完全一致（`modelToLegacyConversation` 退化为 `{role, content, textContent}`）
4. content.js 4000 行未重构，只在路由中加了 `case 'runCommand'` 一个分支 + 文件末尾追加 CommandBus 绑定
5. `chrome.commands` / `chrome.contextMenus` 都做了 `?.` 兜底，老浏览器降级正常

## 五、版本号

`manifest.json: 2.0.1 → 2.1.0`（次版本号 +1，标记新增多入口能力 + 高级消息支持）

按 SemVer：

- 没破坏旧 API → patch
- 新增能力 → minor （选这个）
- 破坏性 → major

最近还会做：
- Phase 2 批量全量导出 → 2.2.0
- Phase 5 Gemini → 3.0.0（host 改变 + 默认行为大改，建议跳大版本号）

## 六、下一步建议

1. **真实环境冒烟**：把 `feat/p0-platform-adapter` 分支打包成 zip 装到 Chrome 测一遍：
   - Alt+Shift+S / C / E 是否真触发
   - 右键菜单是否出现且能动作
   - popup 两个复制按钮粘到 Notion / VSCode 看效果
   - 找一个真实带 Canvas / Deep Research 的 ChatGPT 对话试导出（看 HTML 里 `.canvas-block` / `.thought-block` 是否出现）
2. **Phase 2 批量导出**：紧接着做 ChatGPT API source（`/backend-api/conversations` + `/backend-api/conversation/{id}`），加批量页 + 并发限流 + 进度持久化
3. **Phase 5 Gemini**：把 `src/adapters/chatgpt/parser.js` 复制一份成 `src/adapters/gemini/parser.js`，把 selector 换成 `ms-chat-turn`/`ms-thought-chunk`；manifest 加 `gemini.google.com` host

## 七、最终状态

- ✅ feat 分支已建（`feat/p0-platform-adapter`），main 干净未动
- ✅ 4 个干净 commit 推到分支
- ✅ 202/202 单元测试全绿
- ✅ 无 lint 错误
- ⏳ 待 push 到 GitHub
- ⏳ 待真实浏览器冒烟
