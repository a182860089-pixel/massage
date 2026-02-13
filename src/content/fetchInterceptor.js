/**
 * Fetch 拦截器 - 运行在页面主世界 (MAIN world)
 * 拦截 ChatGPT 的 /conversation 请求，解析模型用量，通过 postMessage 通知 content script
 */
(function () {
  'use strict';

  if (window.fetch.__saverUsagePatched) return;
  const originalFetch = window.fetch;
  const pendingAutoRequests = new Map();

  const resolveRedirectedModelId = (id) => id === 'auto' ? 'gpt-5-2' : id;

  const mapRoutedSlugToModelKey = (baseKey, routedSlug, didAutoSwitch) => {
    const slug = (routedSlug || '').toLowerCase();
    if (baseKey === 'gpt-5-2') {
      if (slug.includes('pro')) return 'gpt-5-2-pro';
      const looksReasoning = didAutoSwitch === true || slug.includes('thinking') || slug.includes('reasoning');
      return looksReasoning ? 'gpt-5-2-thinking' : 'gpt-5-2-instant';
    }
    return routedSlug || baseKey;
  };

  const notifyUsage = (modelKey) => {
    window.postMessage({ type: 'SAVER_USAGE_RECORD', modelKey }, '*');
  };

  const resolveAutoRequest = (requestId, routed) => {
    const req = pendingAutoRequests.get(requestId);
    if (!req || req.resolved) return;
    const modelKey = mapRoutedSlugToModelKey(req.baseModelKey, routed?.modelSlug, routed?.didAutoSwitchToReasoning);
    req.resolved = true;
    notifyUsage(modelKey);
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
          const dataLines = rawEvent.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
          if (!dataLines.length) continue;
          const data = dataLines.join('\n');
          if (!data || data === '[DONE]') continue;
          try { onJson(JSON.parse(data)); } catch { }
        }
      }
    } catch (e) { /* ignore */ }
  };

  const extractRoutingInfo = (json) => {
    if (!json || typeof json !== 'object') return null;
    const ste = json.server_ste_metadata || json;
    if (ste && (ste.type === 'server_ste_metadata' || json.type === 'server_ste_metadata')) {
      const modelSlug = ste.model_slug || ste.model || ste.modelSlug;
      const didAutoSwitch = ste.did_auto_switch_to_reasoning ?? ste.didAutoSwitchToReasoning;
      if (modelSlug || didAutoSwitch !== undefined) return { modelSlug, didAutoSwitchToReasoning: didAutoSwitch };
    }
    const message = json.message;
    const metadata = message?.metadata;
    const modelSlug = metadata?.model_slug || metadata?.modelSlug;
    if (modelSlug) return { modelSlug };
    return null;
  };

  // 拦截文件上传：从 FormData 中提取文件并通知 content script
  const interceptFileUpload = (url, init) => {
    try {
      const body = init?.body;
      if (!body || !(body instanceof FormData)) return;
      // ChatGPT 文件上传通常是 POST 到 /files 或 /backend-api/files
      if (!url.includes('/files')) return;
      const files = [];
      for (const [key, value] of body.entries()) {
        if (value instanceof File) {
          files.push({ name: value.name, size: value.size, type: value.type, key });
        }
      }
      if (files.length === 0) return;
      // 将 File 对象通过 postMessage 传递（File 是可结构化克隆的）
      const fileObjects = [];
      for (const [key, value] of body.entries()) {
        if (value instanceof File) fileObjects.push(value);
      }
      window.postMessage({ type: 'SAVER_FILE_UPLOADED', files: fileObjects }, '*');
    } catch (e) { /* ignore */ }
  };

  window.fetch = new Proxy(originalFetch, {
    apply: async function (target, thisArg, args) {
      let autoRequestId = null;
      const [info, init] = args;
      const url = typeof info === 'string' ? info : info?.url || '';
      const method = init?.method || (typeof info === 'object' && info?.method) || 'GET';

      // 拦截文件上传
      try {
        if (method === 'POST') interceptFileUpload(url, init);
      } catch (e) { /* ignore */ }

      try {
        if (method === 'POST' && url.includes('/conversation') && !url.includes('/conversations')) {
          if (init && init.body) {
            const body = JSON.parse(init.body);
            if (body?.model) {
              const effectiveId = resolveRedirectedModelId(body.model);
              if (effectiveId === 'gpt-5-2') {
                autoRequestId = Date.now() + Math.random().toString();
                pendingAutoRequests.set(autoRequestId, { baseModelKey: 'gpt-5-2', startedAt: Date.now(), resolved: false });
                setTimeout(() => {
                  const req = pendingAutoRequests.get(autoRequestId);
                  if (req && !req.resolved) { notifyUsage('gpt-5-2'); pendingAutoRequests.delete(autoRequestId); }
                }, 60000);
              } else {
                notifyUsage(effectiveId);
              }
            }
          }
        }
      } catch (e) { /* ignore */ }
      const response = await target.apply(thisArg, args);
      if (autoRequestId) {
        try {
          const clone = response.clone();
          parseSse(clone, (json) => { const info = extractRoutingInfo(json); if (info) resolveAutoRequest(autoRequestId, info); });
        } catch (e) { /* ignore */ }
      }
      return response;
    }
  });
  window.fetch.__saverUsagePatched = true;

  // 同时拦截 XMLHttpRequest 的文件上传
  if (!XMLHttpRequest.prototype.__saverFilePatched) {
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (body instanceof FormData) {
          const url = this.__saverUrl || '';
          if (url.includes('/files')) {
            const fileObjects = [];
            for (const [key, value] of body.entries()) {
              if (value instanceof File) fileObjects.push(value);
            }
            if (fileObjects.length > 0) {
              window.postMessage({ type: 'SAVER_FILE_UPLOADED', files: fileObjects }, '*');
            }
          }
        }
      } catch (e) { /* ignore */ }
      return origSend.call(this, body);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__saverUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__saverFilePatched = true;
  }
})();
