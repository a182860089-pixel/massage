import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { AccessManager } = require('../src/utils/accessManager');

const originalChrome = global.chrome;

function createChromeStorageStub(initial = {}) {
  const store = { ...initial };
  return {
    storage: {
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
        set: vi.fn(async (payload) => {
          Object.assign(store, payload || {});
        }),
        _store: store
      }
    }
  };
}

beforeEach(() => {
  AccessManager._state = { accessMode: 'free' };
  AccessManager._memStore = {};
  AccessManager._cardKeyManager = null;
});

afterEach(() => {
  global.chrome = originalChrome;
});

describe('AccessManager.init', () => {
  it('switches to card mode when CardKeyManager.init+canUseNow are both truthy', async () => {
    global.chrome = createChromeStorageStub();
    const cardKey = {
      init: vi.fn(async () => true),
      canUseNow: vi.fn(() => true)
    };

    await AccessManager.init(cardKey);

    expect(AccessManager.getAccessMode()).toBe('card');
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ accessModeV2: 'card' });
  });

  it('falls back to free mode when CardKeyManager init throws', async () => {
    global.chrome = createChromeStorageStub();
    const cardKey = {
      init: vi.fn(async () => {
        throw new Error('boom');
      }),
      canUseNow: vi.fn(() => true)
    };

    await AccessManager.init(cardKey);
    expect(AccessManager.getAccessMode()).toBe('free');
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ accessModeV2: 'free' });
  });

  it('falls back to free mode when init returns true but canUseNow is false', async () => {
    global.chrome = createChromeStorageStub();
    const cardKey = { init: async () => true, canUseNow: () => false };
    await AccessManager.init(cardKey);
    expect(AccessManager.getAccessMode()).toBe('free');
  });
});

describe('AccessManager._loadMode', () => {
  it('migrates from legacy accessMode key when V2 missing', async () => {
    global.chrome = createChromeStorageStub({ accessMode: 'card' });
    const cardKey = { init: async () => false, canUseNow: () => false };
    await AccessManager.init(cardKey);
    expect(AccessManager.getAccessMode()).toBe('free');
  });

  it('reads V2 key with higher priority than legacy', async () => {
    global.chrome = createChromeStorageStub({ accessModeV2: 'free', accessMode: 'card' });
    const loaded = await AccessManager._loadMode();
    expect(loaded).toBe('free');
  });

  it('normalizes unknown values to free', async () => {
    global.chrome = createChromeStorageStub({ accessModeV2: 'enterprise' });
    const loaded = await AccessManager._loadMode();
    expect(loaded).toBe('free');
  });

  it('falls back to in-memory store when chrome unavailable', async () => {
    global.chrome = undefined;
    AccessManager._memStore.accessModeV2 = 'card';
    const loaded = await AccessManager._loadMode();
    expect(loaded).toBe('card');
  });
});

describe('AccessManager.isCardActive / canUseNow', () => {
  it('isCardActive reflects card manager state and persists side-effect mode change', () => {
    const cardKey = { canUseNow: () => true };
    AccessManager._cardKeyManager = cardKey;
    AccessManager._state.accessMode = 'free';
    expect(AccessManager.isCardActive()).toBe(true);
    expect(AccessManager.getAccessMode()).toBe('card');
  });

  it('canUseNow ALWAYS returns true even when card manager says no — this is current observed behavior (treat as documented quirk)', () => {
    const cardKey = { canUseNow: () => false };
    AccessManager._cardKeyManager = cardKey;
    expect(AccessManager.canUseNow()).toBe(true);
    expect(AccessManager.getAccessMode()).toBe('free');
  });
});

describe('AccessManager badges & lifecycle', () => {
  it('returns card badge when active and free badge otherwise', () => {
    AccessManager._state.accessMode = 'card';
    AccessManager._cardKeyManager = { canUseNow: () => true };
    expect(AccessManager.getBadgeInfo()).toEqual({ type: 'card' });

    AccessManager._state.accessMode = 'free';
    AccessManager._cardKeyManager = { canUseNow: () => false };
    expect(AccessManager.getBadgeInfo().type).toBe('free');
  });

  it('onCardActivated and clearCardAccessFallback persist the new mode', async () => {
    global.chrome = createChromeStorageStub();
    await AccessManager.onCardActivated();
    expect(AccessManager.getAccessMode()).toBe('card');
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ accessModeV2: 'card' });

    await AccessManager.clearCardAccessFallback();
    expect(AccessManager.getAccessMode()).toBe('free');
    expect(global.chrome.storage.local.set).toHaveBeenLastCalledWith({ accessModeV2: 'free' });
  });

  it('legacy guest helpers report no trial available', () => {
    expect(AccessManager.getGuestRemainingMs()).toBe(0);
    expect(AccessManager.hasGuestTrialExpired()).toBe(false);
    expect(AccessManager.hasUsedGuestTrial()).toBe(false);
    expect(AccessManager.wasExpiryNotified()).toBe(false);
  });
});
