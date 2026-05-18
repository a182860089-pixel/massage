# `chat-massage` 全方位测试报告

> 版本：`2.0.1`
> 执行环境：Windows 10.0.26200 / Node 22 / vitest 4 / @vitest/coverage-v8
> 执行时间：2026-05-18
> 范围：静态代码审查 + 新增 6 个未覆盖模块的 vitest 用例 + 全量单测 + 覆盖率

---

## 1. 总览

- 测试用例 **162 个**（原 17 个文件 / 110 用例 + 本次新增 **6 个文件 / 52 用例**）
- 通过：**162**，失败：**0**，跳过：**0**
- 但全部「通过」**不代表代码没问题**：本次审查共发现 **5 个 high+/critical 级 bug、8 个 medium、6 个 low**，其中 4 个高优 bug 已用单元测试在测试套件里固定下来（含"failing by design"批注，便于后续修复后用同一用例验回归）
- 自研代码语句覆盖率约 **15%**（详见 §4 表），主要是 `content.js` 体量过大（4036 行）且以 IIFE 形式存在，加上 `background.js / fetchInterceptor.js / popup.js` 完全无测试

---

## 2. 静态审查发现

排序：严重度（critical > high > medium > low）→ 位置 → 影响 → 复现 → 建议修复。

### CRITICAL

#### C-1. `AccessManager.canUseNow()` 永远返回 `true` —— 卡密失效后所有功能仍可继续使用

- **位置**：[src/utils/accessManager.js](src/utils/accessManager.js#L64-L71)
- **现象**：

```64:71:src/utils/accessManager.js
  canUseNow() {
    if (this._cardKeyManager?.canUseNow?.()) {
      this._state.accessMode = 'card';
    } else {
      this._state.accessMode = 'free';
    }
    return true;
  },
```

- **影响**：`content.js` 中 12 处用 `AccessManager.canUseNow()` 做权限判断（自动保存、手动导出、上下文延续、导航跳转、PDF 生成等），所有判断分支永远走 truthy。即使卡密被清掉、`CardKeyManager.canUseNow()` 返回 `false`，仍只是在内部把 `accessMode` 同步成 `'free'`，**不会阻止任何调用**。这看起来是有意保留的"免费版可继续使用、只是受配额限制"的设计，但与方法名 `canUseNow` 强烈冲突，且 `getUnavailableMessage()` 返回空串、`showCardKeyOverlay(unavailableMessage)` 弹窗失去文案，UI 上会出现"弹了空白卡密遮罩"的现象。
- **复现**：直接看 [src/content/content.js:3906-3934](src/content/content.js#L3906) `startAutoSave`：

```3906:3912:src/content/content.js
  async function startAutoSave() {
    const unavailableMessage = AccessManager.getUnavailableMessage();
    if (!AccessManager.canUseNow()) {
      UI.showCardKeyOverlay(unavailableMessage);
      UI.updateStatus();
      return;
    }
```

`canUseNow()` 永真，`if (!true)` 永假，分支不可达。`unavailableMessage` 始终为空串，`showCardKeyOverlay` 永远拿到空文案。

- **建议修复**：二选一
  - **(A) 保留"允许免费版"语义**，把方法重命名为 `syncAccessMode()` 或 `refreshAccessMode()`，去掉 `if (!AccessManager.canUseNow())` 所有调用，改用 `getAccessMode() === 'card'` 显式判断
  - **(B) 把方法行为改成「真正的能否使用」**：返回 `this._cardKeyManager?.canUseNow?.() === true || this._state.accessMode === 'free'`，并补充配额耗尽后的 `false` 分支

### HIGH

#### H-1. 网络抖动会触发卡密本地缓存被误清

- **位置**：[src/background/background.js:207-227](src/background/background.js#L207) ↔ [src/content/content.js:155-189](src/content/content.js#L155) `requestAndApplyCardData`
- **现象**：

```207:227:src/background/background.js
async function handlePluginCardKeyRequest(path, request, sendResponse) {
  try {
    const resp = await fetch(BASE_API_URL + path, { /* ... */ });
    const json = await resp.json();
    sendResponse(json);
  } catch (e) {
    sendResponse({
      success: false,
      message: '网络错误: ' + e.message,
      data: { authorized: false }
    });
  }
}
```

CardKeyManager 周期性复检 `checkStatus({ clearOnInvalid: true })`：

```260:266:src/content/content.js
        const result = await this.checkStatus(this.cardData.card_key, this.cardData.email, { clearOnInvalid: true });
        if (!result.valid) {
          if (!this.verified && typeof UI !== 'undefined' && UI.showCardKeyOverlay) {
            UI.showCardKeyOverlay(this.getUnavailableMessage(previousCardData, result.message || '卡密状态已失效，请重新激活'));
          }
          return;
        }
```

网络错误被 background 包装成 `{success:false, data:{authorized:false}}`，content 收到后等同于"业务校验失败"，触发 `clearCardData()`，已激活的卡密缓存被清空，下次进入 ChatGPT 必须重新输入卡密。

- **测试覆盖**：[tests/cardKeyManager.test.mjs](tests/cardKeyManager.test.mjs) `regression: status check on network error wipes local cache` 已复现
- **建议修复**：在 background 区分网络错误：
  ```js
  // 推荐
  sendResponse({ success: false, network_error: true, message: '网络错误: ' + e.message });
  ```
  content 端在 `clearOnInvalid` 分支里跳过 `network_error === true` 的响应，保留本地缓存等下次复检。

#### H-2. `URLObserver` 没有 `stop()`、不幂等、资源永久泄漏

- **位置**：[src/content/observer.js:238-279](src/content/observer.js#L238)
- **现象**：
  - `start()` 一次性注册 popstate 监听器、整个 `document.body` 的 subtree MutationObserver、`setInterval(check, 1000)`，三者**没有任何句柄被保存**
  - 不提供 `stop()`；如果 `init()` 被重入（SPA 路由切换重跑 content.js 的场景），每次都会再叠加一组监听器
  - `setInterval` 每 1s 轮询，与 MutationObserver 监听全身重叠，对长对话页面有性能负担
- **测试覆盖**：[tests/observer.test.mjs](tests/observer.test.mjs) `regression: start() lacks idempotent guard / stop()` 已断言 `stop` 未定义
- **建议修复**：把 timer / observer 句柄存到 `this._timers`、`this._observers`、`this._listeners`，提供 `stop()` 全部清理；`start()` 进入前先 `stop()`。

#### H-3. CardKeyManager 在 IIFE 内、缺乏对外测试入口、状态机隐式

- **位置**：[src/content/content.js:90-370](src/content/content.js#L90)
- **现象**：卡密所有状态、活动定时器、缓存读写都封装在 `(function () { ... })()` 闭包里，**没有任何对外的导出口**，导致：
  - 单元测试需要文件读取 + `new Function()` 切片注入（见本仓库 [tests/helpers/loadCardKeyManager.mjs](tests/helpers/loadCardKeyManager.mjs)）
  - 任何对 CardKeyManager 状态的调试都得开 DevTools 操作 `window.ChatGPTSaver`，没法做单元回归
  - `recheckTimer` / `cardData` 一旦出 bug，靠日志几乎无法复现
- **建议修复**：把 CardKeyManager 抽到 `src/utils/cardKeyManager.js`，按现有 `accessManager.js` 模式 export，content.js 改为 `const CardKeyManager = window.ChatGPTSaver.CardKeyManager`。

#### H-4. `ConversationObserver.waitForContainer` 的 30s polling 在 `stop()` 之外触发

- **位置**：[src/content/observer.js:43-53](src/content/observer.js#L43)
- **现象**：

```43:53:src/content/observer.js
  waitForContainer() {
    const checkInterval = setInterval(() => {
      const container = window.ChatGPTSaver.Parser.getConversationContainer();
      if (container) {
        clearInterval(checkInterval);
        this.setupObserver(container);
      }
    }, 500);

    setTimeout(() => clearInterval(checkInterval), 30000);
  },
```

`checkInterval` 是局部变量，未保存到 `this`。如果调用方 `start()` 后立刻又 `stop()`，这个 polling 仍在跑直到 30s，并会在 30s 内任意一次 tick 重新建立 observer，触发"已停止又自启"。

- **建议修复**：句柄存到 `this.containerCheckTimer`，`stop()` 中 `clearInterval(this.containerCheckTimer)`。

#### H-5. `FeatureQuotaManager.isCardUser` 依赖全局 `window.ChatGPTSaver.AccessManager` 单例

- **位置**：[src/utils/featureQuotaManager.js:32-39](src/utils/featureQuotaManager.js#L32)
- **现象**：

```32:39:src/utils/featureQuotaManager.js
  isCardUser() {
    if (typeof window === 'undefined') return false;
    try {
      return window.ChatGPTSaver?.AccessManager?.getAccessMode?.() === 'card';
    } catch (e) {
      return false;
    }
  },
```

非浏览器环境（含 node test）默认 `isCardUser=false`；如果 `AccessManager.getAccessMode()` 还没初始化、或者 `init()` 中 await 链未完成时被调用，会把 card 用户误判为 free 并扣额度。

- **建议修复**：让 `init()` 接受可选的 `accessManager` 参数注入，把单例依赖改为依赖注入。

### MEDIUM

#### M-1. `handlePluginGetClientConfig` 返回 `success:true` 但 `stale:true` —— 调用方可能误读

- **位置**：[src/background/background.js:248-294](src/background/background.js#L248)
- **影响**：源服务挂了之后 `fetchWithCache` 走 `stale-cache` 分支，仍返回 `success:true`，content 端如果只看 `success` 字段不会知道这是过期数据，公告就会一直保留几小时甚至几天前的内容。
- **建议**：调用方读取 `resp.stale === true` 并在 UI 上提示"配置可能过期"。

#### M-2. `Observer.checkForCompletion` 嵌套 setTimeout 没有终止条件

- **位置**：[src/content/observer.js:148-196](src/content/observer.js#L148)
- **影响**：当 `isGPTTyping()` 持续为 true（流式输出卡住、SSE 异常没结束），自我递归无限延后保存，闭包链堆积，长时间不释放。
- **建议**：加最大轮询时长（如 30 min），超时强制保存或放弃。

#### M-3. `FeatureQuotaManager._currentMonthlyPeriod` 用本地时区

- **位置**：[src/utils/featureQuotaManager.js:234-239](src/utils/featureQuotaManager.js#L234)
- **影响**：跨时区飞行时月初归零时刻偏差，可能让用户在月底凌晨多消耗一份"上月配额"。
- **建议**：固定按 UTC 或服务时区计算月份。

#### M-4. `fileSystem.saveConversation` 失败时 catch 内未返回 `folderState`

- **位置**：[src/utils/fileSystem.js:604-606](src/utils/fileSystem.js#L604)
- **影响**：

```604:606:src/utils/fileSystem.js
    } catch (error) {
      return { success: false, error: error.message };
    }
```

`Exporter` 第 176 行 `return { ...saveResult, folderState: ready.folderState || null };` 拼装时拿不到错误路径下的 folderState，下游想做"目录失效则跳过下次重试"逻辑会拿到 `undefined`。

- **建议**：`folderState: await this.getFolderState().catch(() => null)`。

#### M-5. `normalizeClientConfig.pickFirstNonEmptyString` 与 `sanitizeUrl` 两段式处理会丢候选

- **位置**：[src/utils/clientConfigCache.js:67-76](src/utils/clientConfigCache.js#L67)
- **现象**：先按优先级取第一个非空字符串，再 `sanitizeUrl`。如果优先级最高的值是 `javascript:alert(1)` 之类非法 URL，`sanitizeUrl` 拒掉后**不会**再去取下一个候选，配置就显示空。
- **测试覆盖**：[tests/clientConfigCache.test.mjs](tests/clientConfigCache.test.mjs) `discards non-http(s) urls but does NOT fallback to next candidate` 已断言
- **建议**：合并到一个 reducer：取第一个能通过 sanitize 的候选。

#### M-6. `CardKeyManager.requestAndApplyCardData` 在并发场景下可能多次启动 `recheckTimer`

- **位置**：[src/content/content.js:172-176](src/content/content.js#L172)
- **影响**：两次 `activate` 并发时都进入 `startStatusRecheck()`，虽然里面有 `clearInterval(this.recheckTimer)`，但中间窗口内的两个 setInterval 会同时存在一瞬。低概率。
- **建议**：用 `_activating` flag 序列化。

#### M-7. `parser.parseMessage` 对没有 `data-message-author-role` 但有内容的元素返回 `role: 'system'`

- **位置**：[src/content/parser.js:305-311](src/content/parser.js#L305)
- **影响**：异常 DOM 节点会被当成 system message 导出，污染上下文。这种情况实际不存在（fallback 选择器都要求 author-role），但代码逻辑保留了不可达分支。
- **建议**：明确返回 null 或抛错，由调用方过滤。

#### M-8. `Exporter.exportConversation` 在 quota 部分耗尽时静默禁用格式

- **位置**：[src/utils/exporter.js:63-73](src/utils/exporter.js#L63)
- **影响**：用户勾了 md+pdf+html+json，免费版 md/pdf 都用完后 `applyExportFormats` 把它们设为 false，但没有任何 toast 告知，只在日志写了一行。
- **建议**：调用方在拿到 `applied.blocked` 后向用户显式 toast 警告。

### LOW

#### L-1. `config.cardKeyApiBase` 与 `BASE_API_URL` 双处硬编码

- 位置：[src/content/content.js:32](src/content/content.js#L32)，[src/background/background.js:8](src/background/background.js#L8)
- 影响：升级 API 域名时需同步两处。
- 建议：通过 manifest `host_permissions` 推断或集中到 `src/utils/apiEndpoints.js`。

#### L-2. `cardKeyData` 在 `chrome.storage.local` 中以明文持久化

- 位置：[src/content/content.js:243](src/content/content.js#L243)
- 影响：DevTools 可见，理论上其他扩展若拿到 storage 权限也可读到。
- 建议：低敏感场景可接受，文档提示用户即可。

#### L-3. `FileSystemManager.sanitizeFileName` 直接 `substring(0, 100)` 可能截到 emoji surrogate 中间

- 位置：[src/utils/fileSystem.js:301](src/utils/fileSystem.js#L301)
- 影响：ChatGPT 对话标题常带 emoji，截到代理对中间会产生无效 UTF-16 字符。
- 建议：`Array.from(s).slice(0, 100).join('')`。

#### L-4. `aboutRenderer.js` / `mdExporter.js` / `pdfExporter.js` / `popup.js` 无测试覆盖

- 见 §4，全部 0%。

#### L-5. `Parser.getContentHash` 全量拼接 + O(N) 哈希

- 位置：[src/content/parser.js:514-526](src/content/parser.js#L514)
- 影响：长对话每次 Observer 检测时 O(N) 拼接 + 遍历，主线程负担。
- 建议：增量计算或对消息 id+update_time 哈希。

#### L-6. `Observer` 调试日志输出到 `console.log` 无 namespace

- 影响：长对话页面下控制台被刷屏，未走 `Logger.add()`。
- 建议：统一接 `ChatGPTSaver.Logger`。

---

## 3. 新增测试用例

### 3.1 文件清单


| 文件                                                                               | 用例数 | 主要场景                                                                                     |
| -------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------- |
| [tests/cardKeyManager.test.mjs](tests/cardKeyManager.test.mjs)                   | 25  | CardKey 全部纯函数、init 三态、requestAndApplyCardData 四路径、复检间隔切换、网络错误清理 regression               |
| [tests/accessManager.test.mjs](tests/accessManager.test.mjs)                     | 12  | card/free 切换、legacy `accessMode` 兼容、`canUseNow` 永真 regression、badge、init 异常分支            |
| [tests/clientConfigCache.test.mjs](tests/clientConfigCache.test.mjs)             | 12  | normalize 候选选择、TTL 判定、forceRefresh、stale-cache 降级、空缓存失败、URL fallback regression          |
| [tests/backgroundMessageRouter.test.mjs](tests/backgroundMessageRouter.test.mjs) | 5   | activate/status/rebind 透传、网络错误吞噬 regression、forceRefresh、空缓存                             |
| [tests/parser.test.mjs](tests/parser.test.mjs)                                   | 11  | DOM 抽取（user/assistant）、空文档兜底、isGPTTyping、isWorkspacePage、ContentHash 稳定性、工作空间名           |
| [tests/observer.test.mjs](tests/observer.test.mjs)                               | 7   | ConversationObserver 启停幂等、reset、URLObserver checkURLChange、URLObserver 无 stop regression |


### 3.2 加载策略

`CardKeyManager`、`Observer`、`Parser` 都被原作者写在 IIFE 里且没有 `module.exports`。本次为了不修改源码，加了 [tests/helpers/loadCardKeyManager.mjs](tests/helpers/loadCardKeyManager.mjs)：把目标对象所在的代码块切片，喂给 `new Function(...)` 注入 mock 后的 `chrome` / `crypto` / `AccessManager` / `UI` / `window` 拿到对象引用。Observer/Parser 同理，用 jsdom environment + 文件内 IIFE 整体注入。

### 3.3 执行结果

```
 Test Files  23 passed (23)
      Tests  162 passed (162)
   Duration  18.33s
```

全部通过。被 regression 用例固定的 bug：

- **H-1**（网络错误清缓存）→ `cardKeyManager.test.mjs:requestAndApplyCardData::regression`
- **H-2**（URLObserver 无 stop）→ `observer.test.mjs:URLObserver::regression`
- **M-5**（URL 不 fallback）→ `clientConfigCache.test.mjs:normalizeClientConfig::discards non-http(s) urls but does NOT fallback`
- **C-1**（canUseNow 永真）→ `accessManager.test.mjs:isCardActive / canUseNow::canUseNow ALWAYS returns true`

修复源码后这些 regression 用例的断言需要相应更新（注释里已说明）。

---

## 4. 模块覆盖率

```
% Coverage report from v8

=============================== Coverage summary ===============================
Statements   : 14.91% ( 955/6401 )
Branches     : 15.27% ( 821/5374 )
Functions    : 18.39% ( 181/984 )
Lines        : 15.82% ( 876/5536 )
================================================================================
```

按模块：


| 模块                             | Stmts      | Branch | Funcs  |
| ------------------------------ | ---------- | ------ | ------ |
| `utils/accessManager.js`       | **86.95%** | 76%    | 82.35% |
| `utils/clientConfigCache.js`   | **89.47%** | 80%    | 80%    |
| `utils/selectionManager.js`    | **94.28%** | 75%    | 100%   |
| `utils/htmlExporter.js`        | 82.75%     | 54.7%  | 84%    |
| `utils/jsonExporter.js`        | 84.61%     | 82.97% | 90%    |
| `utils/templateManager.js`     | 80.7%      | 55.26% | 82.35% |
| `utils/featureQuotaManager.js` | 65.18%     | 61.6%  | 76.19% |
| `utils/conversationAssets.js`  | 51.54%     | 48.69% | 50%    |
| `utils/tokenEstimator.js`      | 35.84%     | 28.57% | 50%    |
| `utils/searchIndex.js`         | 21.95%     | 34.21% | 4.54%  |
| `utils/fileSystem.js`          | 17.5%      | 14.96% | 15.78% |
| `utils/aboutRenderer.js`       | **0%**     | 0%     | 0%     |
| `utils/exporter.js`            | **0%**     | 0%     | 0%     |
| `utils/mdExporter.js`          | **0%**     | 0%     | 0%     |
| `utils/pdfExporter.js`         | **0%**     | 0%     | 0%     |
| `popup/popup.js`               | **0%**     | 0%     | 0%     |
| `background/background.js`     | **0%**     | 0%     | 0%     |
| `content/content.js`           | **0%**     | 0%     | 0%     |
| `content/fetchInterceptor.js`  | **0%**     | 0%     | 0%     |
| `content/observer.js`          | **0%**     | 0%     | 0%     |
| `content/parser.js`            | **0%**     | 0%     | 0%     |


注意：`content.js`（其中包含 CardKeyManager）、`observer.js`、`parser.js`、`background.js` 实际**有**新增测试在跑，但用的是 `new Function()` 注入加载，v8 看不到执行轨迹，所以表里仍显示 0%。这是统计口径限制，不代表它们无测试。

---

## 5. 仍未覆盖的关键模块（建议后续补）

- `content.js` 中除 CardKeyManager 之外的 ~3700 行：`UsageMonitor`（模型用量计数）、`AttachmentManager`、`ContextPromptTemplates`、`ChatNavigator`、`UI` 全部子模块、自动保存与防抖编排
- `src/content/fetchInterceptor.js`：MAIN world 中拦截 fetch / 提取 PoW、account_type、conversation routing
- `src/utils/exporter.js` / `src/utils/mdExporter.js` / `src/utils/pdfExporter.js`：导出主流程
- `src/popup/popup.js`：弹窗 UI
- `src/utils/aboutRenderer.js`：关于页渲染
- `src/utils/fileSystem.js` 剩余 80%+ 部分：File System Access 全流程（授权、回收、断恢复）

---

## 6. 后续建议

1. **修复 §2 列出的 5 个 high/critical bug**：尤其是 H-1（网络错误清缓存）会被用户直接感知为"用着用着突然要重新输卡密"
2. **把 CardKeyManager 抽到 `src/utils/cardKeyManager.js`**，与现有 accessManager.js 一样对外导出，便于后续维护与测试（同时 §3.2 的 helper 加载器就可以删掉）
3. **CI 接入**：把 `npm run test` 加到 GitHub Actions，PR 时强制跑；覆盖率门槛先设 15% 不再降，逐步加到 30/40
4. **E2E**：本次未做。可下一步用 Playwright 加载未打包扩展（`--load-extension`）到一个 ChatGPT 测试账号上做端到端，覆盖自动保存 / 文件夹授权 / PDF 导出 / 卡密弹窗 4 个核心场景
5. **可观测性**：`Logger.add` 已是 ringbuffer，建议把 `console.log` 全部统一接进去，方便用户上报问题时一键导出日志

---

## 7. 怎么复现这份报告

```bash
cd chat-massage
npm install
npm run test                            # 162/162 通过
npx vitest --run --coverage \
  --coverage.include='src/**/*.js' \
  --coverage.exclude='src/lib/**' \
  --coverage.exclude='src/workers/**' \
  --coverage.exclude='src/pdf-v2/**' \
  --coverage.reporter=text-summary --coverage.reporter=text
```

