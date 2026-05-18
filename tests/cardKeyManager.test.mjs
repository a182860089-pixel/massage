import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCardKeyManager } from './helpers/loadCardKeyManager.mjs';

function makeChromeStub(storageInit = {}, runtimeImpl = vi.fn((msg, cb) => cb({}))) {
  const store = { ...storageInit };
  const storage = {
    local: {
      get: vi.fn(async (keys) => {
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
        }
        if (typeof keys === 'string') {
          return keys in store ? { [keys]: store[keys] } : {};
        }
        return { ...store };
      }),
      set: vi.fn(async (payload) => Object.assign(store, payload || {})),
      remove: vi.fn(async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete store[k]);
      })
    }
  };
  return {
    chrome: { storage, runtime: { sendMessage: runtimeImpl } },
    store
  };
}

let CardKeyManager;
let chromeStub;
let store;
let accessManager;
let ui;

beforeEach(() => {
  const built = makeChromeStub();
  chromeStub = built.chrome;
  store = built.store;
  accessManager = {
    clearCardAccessFallback: vi.fn(async () => {}),
    onCardActivated: vi.fn(async () => {})
  };
  ui = {
    updateCardKeyBadge: vi.fn(),
    showCardKeyOverlay: vi.fn(),
    refreshFeatureQuotaIndicators: vi.fn()
  };
  CardKeyManager = loadCardKeyManager({
    AccessManager: accessManager,
    UI: ui,
    chrome: chromeStub,
    cryptoMock: { randomUUID: () => 'uuid-stub-1234' },
    windowMock: { ChatGPTSaver: { UI: ui } }
  });
});

afterEach(() => {
  if (CardKeyManager?.stopStatusRecheck) CardKeyManager.stopStatusRecheck();
});

describe('CardKeyManager normalize helpers', () => {
  it('normalizeNumber returns finite number, null for invalid', () => {
    expect(CardKeyManager.normalizeNumber('5')).toBe(5);
    expect(CardKeyManager.normalizeNumber(0)).toBe(0);
    expect(CardKeyManager.normalizeNumber('')).toBeNull();
    expect(CardKeyManager.normalizeNumber(null)).toBeNull();
    expect(CardKeyManager.normalizeNumber('abc')).toBeNull();
  });

  it('normalizeCardData trims inputs and copies expected fields', () => {
    const data = CardKeyManager.normalizeCardData(
      { expires_at: '2030-01-01', remaining_days: 10, card_type: 'DAYPASS', authorized: true, status: 'ok' },
      '  KEY-1  ',
      ' user@example.com ',
      'cid-1'
    );
    expect(data.card_key).toBe('KEY-1');
    expect(data.email).toBe('user@example.com');
    expect(data.client_id).toBe('cid-1');
    expect(data.card_type).toBe('daypass');
    expect(data.authorized).toBe(true);
    expect(data.remaining_days).toBe(10);
    expect(typeof data.lastCheckTime).toBe('number');
  });
});

describe('CardKeyManager card-type predicates', () => {
  it('isUnlimited / isDaypass detect card_type case-insensitively', () => {
    CardKeyManager.cardData = { card_type: 'Unlimited' };
    expect(CardKeyManager.isUnlimited()).toBe(true);
    expect(CardKeyManager.isDaypass()).toBe(false);

    CardKeyManager.cardData = { card_type: 'daypass' };
    expect(CardKeyManager.isDaypass()).toBe(true);
    expect(CardKeyManager.isUnlimited()).toBe(false);
  });

  it('getExpiryTimestamp accepts alternate field names', () => {
    const ts = CardKeyManager.getExpiryTimestamp({ expiry_at: '2030-01-01T00:00:00Z' });
    expect(ts).toBe(Date.parse('2030-01-01T00:00:00Z'));
    expect(CardKeyManager.getExpiryTimestamp({})).toBeNull();
    expect(CardKeyManager.getExpiryTimestamp({ expires_at: 'not-a-date' })).toBeNull();
  });
});

describe('CardKeyManager.isCardUsable', () => {
  it('returns true for unlimited card unless authorized=false', () => {
    expect(CardKeyManager.isCardUsable({ card_type: 'unlimited', authorized: true })).toBe(true);
    expect(CardKeyManager.isCardUsable({ card_type: 'unlimited', authorized: false })).toBe(false);
    expect(CardKeyManager.isCardUsable({ card_type: 'unlimited' })).toBe(true);
  });

  it('returns true for time-limited card when authorized and not expired', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(CardKeyManager.isCardUsable({ card_type: 'time', authorized: true, expires_at: future })).toBe(true);
  });

  it('returns false when authorized is false or expires_at is past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(CardKeyManager.isCardUsable({ card_type: 'time', authorized: false, expires_at: future })).toBe(false);
    expect(CardKeyManager.isCardUsable({ card_type: 'time', authorized: true, expires_at: past })).toBe(false);
    expect(CardKeyManager.isCardUsable({ card_type: 'time', authorized: true })).toBe(false);
  });
});

describe('CardKeyManager.canUseNow auto-clear side effect', () => {
  it('returns true for valid card without clearing', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    CardKeyManager.verified = true;
    CardKeyManager.cardData = { card_type: 'time', authorized: true, expires_at: future };
    expect(CardKeyManager.canUseNow()).toBe(true);
    expect(CardKeyManager.verified).toBe(true);
  });

  it('returns false and clears state when card is expired and autoClear default', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    CardKeyManager.verified = true;
    CardKeyManager.cardData = { card_type: 'time', authorized: true, expires_at: past };
    const result = CardKeyManager.canUseNow();
    expect(result).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(CardKeyManager.verified).toBe(false);
    expect(CardKeyManager.cardData).toBeNull();
  });

  it('autoClear: false leaves state intact when card invalid', () => {
    CardKeyManager.verified = true;
    CardKeyManager.cardData = { card_type: 'unlimited', authorized: false };
    const result = CardKeyManager.canUseNow({ autoClear: false });
    expect(result).toBe(false);
    expect(CardKeyManager.verified).toBe(true);
  });
});

describe('CardKeyManager.getUnavailableMessage', () => {
  it('returns expiry-specific text for daypass when expired', () => {
    const data = { card_type: 'daypass', expires_at: new Date(Date.now() - 1000).toISOString() };
    expect(CardKeyManager.getUnavailableMessage(data)).toContain('日抛');
  });

  it('returns generic expired text for time card when expired', () => {
    const data = { card_type: 'time', expires_at: new Date(Date.now() - 1000).toISOString() };
    expect(CardKeyManager.getUnavailableMessage(data)).toContain('到期');
  });
});

describe('CardKeyManager.ensureClientId', () => {
  it('generates and persists a UUID when nothing in storage', async () => {
    const cid = await CardKeyManager.ensureClientId();
    expect(cid).toBe('uuid-stub-1234');
    expect(store.pluginClientId).toBe('uuid-stub-1234');
  });

  it('reuses existing storage clientId if present', async () => {
    store.pluginClientId = 'prev-cid';
    const cid = await CardKeyManager.ensureClientId();
    expect(cid).toBe('prev-cid');
  });

  it('falls back to passed-in candidate before reading storage', async () => {
    const cid = await CardKeyManager.ensureClientId('hint');
    expect(cid).toBe('hint');
  });
});

describe('CardKeyManager.requestAndApplyCardData', () => {
  it('rejects empty card_key or email immediately', async () => {
    const result = await CardKeyManager.requestAndApplyCardData({
      action: 'pluginActivateCardKey',
      cardKey: '',
      email: ''
    });
    expect(result.valid).toBe(false);
    expect(result.message).toContain('请填写');
  });

  it('persists data and starts recheck on success', async () => {
    chromeStub.runtime.sendMessage = vi.fn((msg, cb) => {
      cb({ success: true, message: 'ok', data: { authorized: true, card_type: 'unlimited' } });
    });

    const result = await CardKeyManager.requestAndApplyCardData({
      action: 'pluginActivateCardKey',
      cardKey: 'K',
      email: 'a@b.com'
    });

    expect(result.valid).toBe(true);
    expect(CardKeyManager.verified).toBe(true);
    expect(store.cardKeyData?.card_key).toBe('K');
    expect(CardKeyManager.recheckTimer).not.toBeNull();
  });

  it('does NOT clear local data when clearOnInvalid=false and response is invalid', async () => {
    CardKeyManager.cardData = { card_key: 'K', card_type: 'unlimited', authorized: true };
    CardKeyManager.verified = true;
    chromeStub.runtime.sendMessage = vi.fn((msg, cb) => cb({ success: false, message: 'bad' }));

    const result = await CardKeyManager.requestAndApplyCardData({
      action: 'pluginActivateCardKey',
      cardKey: 'K',
      email: 'a@b.com',
      clearOnInvalid: false
    });
    expect(result.valid).toBe(false);
    expect(CardKeyManager.verified).toBe(true);
  });

  it('post-fix: status check on network_error response keeps local cache intact', async () => {
    CardKeyManager.cardData = { card_key: 'K', email: 'a@b.com', card_type: 'unlimited', authorized: true };
    CardKeyManager.verified = true;
    chromeStub.runtime.sendMessage = vi.fn((msg, cb) =>
      cb({ success: false, network_error: true, message: '网络错误: timeout', data: { authorized: false } })
    );

    const result = await CardKeyManager.checkStatus('K', 'a@b.com', { clearOnInvalid: true });
    expect(result.valid).toBe(false);
    expect(result.networkError).toBe(true);
    expect(CardKeyManager.cardData).not.toBeNull();
    expect(CardKeyManager.verified).toBe(true);
    expect(accessManager.clearCardAccessFallback).not.toHaveBeenCalled();
  });

  it('business failure (no network_error flag) still clears cache as before', async () => {
    CardKeyManager.cardData = { card_key: 'K', email: 'a@b.com', card_type: 'unlimited', authorized: true };
    CardKeyManager.verified = true;
    chromeStub.runtime.sendMessage = vi.fn((msg, cb) =>
      cb({ success: false, message: '卡密已被禁用', data: { authorized: false } })
    );

    const result = await CardKeyManager.checkStatus('K', 'a@b.com', { clearOnInvalid: true });
    expect(result.valid).toBe(false);
    expect(CardKeyManager.cardData).toBeNull();
    expect(CardKeyManager.verified).toBe(false);
    expect(accessManager.clearCardAccessFallback).toHaveBeenCalled();
  });
});

describe('CardKeyManager.startStatusRecheck interval selection', () => {
  it('uses daypassRecheckInterval (10 min) for daypass cards', () => {
    CardKeyManager.cardData = { card_key: 'K', email: 'a@b.com', card_type: 'daypass' };
    CardKeyManager.startStatusRecheck();
    expect(CardKeyManager.recheckInterval).toBe(CardKeyManager.daypassRecheckInterval);
  });

  it('uses defaultRecheckInterval (6 h) for non-daypass cards', () => {
    CardKeyManager.cardData = { card_key: 'K', email: 'a@b.com', card_type: 'unlimited' };
    CardKeyManager.startStatusRecheck();
    expect(CardKeyManager.recheckInterval).toBe(CardKeyManager.defaultRecheckInterval);
  });

  it('does not start a timer if cardData is missing required fields', () => {
    CardKeyManager.cardData = { card_key: 'K' };
    CardKeyManager.recheckTimer = null;
    CardKeyManager.startStatusRecheck();
    expect(CardKeyManager.recheckTimer).toBeNull();
  });
});

describe('CardKeyManager.init hydration', () => {
  it('returns false and stays unverified when no cached cardKeyData', async () => {
    const ok = await CardKeyManager.init();
    expect(ok).toBe(false);
    expect(CardKeyManager.verified).toBe(false);
  });

  it('hydrates from cached cardKeyData if still usable', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    store.cardKeyData = {
      card_key: 'K',
      email: 'a@b.com',
      card_type: 'time',
      authorized: true,
      expires_at: future
    };
    const ok = await CardKeyManager.init();
    expect(ok).toBe(true);
    expect(CardKeyManager.verified).toBe(true);
    expect(CardKeyManager.cardData?.card_key).toBe('K');
  });

  it('discards cached cardKeyData when no longer usable', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    store.cardKeyData = {
      card_key: 'K',
      email: 'a@b.com',
      card_type: 'time',
      authorized: true,
      expires_at: past
    };
    const ok = await CardKeyManager.init();
    expect(ok).toBe(false);
    expect(CardKeyManager.verified).toBe(false);
    expect(store.cardKeyData).toBeUndefined();
  });
});
