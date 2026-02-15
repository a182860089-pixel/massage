(function () {
  'use strict';

  const SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
  const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

  function normalizeWhitespace(text) {
    return String(text || '')
      .replace(SPACE_RE, ' ')
      .replace(ZERO_WIDTH_RE, '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeInlineText(text) {
    return normalizeWhitespace(text).replace(/\n/g, ' ');
  }

  function normalizeMultilineText(text) {
    return normalizeWhitespace(text)
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');
  }

  function normalizeTableCellText(text) {
    return normalizeInlineText(text).replace(/\|/g, '\\|');
  }

  function sanitizeHtmlFragment(html) {
    const raw = String(html || '');
    if (!raw) return '';
    if (typeof document === 'undefined') {
      return raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    }

    const root = document.createElement('div');
    root.innerHTML = raw;
    root
      .querySelectorAll(
        'script, style, link, iframe, object, embed, form, button, textarea, input, [hidden], [aria-hidden="true"]'
      )
      .forEach((el) => el.remove());
    return root.innerHTML;
  }

  function extractSafeImageMeta(element) {
    if (!element || typeof element.getAttribute !== 'function') return null;
    const src = String(element.getAttribute('src') || '').trim();
    if (!src) return null;
    if (!/^data:image\/|^https?:\/\//i.test(src)) {
      return null;
    }

    const alt = normalizeInlineText(element.getAttribute('alt') || '');
    const width = Number(element.getAttribute('width')) || null;
    const height = Number(element.getAttribute('height')) || null;
    return { src, alt, width, height };
  }

  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.PDFNormalizers = {
    normalizeWhitespace,
    normalizeInlineText,
    normalizeMultilineText,
    normalizeTableCellText,
    sanitizeHtmlFragment,
    extractSafeImageMeta
  };
})();
