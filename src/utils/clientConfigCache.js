/**
 * Client config cache helpers.
 * Works in both browser (global attach) and Node tests (module.exports).
 */

(function initClientConfigCache(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ChatGPTSaver = root.ChatGPTSaver || {};
    root.ChatGPTSaver.ClientConfigCache = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createClientConfigCacheApi() {
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const CACHE_STORAGE_KEY = 'pluginClientConfigCacheV1';

  function toTrimmedString(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  function pickFirstNonEmptyString(values) {
    if (!Array.isArray(values)) return '';
    for (let i = 0; i < values.length; i += 1) {
      const v = toTrimmedString(values[i]);
      if (v) return v;
    }
    return '';
  }

  function sanitizeUrl(value) {
    const candidate = toTrimmedString(value);
    if (!candidate) return '';
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function normalizeClientConfig(payload) {
    const rootPayload = payload && typeof payload === 'object' ? payload : {};
    const source = rootPayload.data && typeof rootPayload.data === 'object'
      ? rootPayload.data
      : rootPayload;

    const noticeMarkdown = pickFirstNonEmptyString([
      source.plugin_announcement_md,
      source.pluginAnnouncementMd,
      source.plugin_announcement,
      source.pluginAnnouncement,
      source.notice_markdown,
      source.noticeMarkdown,
      source.announcement_markdown,
      source.announcementMarkdown,
      source.notice,
      source.announcement,
      source.content
    ]);

    const upgradeUrl = sanitizeUrl(pickFirstNonEmptyString([
      source.plugin_upgrade_url,
      source.pluginUpgradeUrl,
      source.upgrade_url,
      source.upgradeUrl,
      source.upgrade_link,
      source.upgradeLink,
      source.download_url,
      source.downloadUrl
    ]));

    const updatedAt = pickFirstNonEmptyString([
      source.updated_at,
      source.updatedAt,
      source.update_time,
      source.updateTime
    ]);

    const latestVersion = pickFirstNonEmptyString([
      source.latest_version,
      source.latestVersion,
      source.plugin_version,
      source.pluginVersion,
      source.version
    ]);

    const upgradeLabel = pickFirstNonEmptyString([
      source.upgrade_label,
      source.upgradeLabel,
      source.upgrade_text,
      source.upgradeText
    ]);

    return {
      noticeMarkdown,
      upgradeUrl,
      latestVersion,
      upgradeLabel,
      updatedAt,
      plugin_announcement_md: noticeMarkdown,
      plugin_upgrade_url: upgradeUrl,
      updated_at: updatedAt
    };
  }

  function toCacheEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return null;
    const fetchedAt = Number(rawEntry.fetchedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
    const normalizedConfig = normalizeClientConfig(rawEntry.config);
    return {
      fetchedAt,
      config: normalizedConfig
    };
  }

  function isCacheFresh(entry, now, ttlMs) {
    if (!entry) return false;
    const currentNow = Number(now);
    if (!Number.isFinite(currentNow)) return false;
    return (currentNow - entry.fetchedAt) < ttlMs;
  }

  function normalizeStorageReadResult(rawResult, cacheKey) {
    if (!rawResult || typeof rawResult !== 'object') return null;

    if (Object.prototype.hasOwnProperty.call(rawResult, cacheKey)) {
      return toCacheEntry(rawResult[cacheKey]);
    }

    return toCacheEntry(rawResult);
  }

  function createClientConfigCache(options = {}) {
    const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : CACHE_TTL_MS;
    const cacheKey = options.cacheKey || CACHE_STORAGE_KEY;
    const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
    const storageGet = typeof options.storageGet === 'function'
      ? options.storageGet
      : async () => ({});
    const storageSet = typeof options.storageSet === 'function'
      ? options.storageSet
      : async () => {};

    let memoryCache = null;

    async function readStorageEntry() {
      try {
        const raw = await storageGet(cacheKey);
        return normalizeStorageReadResult(raw, cacheKey);
      } catch (error) {
        return null;
      }
    }

    async function writeStorageEntry(entry) {
      const safeEntry = toCacheEntry(entry);
      if (!safeEntry) return;
      try {
        await storageSet({ [cacheKey]: safeEntry });
      } catch (error) {
        // ignore storage write failures
      }
    }

    async function getCached(options = {}) {
      const allowStale = options.allowStale !== false;
      const now = nowFn();

      if (memoryCache) {
        if (allowStale || isCacheFresh(memoryCache, now, ttlMs)) {
          return {
            ...memoryCache,
            stale: !isCacheFresh(memoryCache, now, ttlMs),
            source: 'memory'
          };
        }
      }

      const stored = await readStorageEntry();
      if (!stored) return null;
      memoryCache = stored;

      if (!allowStale && !isCacheFresh(stored, now, ttlMs)) {
        return null;
      }

      return {
        ...stored,
        stale: !isCacheFresh(stored, now, ttlMs),
        source: 'storage'
      };
    }

    async function setCached(config, fetchedAt = nowFn()) {
      const entry = toCacheEntry({
        fetchedAt,
        config: normalizeClientConfig(config)
      });
      if (!entry) return null;
      memoryCache = entry;
      await writeStorageEntry(entry);
      return entry;
    }

    async function fetchWithCache(fetcher, options = {}) {
      const forceRefresh = options.forceRefresh === true;
      const now = nowFn();

      if (!forceRefresh) {
        if (memoryCache && isCacheFresh(memoryCache, now, ttlMs)) {
          return {
            success: true,
            data: memoryCache.config,
            stale: false,
            source: 'memory',
            fetchedAt: memoryCache.fetchedAt
          };
        }

        const storedFresh = await getCached({ allowStale: false });
        if (storedFresh) {
          return {
            success: true,
            data: storedFresh.config,
            stale: false,
            source: storedFresh.source,
            fetchedAt: storedFresh.fetchedAt
          };
        }
      }

      const fallbackCache = await getCached({ allowStale: true });

      try {
        if (typeof fetcher !== 'function') {
          throw new Error('fetcher is required');
        }
        const payload = await fetcher();
        const normalized = normalizeClientConfig(payload);
        const entry = await setCached(normalized, nowFn());
        return {
          success: true,
          data: entry ? entry.config : normalized,
          stale: false,
          source: 'network',
          fetchedAt: entry ? entry.fetchedAt : nowFn()
        };
      } catch (error) {
        const message = error && error.message ? String(error.message) : 'fetch failed';
        if (fallbackCache) {
          return {
            success: true,
            data: fallbackCache.config,
            stale: true,
            source: 'stale-cache',
            fetchedAt: fallbackCache.fetchedAt,
            error: message
          };
        }

        return {
          success: false,
          data: null,
          stale: false,
          source: 'empty',
          fetchedAt: null,
          error: message
        };
      }
    }

    return {
      ttlMs,
      cacheKey,
      getCached,
      setCached,
      fetchWithCache,
      clearMemoryCache() {
        memoryCache = null;
      },
      _debugGetMemoryCache() {
        return memoryCache ? { ...memoryCache } : null;
      }
    };
  }

  return {
    CACHE_TTL_MS,
    CACHE_STORAGE_KEY,
    normalizeClientConfig,
    isCacheFresh,
    createClientConfigCache
  };
});
