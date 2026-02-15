(function () {
  'use strict';

  const normalizers = window.ChatGPTSaver?.PDFNormalizers;

  const BLOCK_TAGS = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'section', 'article', 'pre', 'code', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'hr', 'img', 'math'
  ]);

  const DEFAULT_IMAGE_BUDGET = {
    maxSinglePixels: 8_000_000,
    maxTotalPixels: 24_000_000,
    maxWidth: 1800,
    maxHeight: 1800
  };

  function isMathElement(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = String(node.tagName || '').toLowerCase();
    const cls = String(node.className || '').toLowerCase();
    return tag === 'math' || tag === 'mjx-container' || cls.includes('katex') || cls.includes('mathjax') || cls.includes('math');
  }

  function extractFormulaText(node) {
    if (!node || node.nodeType !== 1) return '';
    const direct = [
      node.getAttribute?.('data-tex'),
      node.getAttribute?.('data-latex'),
      node.getAttribute?.('aria-label')
    ].find(Boolean);
    if (direct) return normalizers.normalizeWhitespace(direct);

    const texAnnotation = node.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent;
    if (texAnnotation) return normalizers.normalizeWhitespace(texAnnotation);

    const scriptMath = node.querySelector?.('script[type="math/tex"]')?.textContent;
    if (scriptMath) return normalizers.normalizeWhitespace(scriptMath);

    return '';
  }

  function extractInlineText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      return normalizers.normalizeWhitespace(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'br') return '\n';
    if (isMathElement(node)) {
      const formula = extractFormulaText(node);
      return formula ? `$${formula}$` : '[公式]';
    }
    if (tag === 'code') {
      return '`' + normalizers.normalizeInlineText(node.textContent || '') + '`';
    }

    const parts = Array.from(node.childNodes).map((child) => extractInlineText(child));
    return normalizers.normalizeWhitespace(parts.join(' ').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n'));
  }

  function hasStructuredChildren(node) {
    if (!node || !node.children) return false;
    return Array.from(node.children).some((child) => {
      const tag = String(child.tagName || '').toLowerCase();
      return BLOCK_TAGS.has(tag) || isMathElement(child);
    });
  }

  function pushParagraph(blocks, text) {
    const normalized = normalizers.normalizeWhitespace(text);
    if (!normalized) return;
    blocks.push({ type: 'paragraph', text: normalized });
  }

  function buildCodeBlock(element) {
    const codeEl = element.querySelector('code');
    let language = '';
    if (codeEl?.classList) {
      const langClass = Array.from(codeEl.classList).find((cls) => cls.startsWith('language-'));
      language = langClass ? langClass.replace('language-', '') : '';
    }
    language = language || String(element.getAttribute('data-language') || '').trim();

    const content = normalizers.normalizeMultilineText(codeEl?.textContent || element.textContent || '');
    if (!content) return null;

    return {
      type: 'code',
      language,
      content
    };
  }

  function buildListBlock(element) {
    const ordered = String(element.tagName || '').toLowerCase() === 'ol';
    const items = Array.from(element.children)
      .filter((child) => String(child.tagName || '').toLowerCase() === 'li')
      .map((li) => {
        const clone = li.cloneNode(true);
        clone.querySelectorAll('ul,ol').forEach((nested) => nested.remove());
        return normalizers.normalizeWhitespace(extractInlineText(clone));
      })
      .filter(Boolean);

    if (!items.length) return null;
    return {
      type: 'list',
      ordered,
      items
    };
  }

  function buildTableBlock(element) {
    const rows = Array.from(element.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td'))
        .map((td) => normalizers.normalizeTableCellText(td.textContent || ''))
        .filter((cell) => cell !== '')
    ).filter((row) => row.length > 0);

    if (!rows.length) return null;

    let headers = [];
    let dataRows = rows;
    const firstTr = element.querySelector('tr');
    const hasHeader = !!firstTr && Array.from(firstTr.children).every((el) => String(el.tagName || '').toLowerCase() === 'th');
    if (hasHeader) {
      headers = rows[0];
      dataRows = rows.slice(1);
    } else if (rows.length > 1) {
      headers = rows[0];
      dataRows = rows.slice(1);
    }

    return {
      type: 'table',
      headers,
      rows: dataRows
    };
  }

  function buildImageBlock(element, imageBudgetState) {
    const meta = normalizers.extractSafeImageMeta(element);
    if (!meta) {
      return {
        type: 'paragraph',
        text: '[图片已省略：来源不受支持]'
      };
    }

    const maxWidth = imageBudgetState.limits.maxWidth;
    const maxHeight = imageBudgetState.limits.maxHeight;
    const width = meta.width ? Math.min(meta.width, maxWidth) : null;
    const height = meta.height ? Math.min(meta.height, maxHeight) : null;
    const pixels = width && height ? width * height : null;

    if (pixels && pixels > imageBudgetState.limits.maxSinglePixels) {
      return {
        type: 'paragraph',
        text: '[图片已省略：单图像素超出预算]'
      };
    }
    if (pixels && imageBudgetState.totalPixels + pixels > imageBudgetState.limits.maxTotalPixels) {
      return {
        type: 'paragraph',
        text: '[图片已省略：总像素预算已耗尽]'
      };
    }
    if (pixels) imageBudgetState.totalPixels += pixels;

    // 纯前端稳定性优先：仅 data URL 直接渲染，远程地址降级为链接文本
    const isDataUrl = /^data:image\//i.test(meta.src);
    if (!isDataUrl) {
      return {
        type: 'image',
        renderMode: 'link',
        src: meta.src,
        alt: meta.alt || 'Image',
        width,
        height
      };
    }

    return {
      type: 'image',
      renderMode: 'embedded',
      src: meta.src,
      alt: meta.alt || 'Image',
      width,
      height
    };
  }

  function walkNode(node, blocks, context) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      pushParagraph(blocks, node.textContent || '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = String(node.tagName || '').toLowerCase();
    if (!tag) return;

    if (tag === 'hr') {
      blocks.push({ type: 'horizontalRule' });
      return;
    }

    if (isMathElement(node)) {
      const formula = extractFormulaText(node);
      blocks.push({
        type: 'formula',
        latex: formula || '',
        text: formula || normalizers.normalizeWhitespace(node.textContent || '[公式]')
      });
      return;
    }

    if (tag === 'img') {
      blocks.push(buildImageBlock(node, context.imageBudgetState));
      return;
    }

    if (tag === 'pre') {
      const codeBlock = buildCodeBlock(node);
      if (codeBlock) blocks.push(codeBlock);
      return;
    }

    if (tag === 'table') {
      const table = buildTableBlock(node);
      if (table) blocks.push(table);
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      const list = buildListBlock(node);
      if (list) blocks.push(list);
      return;
    }

    if (tag === 'blockquote') {
      const text = extractInlineText(node);
      if (text) {
        blocks.push({ type: 'quote', text });
      }
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.replace('h', '')) || 1;
      const text = extractInlineText(node);
      if (text) {
        blocks.push({ type: 'heading', level, text });
      }
      return;
    }

    if (tag === 'p') {
      const text = extractInlineText(node);
      if (text) {
        blocks.push({ type: 'paragraph', text });
      }
      return;
    }

    if (tag === 'br') return;

    if (hasStructuredChildren(node)) {
      Array.from(node.childNodes).forEach((child) => walkNode(child, blocks, context));
      return;
    }

    const fallbackText = extractInlineText(node);
    if (fallbackText) {
      blocks.push({ type: 'paragraph', text: fallbackText });
    }
  }

  function compactBlocks(blocks) {
    const result = [];
    blocks.forEach((block) => {
      if (!block) return;
      if (block.type === 'paragraph') {
        const text = normalizers.normalizeWhitespace(block.text || '');
        if (!text) return;
        const prev = result[result.length - 1];
        if (prev && prev.type === 'paragraph') {
          prev.text = normalizers.normalizeWhitespace(`${prev.text}\n${text}`);
        } else {
          result.push({ type: 'paragraph', text });
        }
        return;
      }
      result.push(block);
    });
    return result;
  }

  async function yieldToMainThread() {
    if (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function') {
      await globalThis.scheduler.yield();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const PDFASTBuilder = {
    buildMessageBlocks(message, options = {}) {
      const html = normalizers.sanitizeHtmlFragment(message?.content || '');
      const fallbackText = normalizers.normalizeWhitespace(message?.textContent || '');
      const imageBudgetState = options.imageBudgetState;

      const root = document.createElement('div');
      root.innerHTML = html;
      const blocks = [];
      Array.from(root.childNodes).forEach((node) => walkNode(node, blocks, { imageBudgetState }));

      if (!blocks.length && fallbackText) {
        blocks.push({ type: 'paragraph', text: fallbackText });
      }

      return compactBlocks(blocks);
    },

    async buildConversationAst(conversation, options = {}) {
      if (!normalizers) {
        throw new Error('PDFNormalizers is required before PDFASTBuilder');
      }

      const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
      const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
      const imageBudgetState = {
        limits: { ...DEFAULT_IMAGE_BUDGET, ...(options.imageBudget || {}) },
        totalPixels: 0
      };

      const astMessages = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i] || {};
        const blocks = this.buildMessageBlocks(msg, { imageBudgetState });
        astMessages.push({
          role: String(msg.role || 'system'),
          blocks
        });

        onProgress({
          stage: 'parse',
          current: i + 1,
          total: messages.length || 1,
          message: `解析消息 ${i + 1}/${messages.length}`
        });

        await yieldToMainThread();
      }

      return {
        version: 'v2',
        title: String(conversation?.title || 'ChatGPT'),
        workspace: String(options.workspace || conversation?.workspace || ''),
        messages: astMessages,
        options: {
          quality: 'near-publish',
          page: 'A4',
          locale: 'zh-CN',
          embedFonts: true,
          ...(options.requestOptions || {})
        }
      };
    }
  };

  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.PDFASTBuilder = PDFASTBuilder;
})();
