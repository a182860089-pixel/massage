/**
 * ChatGPT adapter 注册入口。
 *
 * 注：实际识别逻辑在 src/adapters/chatgpt/parser.js，本文件仅做注册兜底。
 * manifest 已经按顺序注入 _base.js → chatgpt/parser.js，理论上无需再 register；
 * 这里再注册一次只是为了避免 parser.js 在 register 时 _base.js 还没就绪的极端情况。
 */
(function () {
  if (typeof window === 'undefined') return;
  const Saver = window.ChatGPTSaver = window.ChatGPTSaver || {};
  const reg = Saver.PlatformAdapterRegistry;
  const adapter = Saver.ChatGPTAdapter;
  if (reg && adapter && !reg.get(adapter.id)) {
    try { reg.register(adapter); } catch (_) { /* ignore */ }
  }
})();
