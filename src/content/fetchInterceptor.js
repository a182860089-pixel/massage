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
  const pendingConversationRequests = new Map();

  const normalizeModelKey = (value) => {
    const model = String(value || '').toLowerCase().trim();
    if (!model) return null;
    if (model.includes('thinking') || model.includes('reasoning')) return 'gpt-5-2-thinking';
    if (model.includes('instant')) return 'gpt-5-2-instant';
    if (model.includes('pro')) return 'gpt-5-2-pro';
    if (model === 'auto') return 'gpt-5-2';
    if (model === 'gpt-5-2-instant' || model === 'gpt-5-instant' || model === 'gpt-5' || model === 'gpt-5-1' || model === 'gpt-5.1') return 'gpt-5-2-instant';
    if (model === 'gpt-5-2-thinking' || model === 'gpt-5-1-thinking' || model === 'gpt-5-thinking' || model === 'reasoning') return 'gpt-5-2-thinking';
    if (model === 'gpt-5-2-pro' || model === 'gpt-5-1-pro' || model === 'gpt-5-pro') return 'gpt-5-2-pro';
    if (model === 'gpt-5.2' || model === 'gpt5.2') return 'gpt-5-2';
    return model;
  };

  const mapRoutedSlugToModelKey = (baseKey, routedSlug, didAutoSwitch) => {
    const slug = String(routedSlug || '').toLowerCase();
    const normalizedBase = normalizeModelKey(baseKey);
    if (normalizedBase === 'gpt-5-2') {
      if (slug.includes('pro')) return 'gpt-5-2-pro';
      if (didAutoSwitch === true || slug.includes('thinking') || slug.includes('reasoning')) return 'gpt-5-2-thinking';
      if (slug.includes('instant')) return 'gpt-5-2-instant';
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

  const resolveConversationRequest = (requestId, routed, source = 'response-routing') => {
    const req = pendingConversationRequests.get(requestId);
    if (!req || req.resolved) return;
    let modelKey = null;
    if (routed?.modelSlug || routed?.didAutoSwitchToReasoning !== undefined) {
      modelKey = mapRoutedSlugToModelKey(req.baseModelKey || 'gpt-5-2', routed?.modelSlug, routed?.didAutoSwitchToReasoning);
    }
    if (!modelKey && req.baseModelKey) {
      modelKey = normalizeModelKey(req.baseModelKey);
    }
    if (!modelKey) {
      pendingConversationRequests.delete(requestId);
      return;
    }
    req.resolved = true;
    postUsage(modelKey, { source, requestId });
    pendingConversationRequests.delete(requestId);
  };

  const isConversationPost = (url, method) => (
    method === 'POST'
    && String(url).includes('/conversation')
    && !String(url).includes('/conversations')
  );

  const getRequestBodyText = async (info, init) => {
    const initBody = init?.body;
    if (typeof initBody === 'string' && initBody.trim()) return initBody;
    if (initBody && typeof initBody === 'object' && typeof initBody.toString === 'function' && initBody.constructor?.name === 'URLSearchParams') {
      const text = initBody.toString();
      if (text) return text;
    }
    if (info && typeof info === 'object' && typeof info.clone === 'function') {
      try {
        const text = await info.clone().text();
        if (text && text.trim()) return text;
      } catch {
        // ignore
      }
    }
    return '';
  };

  const extractConversationPayload = async (info, init) => {
    const text = await getRequestBodyText(info, init);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
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

  const parsePowLikeValue = (value) => {
    if (value === null || value === undefined) return null;
    if (Number.isFinite(Number(value))) {
      const n = Number(value);
      return n >= 0 ? n : null;
    }
    const text = String(value).trim();
    if (!text) return null;
    if (/^0x[0-9a-f]+$/i.test(text)) {
      const n = Number.parseInt(text, 16);
      return Number.isFinite(n) ? n : null;
    }
    if (/^[0-9a-f]{6,}$/i.test(text)) {
      const n = Number.parseInt(text, 16);
      return Number.isFinite(n) ? n : null;
    }
    const matched = text.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (matched) {
      const n = Number(matched[1]);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const deepFindPowValue = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 5) return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const v = deepFindPowValue(item, depth + 1);
        if (v !== null) return v;
      }
      return null;
    }
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k || '').toLowerCase();
      if (key.includes('pow') || key.includes('proof') || key.includes('difficulty')) {
        const parsed = parsePowLikeValue(v);
        if (parsed !== null) return parsed;
      }
      if (v && typeof v === 'object') {
        const nested = deepFindPowValue(v, depth + 1);
        if (nested !== null) return nested;
      }
    }
    return null;
  };

  const extractPowValue = (json) => {
    if (!json || typeof json !== 'object') return null;
    const ste = json.server_ste_metadata || {};
    const msgMeta = json.message?.metadata || {};
    const obj = json || {};
    const direct = pickFirstFinite(
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
    if (direct !== null) return direct;

    const proofPayload = obj.proof_of_work || obj.proofofwork || obj.pow_config || obj.powConfig || obj.chat_requirements || obj.requirements || null;
    const fromProofPayload = deepFindPowValue(proofPayload);
    if (fromProofPayload !== null) return fromProofPayload;

    return deepFindPowValue(obj);
  };

  const extractPowFromHeaders = (headers) => {
    if (!headers || typeof headers.forEach !== 'function') return null;
    let value = null;
    headers.forEach((headerValue, headerName) => {
      if (value !== null) return;
      const key = String(headerName || '').toLowerCase();
      if (key.includes('pow') || key.includes('proof') || key.includes('difficulty')) {
        const parsed = parsePowLikeValue(headerValue);
        if (parsed !== null) value = parsed;
      }
    });
    return value;
  };

  const extractAccountTypeFromHeaders = (headers) => {
    if (!headers || typeof headers.forEach !== 'function') return null;
    let accountType = null;
    headers.forEach((headerValue, headerName) => {
      if (accountType) return;
      const key = String(headerName || '').toLowerCase();
      if (key.includes('plan') || key.includes('account') || key.includes('subscription') || key.includes('tier')) {
        const mapped = normalizeAccountType(headerValue);
        if (mapped) accountType = mapped;
      }
    });
    return accountType;
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
      let conversationRequestId = null;
      const [info, init] = args;
      const url = typeof info === 'string' ? info : info?.url || '';
      const method = String(init?.method || (typeof info === 'object' && info?.method) || 'GET').toUpperCase();

      if (method === 'POST') interceptFileUpload(url, init);

      try {
        if (isConversationPost(url, method)) {
          conversationRequestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          const body = await extractConversationPayload(info, init);
          const normalized = normalizeModelKey(body?.model);
          if (normalized && normalized !== 'gpt-5-2') {
            // 非 Auto 模式可以在请求发起时立即计数，实现实时更新。
            postUsage(normalized, { source: 'request', requestId: conversationRequestId });
          } else {
            // Auto 或无法读取请求体时，等待 SSE 路由结果，超时后兜底。
            pendingConversationRequests.set(conversationRequestId, {
              baseModelKey: normalized || null,
              startedAt: Date.now(),
              resolved: false
            });
            setTimeout(() => {
              const req = pendingConversationRequests.get(conversationRequestId);
              if (req && !req.resolved) {
                if (req.baseModelKey) resolveConversationRequest(conversationRequestId, null, 'request-timeout');
                else pendingConversationRequests.delete(conversationRequestId);
              }
            }, 60 * 1000);
          }
        }
      } catch {
        // ignore
      }

      const response = await target.apply(thisArg, args);

      try {
        const headerPow = extractPowFromHeaders(response?.headers);
        const headerAccountType = extractAccountTypeFromHeaders(response?.headers);
        if (headerPow !== null || headerAccountType) {
          postRuntimeMetric({
            powValue: headerPow,
            accountType: headerAccountType || null,
            timestamp: Date.now()
          });
        }
      } catch {
        // ignore
      }

      if (conversationRequestId || String(url).includes('/conversation')) {
        try {
          const clone = response.clone();
          parseSse(clone, (json) => {
            const info = extractRoutingInfo(json);
            if (info && conversationRequestId) resolveConversationRequest(conversationRequestId, info, 'response-routing');

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

      const lowerUrl = String(url || '').toLowerCase();
      if (lowerUrl.includes('chat-requirements') || lowerUrl.includes('/sentinel/') || lowerUrl.includes('proof_of_work')) {
        try {
          const clone = response.clone();
          const json = await clone.json();
          const powValue = extractPowValue(json);
          const accountType = extractAccountType(json);
          if (powValue !== null || accountType) {
            postRuntimeMetric({
              powValue: powValue !== null ? powValue : null,
              accountType: accountType || null,
              source: 'chat-requirements',
              timestamp: Date.now()
            });
          }
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
