/**
 * Gemini adapter 注册入口。
 */
(function () {
  if (typeof window === 'undefined') return;
  const Saver = window.ChatGPTSaver = window.ChatGPTSaver || {};
  const reg = Saver.PlatformAdapterRegistry;
  const adapter = Saver.GeminiAdapter;
  if (reg && adapter && !reg.get(adapter.id)) {
    try { reg.register(adapter); } catch (_) { /* ignore */ }
  }
})();
