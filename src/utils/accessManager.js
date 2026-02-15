/**
 * AccessManager - 统一访问控制（卡密 + 游客试用）
 */

const AccessManager = {
  ACCESS_MODE_KEY: 'accessMode',
  GUEST_TRIAL_KEY: 'guestTrialState',
  TRIAL_DURATION_MS: 24 * 60 * 60 * 1000,

  _cardKeyManager: null,
  _state: {
    accessMode: 'none', // card | guest | none
    guestTrialState: {
      used: false,
      startedAt: null,
      expiresAt: null,
      clientId: '',
      expiredNotified: false
    }
  },
  _memStore: {},

  async init(cardKeyManager) {
    this._cardKeyManager = cardKeyManager || null;

    const loaded = await this._loadState();
    this._state.accessMode = loaded.accessMode;
    this._state.guestTrialState = loaded.guestTrialState;

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
      await this._saveState();
      return true;
    }

    if (this._isGuestActive()) {
      this._state.accessMode = 'guest';
      await this._saveState();
      return true;
    }

    this._state.accessMode = 'none';
    await this._saveState();
    return false;
  },

  getAccessMode() {
    return this._state.accessMode;
  },

  async activateGuestTrial(clientId) {
    const now = Date.now();
    const state = this._state.guestTrialState || {};

    if (this._cardKeyManager?.canUseNow?.()) {
      this._state.accessMode = 'card';
      await this._saveState();
      return { success: true, mode: 'card' };
    }

    // 已使用过且已到期：不再允许重新试用
    if (state.used && state.expiresAt && now >= Number(state.expiresAt)) {
      this._state.accessMode = 'none';
      await this._saveState();
      return {
        success: false,
        message: '试用时间结束，请进行激活'
      };
    }

    // 首次试用
    if (!state.used) {
      const startedAt = now;
      const expiresAt = now + this.TRIAL_DURATION_MS;
      this._state.guestTrialState = {
        used: true,
        startedAt,
        expiresAt,
        clientId: String(clientId || ''),
        expiredNotified: false
      };
    }

    this._state.accessMode = 'guest';
    await this._saveState();
    return { success: true, mode: 'guest' };
  },

  async onCardActivated() {
    this._state.accessMode = 'card';
    await this._saveState();
  },

  async clearCardAccessFallback() {
    if (this._isGuestActive()) {
      this._state.accessMode = 'guest';
    } else {
      this._state.accessMode = 'none';
    }
    await this._saveState();
  },

  canUseNow() {
    if (this._cardKeyManager?.canUseNow?.()) {
      this._state.accessMode = 'card';
      return true;
    }

    if (this._isGuestActive()) {
      this._state.accessMode = 'guest';
      return true;
    }

    this._state.accessMode = 'none';
    return false;
  },

  getGuestRemainingMs() {
    const expiresAt = Number(this._state.guestTrialState?.expiresAt || 0);
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - Date.now());
  },

  hasGuestTrialExpired() {
    const state = this._state.guestTrialState || {};
    if (!state.used || !state.expiresAt) return false;
    return Date.now() >= Number(state.expiresAt);
  },

  hasUsedGuestTrial() {
    return this._state.guestTrialState?.used === true;
  },

  wasExpiryNotified() {
    return this._state.guestTrialState?.expiredNotified === true;
  },

  async markExpiryNotified() {
    if (!this._state.guestTrialState) return;
    this._state.guestTrialState.expiredNotified = true;
    await this._saveState();
  },

  getUnavailableMessage() {
    if (this._cardKeyManager?.canUseNow?.()) {
      return '';
    }

    if (this.hasGuestTrialExpired()) {
      return '试用时间结束，请进行激活';
    }

    if (!this.hasUsedGuestTrial()) {
      return '请选择激活方式：卡密激活或游客登录';
    }

    return this._cardKeyManager?.getUnavailableMessage?.() || '请先激活卡密后使用';
  },

  getBadgeInfo() {
    if (this._cardKeyManager?.canUseNow?.()) {
      return { type: 'card' };
    }

    if (this._isGuestActive()) {
      const remainMs = this.getGuestRemainingMs();
      const hours = Math.max(1, Math.ceil(remainMs / (60 * 60 * 1000)));
      return {
        type: 'guest',
        text: `🆓 游客剩余 ${hours} 小时`,
        color: hours <= 3 ? '#ef4444' : '#10a37f'
      };
    }

    return { type: 'none' };
  },

  _isGuestActive() {
    const state = this._state.guestTrialState || {};
    if (!state.used || !state.startedAt || !state.expiresAt) return false;
    const now = Date.now();
    return now < Number(state.expiresAt);
  },

  async _loadState() {
    const defaults = {
      accessMode: 'none',
      guestTrialState: {
        used: false,
        startedAt: null,
        expiresAt: null,
        clientId: '',
        expiredNotified: false
      }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([this.ACCESS_MODE_KEY, this.GUEST_TRIAL_KEY]);
        const accessMode = this._normalizeAccessMode(result[this.ACCESS_MODE_KEY]);
        const guestTrialState = this._normalizeGuestState(result[this.GUEST_TRIAL_KEY]);
        return { accessMode, guestTrialState };
      }
    } catch (e) {
      // ignore
    }

    const accessMode = this._normalizeAccessMode(this._memStore[this.ACCESS_MODE_KEY]);
    const guestTrialState = this._normalizeGuestState(this._memStore[this.GUEST_TRIAL_KEY]);
    return {
      accessMode: accessMode || defaults.accessMode,
      guestTrialState: guestTrialState || defaults.guestTrialState
    };
  },

  async _saveState() {
    const payload = {
      [this.ACCESS_MODE_KEY]: this._normalizeAccessMode(this._state.accessMode),
      [this.GUEST_TRIAL_KEY]: this._normalizeGuestState(this._state.guestTrialState)
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set(payload);
        return;
      }
    } catch (e) {
      // ignore
    }

    this._memStore[this.ACCESS_MODE_KEY] = payload[this.ACCESS_MODE_KEY];
    this._memStore[this.GUEST_TRIAL_KEY] = payload[this.GUEST_TRIAL_KEY];
  },

  _normalizeAccessMode(value) {
    const mode = String(value || '').toLowerCase();
    if (mode === 'card' || mode === 'guest' || mode === 'none') return mode;
    return 'none';
  },

  _normalizeGuestState(value) {
    const state = value && typeof value === 'object' ? value : {};
    const startedAt = this._toValidTs(state.startedAt);
    const expiresAt = this._toValidTs(state.expiresAt);
    return {
      used: state.used === true,
      startedAt,
      expiresAt,
      clientId: String(state.clientId || ''),
      expiredNotified: state.expiredNotified === true
    };
  },

  _toValidTs(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
};

window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.AccessManager = AccessManager;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AccessManager };
}
