/**
 * Fetch 拦截器 - 运行在页面主世界 (MAIN world)
 * 拦截 ChatGPT 请求并发送:
 * - SAVER_USAGE_RECORD (兼容旧版)
 * - SAVER_USAGE_RECORD_V2 (新版用量统计)
 * - SAVER_RUNTIME_METRIC (PoW / 账号信号)
 */
(function () {
  'use strict';

  if (window.fetch.__saverUsagePatched) return;

  const originalFetch = window.fetch;
  const pendingAutoRequests = new Map();

  const normalizeModelKey = (value) => {
    const model = String(value || '').toLowerCase().trim();
    if (!model) return null;
    if (model === 'auto') return 'gpt-5-2';
    if (model === 'gpt-5-2-instant') return 'gpt-5-2';
    if (model === 'gpt-5-2-thinking' || model === 'gpt-5-1-thinking') return 'gpt-5-thinking';
    if (model === 'gpt-5-2-pro' || model === 'gpt-5-1-pro') return 'gpt-5-pro';
    if (model === 'gpt-4-1') return 'gpt-4.1';
    return model;
  };

  const mapRoutedSlugToModelKey = (baseKey, routedSlug, didAutoSwitch) => {
    const slug = String(routedSlug || '').toLowerCase();
    const normalizedBase = normalizeModelKey(baseKey);
    if (normalizedBase === 'gpt-5-2') {
      if (slug.includes('pro')) return 'gpt-5-pro';
      if (didAutoSwitch === true || slug.includes('thinking') || slug.includes('reasoning')) return 'gpt-5-thinking';
      return 'gpt-5-2';
    }
    return normalizeModelKey(slug || normalizedBase);
  };

  const postUsage = (modelKey, extra = {}) => {
    const normalized = normalizeModelKey(modelKey);
    if (!normalized) return;
    window.postMessage({ type: 'SAVER_USAGE_RECORD', modelKey: normalized }, '*');
    window.postMessage({
      type: 'SAVER_USAGE_RECORD_V2',
      modelKey: normalized,
      timestamp: Date.now(),
      ...extra
    }, '*');
  };

  const postRuntimeMetric = (metric) => {
    if (!metric || typeof metric !== 'object') return;
    window.postMessage({ type: 'SAVER_RUNTIME_METRIC', metric }, '*');
  };

  const resolveAutoRequest = (requestId, routed) => {
    const req = pendingAutoRequests.get(requestId);
    if (!req || req.resolved) return;
    const modelKey = mapRoutedSlugToModelKey(req.baseModelKey, routed?.modelSlug, routed?.didAutoSwitchToReasoning);
    req.resolved = true;
    postUsage(modelKey, { source: 'auto-routing', requestId });
    pendingAutoRequests.delete(requestId);
  };

  const parseSse = async (response, onJson) => {
    const body = response?.body;
    if (!body || typeof body.getReader !== 'function') return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const dataLines = rawEvent
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart());
          if (!dataLines.length) continue;
          const data = dataLines.join('\n');
          if (!data || data === '[DONE]') continue;
          try {
            onJson(JSON.parse(data));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  };

  const extractRoutingInfo = (json) => {
    if (!json || typeof json !== 'object') return null;
    const ste = json.server_ste_metadata || json;
    if (ste && (ste.type === 'server_ste_metadata' || json.type === 'server_ste_metadata')) {
      const modelSlug = ste.model_slug || ste.model || ste.modelSlug;
      const didAutoSwitch = ste.did_auto_switch_to_reasoning ?? ste.didAutoSwitchToReasoning;
      if (modelSlug || didAutoSwitch !== undefined) {
        return { modelSlug, didAutoSwitchToReasoning: didAutoSwitch };
      }
    }
    const message = json.message;
    const metadata = message?.metadata;
    const modelSlug = metadata?.model_slug || metadata?.modelSlug;
    if (modelSlug) return { modelSlug };
    return null;
  };

  const pickFirstFinite = (...values) => {
    for (const v of values) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  };

  const extractPowValue = (json) => {
    if (!json || typeof json !== 'object') return null;
    const ste = json.server_ste_metadata || {};
    const msgMeta = json.message?.metadata || {};
    const obj = json || {};
    return pickFirstFinite(
      obj.pow_difficulty,
      obj.powDifficulty,
      obj.pow,
      ste.pow_difficulty,
      ste.powDifficulty,
      ste.pow,
      msgMeta.pow_difficulty,
      msgMeta.powDifficulty,
      msgMeta.pow
    );
  };

  const normalizeAccountType = (value) => {
    const text = String(value || '').toLowerCase().trim();
    if (!text) return null;
    if (text.includes('enterprise') || text.includes('企业')) return 'enterprise';
    if (text.includes('team')) return 'team';
    if (text.includes('plus')) return 'plus';
    if (text.includes('pro')) return 'pro';
    if (text.includes('free') || text.includes('免费')) return 'free';
    return null;
  };

  const extractAccountType = (json) => {
    if (!json || typeof json !== 'object') return null;
    const candidates = [
      json.account_type,
      json.accountType,
      json.plan_type,
      json.planType,
      json.workspace?.plan_type,
      json.workspace?.planType,
      json.message?.metadata?.account_type,
      json.message?.metadata?.plan_type
    ];
    for (const c of candidates) {
      const mapped = normalizeAccountType(c);
      if (mapped) return mapped;
    }
    return null;
  };

  const interceptFileUpload = (url, init) => {
    try {
      const body = init?.body;
      if (!body || !(body instanceof FormData)) return;
      if (!String(url || '').includes('/files')) return;
      const fileObjects = [];
      for (const [, value] of body.entries()) {
        if (value instanceof File) fileObjects.push(value);
      }
      if (!fileObjects.length) return;
      window.postMessage({ type: 'SAVER_FILE_UPLOADED', files: fileObjects }, '*');
    } catch {
      // ignore
    }
  };

  window.fetch = new Proxy(originalFetch, {
    apply: async function (target, thisArg, args) {
      let autoRequestId = null;
      const [info, init] = args;
      const url = typeof info === 'string' ? info : info?.url || '';
      const method = init?.method || (typeof info === 'object' && info?.method) || 'GET';

      if (method === 'POST') interceptFileUpload(url, init);

      try {
        if (method === 'POST' && String(url).includes('/conversation') && !String(url).includes('/conversations')) {
          const bodyRaw = init?.body;
          if (typeof bodyRaw === 'string' && bodyRaw.trim()) {
            const body = JSON.parse(bodyRaw);
            const normalized = normalizeModelKey(body?.model);
            if (normalized) {
              if (normalized === 'gpt-5-2') {
                autoRequestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                pendingAutoRequests.set(autoRequestId, {
                  baseModelKey: normalized,
                  startedAt: Date.now(),
                  resolved: false
                });
                setTimeout(() => {
                  const req = pendingAutoRequests.get(autoRequestId);
                  if (req && !req.resolved) {
                    postUsage(req.baseModelKey, { source: 'request-timeout', requestId: autoRequestId });
                    pendingAutoRequests.delete(autoRequestId);
                  }
                }, 60 * 1000);
              } else {
                postUsage(normalized, { source: 'request' });
              }
            }
          }
        }
      } catch {
        // ignore
      }

      const response = await target.apply(thisArg, args);

      if (autoRequestId || String(url).includes('/conversation')) {
        try {
          const clone = response.clone();
          parseSse(clone, (json) => {
            const info = extractRoutingInfo(json);
            if (info && autoRequestId) resolveAutoRequest(autoRequestId, info);

            const powValue = extractPowValue(json);
            const accountType = extractAccountType(json);
            if (powValue !== null || accountType) {
              postRuntimeMetric({
                powValue: powValue !== null ? powValue : null,
                accountType: accountType || null,
                timestamp: Date.now()
              });
            }
          });
        } catch {
          // ignore
        }
      }

      return response;
    }
  });
  window.fetch.__saverUsagePatched = true;

  // XHR 文件上传兼容
  if (!XMLHttpRequest.prototype.__saverFilePatched) {
    const origSend = XMLHttpRequest.prototype.send;
    const origOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__saverUrl = url;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (body instanceof FormData && String(this.__saverUrl || '').includes('/files')) {
          const files = [];
          for (const [, value] of body.entries()) {
            if (value instanceof File) files.push(value);
          }
          if (files.length) {
            window.postMessage({ type: 'SAVER_FILE_UPLOADED', files }, '*');
          }
        }
      } catch {
        // ignore
      }
      return origSend.call(this, body);
    };

    XMLHttpRequest.prototype.__saverFilePatched = true;
  }
})();
