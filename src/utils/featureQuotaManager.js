/**
 * FeatureQuotaManager - 免费版功能配额管理
 * 规则：
 * - Markdown 导出：永久总额 20 次
 * - PDF 导出：永久总额 20 次
 * - 延续：每自然月 30 次
 * - 导航：每自然月 500 次
 * - 自定义模板：最多 2 个（按当前数量判断，不做消费计数）
 */

const FeatureQuotaManager = {
  STORAGE_KEY: 'featureQuotaStateV1',
  LIMITS: {
    export: { md: 20, pdf: 20 },
    monthly: { continuation: 30, navigation: 500 },
    templateCustom: 2
  },

  _state: null,
  _memStore: {},

  async init() {
    if (!this._state) {
      const loaded = await this._loadState();
      this._state = this._normalizeState(loaded);
    }
    const changed = this._ensureCurrentMonthlyPeriod();
    if (changed) await this._saveState();
    return this._state;
  },

  isCardUser() {
    if (typeof window === 'undefined') return false;
    try {
      return window.ChatGPTSaver?.AccessManager?.getAccessMode?.() === 'card';
    } catch (e) {
      return false;
    }
  },

  async canUse(feature, amount = 1) {
    await this.init();
    if (this.isCardUser()) {
      return { success: true, unlimited: true, remaining: Number.POSITIVE_INFINITY };
    }

    const need = Math.max(1, Number(amount) || 1);
    const remaining = this._getRemainingByFeature(feature);
    if (remaining >= need) {
      return { success: true, remaining: remaining - need };
    }

    return {
      success: false,
      remaining: Math.max(0, remaining),
      message: this._getExhaustedMessage(feature)
    };
  },

  async consume(feature, amount = 1) {
    await this.init();
    if (this.isCardUser()) {
      return { success: true, unlimited: true, remaining: Number.POSITIVE_INFINITY };
    }

    const need = Math.max(1, Number(amount) || 1);
    const gate = await this.canUse(feature, need);
    if (!gate.success) return gate;

    this._consumeRaw(feature, need);
    await this._saveState();
    return {
      success: true,
      remaining: this._getRemainingByFeature(feature)
    };
  },

  async applyExportFormats(formats = {}) {
    await this.init();
    const normalized = {
      html: formats.html !== false,
      md: formats.md !== false,
      pdf: formats.pdf !== false,
      json: formats.json !== false
    };

    if (this.isCardUser()) {
      return { formats: normalized, blocked: [] };
    }

    const blocked = [];
    if (normalized.md && this._state.exportRemaining.md <= 0) {
      normalized.md = false;
      blocked.push('md');
    }
    if (normalized.pdf && this._state.exportRemaining.pdf <= 0) {
      normalized.pdf = false;
      blocked.push('pdf');
    }

    return { formats: normalized, blocked };
  },

  async consumeExportFormats(savedFormats = []) {
    if (!Array.isArray(savedFormats) || savedFormats.length === 0) return { success: true };
    await this.init();
    if (this.isCardUser()) return { success: true, unlimited: true };

    const consumed = {};
    if (savedFormats.includes('md')) {
      const r = await this.consume('export-md', 1);
      if (!r.success) return r;
      consumed.md = r.remaining;
    }
    if (savedFormats.includes('pdf')) {
      const r = await this.consume('export-pdf', 1);
      if (!r.success) return r;
      consumed.pdf = r.remaining;
    }

    return { success: true, consumed };
  },

  getTemplateCreateSnapshot(customTemplateCount = 0) {
    const count = Math.max(0, Number(customTemplateCount) || 0);
    const limit = this.LIMITS.templateCustom;
    const remaining = Math.max(0, limit - count);
    return {
      limit,
      used: count,
      remaining,
      allowed: this.isCardUser() || remaining > 0
    };
  },

  async getSnapshot(customTemplateCount = 0) {
    await this.init();
    const isCard = this.isCardUser();
    const exportMdRemaining = isCard ? this.LIMITS.export.md : this._state.exportRemaining.md;
    const exportPdfRemaining = isCard ? this.LIMITS.export.pdf : this._state.exportRemaining.pdf;
    const continuationUsed = isCard ? 0 : this._state.monthly.continuationUsed;
    const navigationUsed = isCard ? 0 : this._state.monthly.navigationUsed;
    const template = this.getTemplateCreateSnapshot(customTemplateCount);

    return {
      isCard,
      period: this._state.monthly.period,
      export: {
        md: {
          limit: this.LIMITS.export.md,
          remaining: exportMdRemaining,
          exhausted: !isCard && exportMdRemaining <= 0
        },
        pdf: {
          limit: this.LIMITS.export.pdf,
          remaining: exportPdfRemaining,
          exhausted: !isCard && exportPdfRemaining <= 0
        }
      },
      monthly: {
        continuation: {
          limit: this.LIMITS.monthly.continuation,
          used: continuationUsed,
          remaining: Math.max(0, this.LIMITS.monthly.continuation - continuationUsed),
          exhausted: !isCard && continuationUsed >= this.LIMITS.monthly.continuation
        },
        navigation: {
          limit: this.LIMITS.monthly.navigation,
          used: navigationUsed,
          remaining: Math.max(0, this.LIMITS.monthly.navigation - navigationUsed),
          exhausted: !isCard && navigationUsed >= this.LIMITS.monthly.navigation
        }
      },
      template
    };
  },

  _getRemainingByFeature(feature) {
    switch (feature) {
      case 'export-md':
        return this._state.exportRemaining.md;
      case 'export-pdf':
        return this._state.exportRemaining.pdf;
      case 'continuation':
        return Math.max(0, this.LIMITS.monthly.continuation - this._state.monthly.continuationUsed);
      case 'navigation':
        return Math.max(0, this.LIMITS.monthly.navigation - this._state.monthly.navigationUsed);
      default:
        return 0;
    }
  },

  _consumeRaw(feature, amount) {
    const n = Math.max(1, Number(amount) || 1);
    switch (feature) {
      case 'export-md':
        this._state.exportRemaining.md = Math.max(0, this._state.exportRemaining.md - n);
        break;
      case 'export-pdf':
        this._state.exportRemaining.pdf = Math.max(0, this._state.exportRemaining.pdf - n);
        break;
      case 'continuation':
        this._state.monthly.continuationUsed = Math.min(
          this.LIMITS.monthly.continuation,
          this._state.monthly.continuationUsed + n
        );
        break;
      case 'navigation':
        this._state.monthly.navigationUsed = Math.min(
          this.LIMITS.monthly.navigation,
          this._state.monthly.navigationUsed + n
        );
        break;
      default:
        break;
    }
  },

  _getExhaustedMessage(feature) {
    switch (feature) {
      case 'export-md':
        return `Markdown 导出额度已用完（免费版总额度 ${this.LIMITS.export.md} 次）`;
      case 'export-pdf':
        return `PDF 导出额度已用完（免费版总额度 ${this.LIMITS.export.pdf} 次）`;
      case 'continuation':
        return `延续额度已用完（免费版每月 ${this.LIMITS.monthly.continuation} 次）`;
      case 'navigation':
        return `导航额度已用完（免费版每月 ${this.LIMITS.monthly.navigation} 次）`;
      default:
        return '额度不足';
    }
  },

  _currentMonthlyPeriod() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  },

  _ensureCurrentMonthlyPeriod() {
    const period = this._currentMonthlyPeriod();
    if (this._state.monthly.period === period) return false;
    this._state.monthly.period = period;
    this._state.monthly.continuationUsed = 0;
    this._state.monthly.navigationUsed = 0;
    return true;
  },

  _defaultState() {
    return {
      version: 1,
      exportRemaining: {
        md: this.LIMITS.export.md,
        pdf: this.LIMITS.export.pdf
      },
      monthly: {
        period: this._currentMonthlyPeriod(),
        continuationUsed: 0,
        navigationUsed: 0
      }
    };
  },

  _normalizeState(raw) {
    const defaults = this._defaultState();
    const source = raw && typeof raw === 'object' ? raw : {};
    const exportRemaining = source.exportRemaining && typeof source.exportRemaining === 'object'
      ? source.exportRemaining
      : {};
    const monthly = source.monthly && typeof source.monthly === 'object'
      ? source.monthly
      : {};

    return {
      version: 1,
      exportRemaining: {
        md: this._clamp(exportRemaining.md, 0, this.LIMITS.export.md, this.LIMITS.export.md),
        pdf: this._clamp(exportRemaining.pdf, 0, this.LIMITS.export.pdf, this.LIMITS.export.pdf)
      },
      monthly: {
        period: String(monthly.period || defaults.monthly.period),
        continuationUsed: this._clamp(
          monthly.continuationUsed,
          0,
          this.LIMITS.monthly.continuation,
          0
        ),
        navigationUsed: this._clamp(
          monthly.navigationUsed,
          0,
          this.LIMITS.monthly.navigation,
          0
        )
      }
    };
  },

  _clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  },

  async _loadState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await new Promise((resolve) => {
          chrome.storage.local.get([this.STORAGE_KEY], (r) => resolve(r || {}));
        });
        return result[this.STORAGE_KEY] || this._defaultState();
      }
    } catch (e) {
      // ignore
    }
    return this._memStore[this.STORAGE_KEY] || this._defaultState();
  },

  async _saveState() {
    const payload = { [this.STORAGE_KEY]: this._state };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await new Promise((resolve) => {
          chrome.storage.local.set(payload, resolve);
        });
        return;
      }
    } catch (e) {
      // ignore
    }
    this._memStore[this.STORAGE_KEY] = this._state;
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.FeatureQuotaManager = FeatureQuotaManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FeatureQuotaManager };
}
