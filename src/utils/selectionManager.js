/**
 * SelectionManager — 管理消息选择状态，支持单选、Shift 多选
 * 纯逻辑模块，可独立测试
 */

const SelectionManager = {
  _active: false,
  _selectedIndices: new Set(),
  _lastClickedIndex: -1,

  activate() {
    this._active = true;
    this._selectedIndices = new Set();
    this._lastClickedIndex = -1;
  },

  deactivate() {
    this._active = false;
    this._selectedIndices = new Set();
    this._lastClickedIndex = -1;
  },

  isActive() {
    return this._active;
  },

  toggle(index) {
    if (this._selectedIndices.has(index)) {
      this._selectedIndices.delete(index);
    } else {
      this._selectedIndices.add(index);
    }
    this._lastClickedIndex = index;
  },

  shiftSelect(index) {
    if (this._lastClickedIndex < 0) {
      this._selectedIndices.add(index);
      this._lastClickedIndex = index;
      return;
    }
    const start = Math.min(this._lastClickedIndex, index);
    const end = Math.max(this._lastClickedIndex, index);
    for (let i = start; i <= end; i++) {
      this._selectedIndices.add(i);
    }
    this._lastClickedIndex = index;
  },

  getSelectedIndices() {
    return new Set(this._selectedIndices);
  },

  getSelectedMessages(allMessages) {
    const sorted = Array.from(this._selectedIndices).sort((a, b) => a - b);
    return sorted
      .filter(i => i >= 0 && i < allMessages.length)
      .map(i => allMessages[i]);
  },

  selectedCount() {
    return this._selectedIndices.size;
  },

  clear() {
    this._selectedIndices = new Set();
    this._lastClickedIndex = -1;
  }
};

// Export for both browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SelectionManager };
} else {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.SelectionManager = SelectionManager;
}
