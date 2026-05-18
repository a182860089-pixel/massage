/**
 * 命令总线：把"导出 / 复制 / 批量 / 打开后台"等顶层动作收口到一处，
 * 让快捷键、右键菜单、悬浮按钮、popup 都走同一入口，便于以后扩展。
 *
 * 用法：
 *   CommandBus.register('export.current', async (args) => { ... });
 *   CommandBus.register('copy.markdown', async (args) => { ... });
 *   await CommandBus.dispatch('export.current', { source: 'shortcut' });
 *
 * Background → content 的桥也走这里：background 收到 chrome.commands / contextMenus
 * 后，发 { action: 'cmd', commandId, args } 给 content，content 在消息监听里
 * 转 CommandBus.dispatch(commandId, args)。
 */

const CommandBus = {
  _handlers: new Map(),
  _ANY: '__any__',

  register(commandId, handler) {
    if (typeof commandId !== 'string' || !commandId) {
      throw new Error('commandId must be non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error('handler must be function');
    }
    this._handlers.set(commandId, handler);
    return () => this._handlers.delete(commandId);
  },

  registerAny(handler) {
    if (typeof handler !== 'function') {
      throw new Error('handler must be function');
    }
    this._handlers.set(this._ANY, handler);
    return () => this._handlers.delete(this._ANY);
  },

  unregister(commandId) {
    this._handlers.delete(commandId);
  },

  has(commandId) {
    return this._handlers.has(commandId);
  },

  list() {
    return Array.from(this._handlers.keys()).filter((k) => k !== this._ANY);
  },

  async dispatch(commandId, args = {}) {
    const handler = this._handlers.get(commandId);
    if (handler) {
      return Promise.resolve(handler(args));
    }
    const anyHandler = this._handlers.get(this._ANY);
    if (anyHandler) {
      return Promise.resolve(anyHandler({ commandId, args }));
    }
    throw new Error(`No handler registered for command: ${commandId}`);
  },

  reset() {
    this._handlers.clear();
  }
};

// 已知命令名（避免拼写错）
const Commands = Object.freeze({
  EXPORT_CURRENT: 'export.current',
  EXPORT_BATCH_OPEN: 'export.batch.open',
  EXPORT_BATCH_RUN: 'export.batch.run',
  EXPORT_BATCH_ABORT: 'export.batch.abort',
  COPY_MARKDOWN: 'copy.markdown',
  COPY_RICH_TEXT: 'copy.richtext',
  COPY_RAW: 'copy.raw',
  COPY_MESSAGE: 'copy.message',
  OPEN_CARDKEY_OVERLAY: 'cardkey.overlay.open',
  OPEN_BACKEND_ADMIN: 'cardkey.admin.open'
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CommandBus, Commands };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.CommandBus = CommandBus;
  window.ChatGPTSaver.Commands = Commands;
}
