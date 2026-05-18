import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  CACHE_TTL_MS,
  CACHE_STORAGE_KEY,
  normalizeClientConfig,
  isCacheFresh,
  createClientConfigCache
} = require('../src/utils/clientConfigCache');

function setupStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    storageGet: vi.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
    storageSet: vi.fn(async (value) => Object.assign(store, value || {}))
  };
}

describe('normalizeClientConfig', () => {
  it('picks the first non-empty notice / upgrade fields and sanitizes URLs', () => {
    const result = normalizeClientConfig({
      plugin_announcement_md: '',
      plugin_announcement: '  hello  ',
      plugin_upgrade_url: 'https://example.com/v2',
      download_url: '',
      latest_version: '2.0.1'
    });
    expect(result.noticeMarkdown).toBe('hello');
    expect(result.upgradeUrl).toBe('https://example.com/v2');
    expect(result.latestVersion).toBe('2.0.1');
  });

  it('discards non-http(s) urls but does NOT fallback to next candidate (regression note: TEST_REPORT low-severity)', () => {
    const result = normalizeClientConfig({
      plugin_upgrade_url: 'javascript:alert(1)',
      download_url: 'https://example.com/v2'
    });
    // 现实现：pickFirstNonEmpty 优先级最高的 javascript:... 被 sanitizeUrl 拒掉后不再去找下一个
    expect(result.upgradeUrl).toBe('');
  });

  it('unwraps payloads wrapped in { data: { ... } }', () => {
    const result = normalizeClientConfig({ data: { announcement: 'wrapped' } });
    expect(result.noticeMarkdown).toBe('wrapped');
  });

  it('returns empty strings for missing fields without throwing', () => {
    expect(normalizeClientConfig(null)).toEqual({
      noticeMarkdown: '',
      upgradeUrl: '',
      latestVersion: '',
      upgradeLabel: '',
      updatedAt: '',
      plugin_announcement_md: '',
      plugin_upgrade_url: '',
      updated_at: ''
    });
  });
});

describe('isCacheFresh', () => {
  it('returns false for null entries or non-numeric now', () => {
    expect(isCacheFresh(null, 1, 1000)).toBe(false);
    expect(isCacheFresh({ fetchedAt: 0 }, NaN, 1000)).toBe(false);
  });

  it('respects ttl window', () => {
    expect(isCacheFresh({ fetchedAt: 100 }, 1050, 1000)).toBe(true);
    expect(isCacheFresh({ fetchedAt: 100 }, 1101, 1000)).toBe(false);
  });
});

describe('createClientConfigCache.fetchWithCache', () => {
  let now;
  let cache;
  let storage;

  beforeEach(() => {
    now = 100_000;
    storage = setupStorage();
    cache = createClientConfigCache({
      ttlMs: 1000,
      cacheKey: CACHE_STORAGE_KEY,
      now: () => now,
      storageGet: storage.storageGet,
      storageSet: storage.storageSet
    });
  });

  it('uses memory cache when fresh and skips fetcher', async () => {
    await cache.setCached({ plugin_announcement_md: 'first' }, now - 100);
    const fetcher = vi.fn();
    const result = await cache.fetchWithCache(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.source).toBe('memory');
    expect(result.stale).toBe(false);
  });

  it('returns stale-cache fallback when fetcher throws and cache is expired', async () => {
    await cache.setCached({ plugin_announcement_md: 'old' }, now - 50_000);
    cache.clearMemoryCache();
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await cache.fetchWithCache(fetcher, { forceRefresh: false });
    expect(result.success).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.source).toBe('stale-cache');
    expect(result.error).toBe('network down');
    expect(result.data.noticeMarkdown).toBe('old');
  });

  it('returns empty failure when fetcher throws and no cache exists', async () => {
    storage = setupStorage();
    cache = createClientConfigCache({
      ttlMs: 1000,
      cacheKey: 'foo',
      now: () => now,
      storageGet: storage.storageGet,
      storageSet: storage.storageSet
    });
    const result = await cache.fetchWithCache(async () => {
      throw new Error('nope');
    });
    expect(result.success).toBe(false);
    expect(result.source).toBe('empty');
    expect(result.error).toBe('nope');
  });

  it('forceRefresh bypasses memory + storage cache and always calls fetcher', async () => {
    await cache.setCached({ plugin_announcement_md: 'old' }, now - 100);
    const fetcher = vi.fn(async () => ({ plugin_announcement_md: 'new' }));
    const result = await cache.fetchWithCache(fetcher, { forceRefresh: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.source).toBe('network');
    expect(result.data.noticeMarkdown).toBe('new');
  });
});

describe('createClientConfigCache.getCached', () => {
  it('returns null when no cache and allowStale is false', async () => {
    const storage = setupStorage();
    const cache = createClientConfigCache({
      ttlMs: 1000,
      now: () => 100,
      storageGet: storage.storageGet,
      storageSet: storage.storageSet
    });
    const result = await cache.getCached({ allowStale: false });
    expect(result).toBeNull();
  });

  it('returns stale entry with stale: true flag when allowStale is true', async () => {
    const storage = setupStorage();
    const cache = createClientConfigCache({
      ttlMs: 1000,
      now: () => 10_000,
      storageGet: storage.storageGet,
      storageSet: storage.storageSet
    });
    await cache.setCached({ plugin_announcement_md: 'expired' }, 1_000);
    cache.clearMemoryCache();
    const result = await cache.getCached({ allowStale: true });
    expect(result).not.toBeNull();
    expect(result.stale).toBe(true);
    expect(result.config.noticeMarkdown).toBe('expired');
  });
});

describe('module exports', () => {
  it('exposes a CACHE_TTL_MS constant of 10 minutes', () => {
    expect(CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
