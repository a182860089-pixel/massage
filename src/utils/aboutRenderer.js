/**
 * About tab rendering helpers.
 * Works in both browser (global attach) and Node tests (module.exports).
 */

(function initAboutRenderer(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ChatGPTSaver = root.ChatGPTSaver || {};
    root.ChatGPTSaver.AboutRenderer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAboutRendererApi() {
  const DEFAULT_EMPTY_NOTICE = '暂无公告';
  const DEFAULT_UPGRADE_LABEL = '一键升级';

  function toTrimmedString(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeUrl(value) {
    const candidate = toTrimmedString(value);
    if (!candidate) return '';
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.toString();
    } catch (error) {
      return '';
    }
  }

  function pickFirstNonEmptyString(values) {
    if (!Array.isArray(values)) return '';
    for (let i = 0; i < values.length; i += 1) {
      const value = toTrimmedString(values[i]);
      if (value) return value;
    }
    return '';
  }

  function normalizeAnnouncementConfig(payload) {
    const rootPayload = payload && typeof payload === 'object' ? payload : {};
    const source = rootPayload.data && typeof rootPayload.data === 'object'
      ? rootPayload.data
      : rootPayload;

    const noticeMarkdown = pickFirstNonEmptyString([
      source.notice_markdown,
      source.noticeMarkdown,
      source.announcement_markdown,
      source.announcementMarkdown,
      source.notice,
      source.announcement,
      source.content
    ]);

    const upgradeUrl = sanitizeUrl(pickFirstNonEmptyString([
      source.upgrade_url,
      source.upgradeUrl,
      source.upgrade_link,
      source.upgradeLink,
      source.download_url,
      source.downloadUrl
    ]));

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
      upgradeLabel: upgradeLabel || DEFAULT_UPGRADE_LABEL
    };
  }

  function getMarkedApi(markedApi) {
    if (markedApi && typeof markedApi.parse === 'function') return markedApi;
    if (markedApi && markedApi.marked && typeof markedApi.marked.parse === 'function') {
      return markedApi.marked;
    }
    if (typeof marked !== 'undefined') {
      if (marked && typeof marked.parse === 'function') return marked;
      if (marked && marked.marked && typeof marked.marked.parse === 'function') {
        return marked.marked;
      }
    }
    return null;
  }

  function getDOMPurifyApi(dompurifyApi) {
    if (dompurifyApi && typeof dompurifyApi.sanitize === 'function') return dompurifyApi;
    if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
      return DOMPurify;
    }
    return null;
  }

  function renderMarkdownSafe(markdownText, options = {}) {
    const markdownInput = toTrimmedString(markdownText) || DEFAULT_EMPTY_NOTICE;
    const markedApi = getMarkedApi(options.marked);
    const dompurifyApi = getDOMPurifyApi(options.DOMPurify || options.dompurify);

    let renderedHtml = '';
    if (markedApi) {
      renderedHtml = markedApi.parse(markdownInput, {
        gfm: true,
        breaks: true,
        headerIds: false,
        mangle: false
      });
    } else {
      renderedHtml = `<p>${escapeHtml(markdownInput).replace(/\n/g, '<br>')}</p>`;
    }

    if (dompurifyApi) {
      return dompurifyApi.sanitize(renderedHtml, {
        USE_PROFILES: { html: true }
      });
    }

    return renderedHtml.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  }

  function buildAboutViewModel(configPayload, pluginVersion) {
    const normalized = normalizeAnnouncementConfig(configPayload);

    return {
      pluginVersion: toTrimmedString(pluginVersion) || '-',
      latestVersion: normalized.latestVersion || '',
      noticeMarkdown: normalized.noticeMarkdown || '',
      upgradeUrl: normalized.upgradeUrl || '',
      upgradeLabel: normalized.upgradeLabel || DEFAULT_UPGRADE_LABEL
    };
  }

  return {
    DEFAULT_EMPTY_NOTICE,
    DEFAULT_UPGRADE_LABEL,
    escapeHtml,
    sanitizeUrl,
    normalizeAnnouncementConfig,
    renderMarkdownSafe,
    buildAboutViewModel
  };
});

