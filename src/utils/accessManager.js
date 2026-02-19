/**
 * AccessManager - 统一访问模式管理（卡密激活 / 免费模式）
 * 说明：
 * - 未激活卡密也允许使用插件（免费模式）
 * - 卡密激活用户不受免费额度限制
 */

const AccessManager = {
  ACCESS_MODE_KEY: 'accessModeV2',
  LEGACY_ACCESS_MODE_KEY: 'accessMode',

  _cardKeyManager: null,
  _state: {
    accessMode: 'free' // card | free
  },
  _memStore: {},

  async init(cardKeyManager) {
    this._cardKeyManager = cardKeyManager || null;
    const loadedMode = await this._loadMode();
    this._state.accessMode = loadedMode;

    let cardValid = false;
    if (this._cardKeyManager?.init) {
      try {
        cardValid = await this._cardKeyManager.init();
      } catch (e) {
        cardValid = false;
      }
    }

    if (cardValid && this._cardKeyManager?.canUseNow?.()) {
      this._state.accessMode = 'card';
    } else {
      this._state.accessMode = 'free';
    }

    await this._saveMode();
    return true;
  },

  getAccessMode() {
    return this._state.accessMode;
  },

  isCardActive() {
    if (this._cardKeyManager?.canUseNow?.()) {
      this._state.accessMode = 'card';
      return true;
    }
    return this._state.accessMode === 'card';
  },

  async onCardActivated() {
    this._state.accessMode = 'card';
    await this._saveMode();
  },

  async clearCardAccessFallback() {
    this._state.accessMode = 'free';
    await this._saveMode();
  },

  canUseNow() {
    if (this._cardKeyManager?.canUseNow?.()) {
      this._state.accessMode = 'card';
    } else {
      this._state.accessMode = 'free';
    }
    return true;
  },

  getUnavailableMessage() {
    return '';
  },

  getBadgeInfo() {
    if (this.isCardActive()) {
      return { type: 'card' };
    }
    return {
      type: 'free',
      text: '🆓 免费版',
      color: '#10a37f'
    };
  },

  // 向后兼容旧接口（游客模式已取消）
  async activateGuestTrial() {
    this._state.accessMode = 'free';
    await this._saveMode();
    return {
      success: false,
      mode: 'free',
      message: '游客模式已取消，请使用卡密激活高级版'
    };
  },

  getGuestRemainingMs() {
    return 0;
  },

  hasGuestTrialExpired() {
    return false;
  },

  hasUsedGuestTrial() {
    return false;
  },

  wasExpiryNotified() {
    return false;
  },

  async markExpiryNotified() {
    // no-op
  },

  async _loadMode() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([
          this.ACCESS_MODE_KEY,
          this.LEGACY_ACCESS_MODE_KEY
        ]);
        const v2Mode = this._normalizeAccessMode(result[this.ACCESS_MODE_KEY]);
        if (v2Mode) return v2Mode;

        const legacyMode = String(result[this.LEGACY_ACCESS_MODE_KEY] || '').toLowerCase();
        if (legacyMode === 'card') return 'card';
        return 'free';
      }
    } catch (e) {
      // ignore
    }

    const mode = this._normalizeAccessMode(this._memStore[this.ACCESS_MODE_KEY]);
    if (mode) return mode;
    const legacy = String(this._memStore[this.LEGACY_ACCESS_MODE_KEY] || '').toLowerCase();
    return legacy === 'card' ? 'card' : 'free';
  },

  async _saveMode() {
    const mode = this._state.accessMode === 'card' ? 'card' : 'free';
    const payload = {
      [this.ACCESS_MODE_KEY]: mode
    };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set(payload);
        return;
      }
    } catch (e) {
      // ignore
    }
    this._memStore[this.ACCESS_MODE_KEY] = mode;
  },

  _normalizeAccessMode(value) {
    const mode = String(value || '').toLowerCase();
    if (mode === 'card' || mode === 'free') return mode;
    return '';
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.AccessManager = AccessManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AccessManager };
}
