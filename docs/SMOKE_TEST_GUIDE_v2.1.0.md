# v2.1.0 真实浏览器冒烟测试指南

- 测试包：`release/chatgpt-saver-v2.1.0.zip`（5.1 MB）
- 分支：`feat/p0-platform-adapter`
- 测试范围：Phase 0/1/3/4 在真实 Chrome + chatgpt.com 上的端到端验证

## 一、装载扩展（30 秒）

1. 解压 `release/chatgpt-saver-v2.1.0.zip` 到任意目录，如 `D:\chatgpt-saver-v2.1.0\`
2. Chrome 打开 `chrome://extensions/`
3. 右上角开关「开发者模式」打开
4. 点「加载已解压的扩展程序」→ 选刚解压的目录
5. 看到「ChatGPT 对话保存助手 2.1.0」出现且无报错即装载成功

> 注意：如果之前已装过旧版，先把它「移除」再装新的，否则 storage 里可能有旧 schema 残留。

## 二、四项必验项

### 验证 1 · 三个快捷键真触发（Alt+Shift+S/C/E）

1. 装好扩展后打开 `https://chatgpt.com/`，进任意一个有内容的对话
2. 等右下角浮动按钮出现
3. **Alt+Shift+S** —— 应弹"导出中…"日志面板，最终提示导出成功
4. **Alt+Shift+C** —— 应弹 toast「✅ 已复制为 Markdown」
5. **Alt+Shift+E** —— 应展开/收起右侧侧边栏

**期望**：每个快捷键都有视觉反馈，控制台 `chrome.runtime` 无报错。

**问题排查**：
- 快捷键不响应 → 打开 `chrome://extensions/shortcuts` 检查是否被其它扩展占用，可重新分配
- 控制台报 `Cannot find function ensureCommandBusBindings` → manifest 注入顺序问题，应在装载时即报，不应运行时报

### 验证 2 · 右键菜单出现且能动作

1. 在 chatgpt.com 任意位置右键
2. 应出现 4 项「ChatGPT 对话保存助手」子菜单：
   - 💾 立即保存当前对话
   - 📋 复制当前对话为 Markdown
   - 📄 复制当前对话为富文本（HTML）
   - 🗂 打开保存助手侧边栏
3. 依次点 4 项，每项都应有视觉反馈

**问题排查**：
- 右键菜单不出现 → 检查 `chrome://extensions/` 该扩展的 service worker 控制台日志，应看到 `注册右键菜单失败` 或类似

### 验证 3 · 粘贴效果：富文本 vs Markdown

1. 在 chatgpt.com 任意对话点击 popup「复制为 Markdown」
2. 在不同应用粘贴：
   - **VSCode / typora**：应粘成原始 Markdown 源码（`## You` / `## ChatGPT` / `` ```python ``）
   - **Notion / Word / Google Docs**：应粘成纯文本
3. 再点 popup「复制为富文本」
4. 在不同应用粘贴：
   - **VSCode / typora**：应粘成 HTML 或退化为纯文本
   - **Notion / Word / Google Docs**：应粘成排好版的富文本（粗体、列表、引用块、标题等）

**期望**：两个按钮粘到不同位置的差异明显。

### 验证 4 · Canvas / Thought / Deep Research / Web Search 真实导出

> 这个需要你有真实带这些高级元素的对话。

1. 找一个含 Canvas 的 ChatGPT 对话（让 GPT-5 帮你画 canvas，或者打开任意保存过的含 canvas 历史）
2. 按 **Alt+Shift+S** 导出，看本地保存目录里的 HTML 文件
3. **期望**在 HTML 中能看到：
   - `<aside class="canvas-block">` 紫色卡片含 Canvas 标题 + 代码
   - `<details class="thought-block">` 灰色折叠区，展开后能看到思维链
   - `<section class="web-search-block">` 蓝色卡片含搜索来源链接
   - `<section class="deep-research-block">` 长报告卡片含 citations
4. 看 Markdown 文件，应分别看到：
   - `### 🖼 Title\n\`\`\`lang...`（Canvas）
   - `> **💭 Summary** + 引用块`（思维链）
   - `**🔍 Web Search**\n1. [...]`（搜索）
   - `### 📊 Title + Citations 列表`（Deep Research）

**期望**：4 类高级 Block 在 HTML 与 Markdown 中都有专门样式 / 文案。

**问题排查（如果识别不到）**：
- 现在 selector 是基于社区文档反推的启发式，ChatGPT 实际 DOM 在 6 月可能微调
- 打开浏览器 DevTools，选中含 Canvas 的消息节点，看实际属性，把命中的 selector 反馈给我，下版本加进去

## 三、自动化已通过的项（无需手动验证）

| 项 | 通过情况 |
| --- | --- |
| 8 类 Block 数据模型 normalize / legacy 双向转换 | 17 用例 ✓ |
| CommandBus 注册 / 分发 / any handler | 7 用例 ✓ |
| ClipboardManager Markdown / 富文本 / 兜底 execCommand | 7 用例 ✓ |
| PlatformAdapterRegistry URL 路由 | 3 用例 ✓ |
| ChatGPTAdapter 在 mock DOM 上识别 Thought / Canvas / Web Search | 7 用例 ✓ |
| 旧 parser / observer / exporter / cardKeyManager 等回归 | 161 用例 ✓ |
| **总计** | **202 / 202 PASS** |

## 四、装载后如果想升级 / 切版本

- 装的是「解压目录」，**只要替换该目录里的文件，刷新 chrome://extensions/ 即可热更新**
- 但 manifest 改动需要点该扩展的「🔄 刷新」按钮
- storage 里的设置不会丢

## 五、卸载后想留着保存数据

- File System Access API 授权的本地目录里所有 HTML/MD/PDF/JSON 文件**都留在原位**
- 卸载扩展只会清掉 `chrome.storage.local` 里的偏好（卡密、目录授权 handle、配额计数）
- 重装后需要重新选目录授权

## 六、问题反馈格式

如果某项验证失败，把以下信息发给我：

```
失败项：[验证 N · xxx]
浏览器版本：chrome://version 第一行
扩展版本：2.1.0
失败现象：
DevTools 控制台日志：
DevTools 网络请求：
ChatGPT URL 与对话标题（如果涉及）：
```

## 七、下一步

冒烟通过后，我会继续推进：

- **Phase 2 批量全量导出**（已在本轮一并提交，跟随到 PR 里）
- **Phase 5 Gemini 适配**（已在本轮一并提交，跟随到 PR 里）
