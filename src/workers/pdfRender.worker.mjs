import React from 'react';
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { renderCodeBlock } from '../pdf-v2/renderers/codeRenderer.mjs';
import { renderFormulaBlock } from '../pdf-v2/renderers/formulaRenderer.mjs';
import { renderImageBlock } from '../pdf-v2/renderers/imageRenderer.mjs';
import { renderTableBlock } from '../pdf-v2/renderers/tableRenderer.mjs';
import notoSansScRegular from '../lib/NotoSansSC-Regular.otf';

let _fontRegistered = false;
function ensureFontsRegistered() {
  if (_fontRegistered) return;
  Font.register({
    family: 'NotoSansSC',
    src: notoSansScRegular
  });
  // 禁用默认英文断词，降低中英混排错切概率
  Font.registerHyphenationCallback((word) => [word]);
  _fontRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansSC',
    fontSize: 11,
    color: '#1f2937',
    backgroundColor: '#ffffff',
    paddingTop: 56,
    paddingBottom: 40,
    paddingHorizontal: 32
  },
  fixedHeader: {
    position: 'absolute',
    top: 16,
    left: 32,
    right: 32,
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: 6,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end'
  },
  headerTitle: {
    fontSize: 10,
    color: '#4b5563',
    maxWidth: 360
  },
  headerMeta: {
    fontSize: 9,
    color: '#6b7280'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  fixedFooter: {
    position: 'absolute',
    left: 32,
    right: 32,
    bottom: 14,
    fontSize: 9,
    color: '#9ca3af',
    borderTop: '1px solid #e5e7eb',
    paddingTop: 4
  },
  messageWrap: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    border: '1px solid #e5e7eb'
  },
  messageWrapUser: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac'
  },
  messageWrapAssistant: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbeafe'
  },
  roleTitle: {
    fontSize: 10.5,
    marginBottom: 6,
    fontWeight: 700
  },
  roleUser: {
    color: '#15803d'
  },
  roleAssistant: {
    color: '#4338ca'
  },
  roleSystem: {
    color: '#4b5563'
  },
  heading1: { fontSize: 18, marginBottom: 6, color: '#111827', fontWeight: 700 },
  heading2: { fontSize: 16, marginBottom: 5, color: '#111827', fontWeight: 700 },
  heading3: { fontSize: 14, marginBottom: 4, color: '#111827', fontWeight: 700 },
  heading4: { fontSize: 13, marginBottom: 4, color: '#111827', fontWeight: 700 },
  heading5: { fontSize: 12, marginBottom: 3, color: '#111827', fontWeight: 700 },
  heading6: { fontSize: 11, marginBottom: 3, color: '#111827', fontWeight: 700 },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.6,
    color: '#1f2937',
    marginBottom: 3
  },
  quoteWrap: {
    borderLeft: '3px solid #9ca3af',
    paddingLeft: 8,
    marginBottom: 4
  },
  quoteText: {
    color: '#4b5563',
    fontSize: 10.5,
    lineHeight: 1.5
  },
  listWrap: {
    marginBottom: 4
  },
  listItem: {
    fontSize: 10.8,
    color: '#1f2937',
    marginBottom: 2,
    lineHeight: 1.45
  },
  divider: {
    borderBottom: '1px solid #d1d5db',
    marginVertical: 6
  },
  codeBlock: {
    backgroundColor: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 8,
    marginBottom: 5
  },
  codeLanguage: {
    fontSize: 8,
    color: '#6b7280',
    marginBottom: 3
  },
  codeText: {
    fontFamily: 'NotoSansSC',
    fontSize: 9.2,
    color: '#111827',
    lineHeight: 1.38
  },
  tableWrap: {
    border: '1px solid #d1d5db',
    borderRadius: 4,
    marginBottom: 6
  },
  tableRow: {
    display: 'flex',
    flexDirection: 'row'
  },
  tableHeaderRow: {
    backgroundColor: '#f3f4f6'
  },
  tableCell: {
    borderRight: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    paddingVertical: 4,
    paddingHorizontal: 5
  },
  tableHeaderCell: {
    borderBottom: '1px solid #d1d5db'
  },
  tableHeaderText: {
    fontSize: 9.6,
    color: '#111827',
    fontWeight: 700
  },
  tableCellText: {
    fontSize: 9.3,
    color: '#1f2937',
    lineHeight: 1.35
  },
  formulaBlock: {
    backgroundColor: '#f8fafc',
    border: '1px solid #dbeafe',
    borderRadius: 4,
    padding: 6,
    marginBottom: 5
  },
  formulaLabel: {
    fontSize: 8,
    color: '#6b7280',
    marginBottom: 2
  },
  formulaText: {
    fontFamily: 'NotoSansSC',
    fontSize: 10,
    color: '#111827'
  },
  imageWrap: {
    marginBottom: 5,
    alignItems: 'center'
  },
  imageCaption: {
    marginTop: 2,
    fontSize: 8.5,
    color: '#6b7280'
  },
  imageFallback: {
    border: '1px dashed #d1d5db',
    borderRadius: 4,
    padding: 6,
    marginBottom: 5
  },
  imageFallbackText: {
    fontSize: 9.2,
    color: '#6b7280',
    marginBottom: 2
  },
  linkText: {
    fontSize: 9.2,
    color: '#2563eb',
    textDecoration: 'underline'
  }
});

function safeText(value, maxLen = 2000) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}...` : normalized;
}

function roleLabel(role) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return 'ChatGPT';
  return '系统';
}

function roleStyle(role) {
  if (role === 'user') return styles.roleUser;
  if (role === 'assistant') return styles.roleAssistant;
  return styles.roleSystem;
}

function postProgress(requestId, stage, current, total, message) {
  self.postMessage({
    type: 'progress',
    requestId,
    payload: {
      stage,
      current,
      total,
      message
    }
  });
}

function renderListBlock(block) {
  const ordered = !!block?.ordered;
  const items = Array.isArray(block?.items) ? block.items : [];
  return React.createElement(
    View,
    { style: styles.listWrap, key: block.__key || undefined, wrap: true },
    items.map((item, idx) =>
      React.createElement(
        Text,
        { style: styles.listItem, key: `list-item-${idx}` },
        `${ordered ? `${idx + 1}.` : '•'} ${safeText(item, 8000)}`
      )
    )
  );
}

function renderHeading(block) {
  const level = Math.max(1, Math.min(6, Number(block?.level || 2)));
  const styleKey = `heading${level}`;
  return React.createElement(
    Text,
    { style: styles[styleKey], key: block.__key || undefined, wrap: true },
    safeText(block?.text || '', 8000)
  );
}

function renderParagraph(block) {
  return React.createElement(
    Text,
    { style: styles.paragraph, key: block.__key || undefined, wrap: true },
    safeText(block?.text || '', 12000)
  );
}

function renderQuote(block) {
  return React.createElement(
    View,
    { style: styles.quoteWrap, key: block.__key || undefined, wrap: true },
    React.createElement(Text, { style: styles.quoteText }, safeText(block?.text || '', 12000))
  );
}

function renderHorizontalRule(block) {
  return React.createElement(View, { style: styles.divider, key: block.__key || undefined, wrap: false });
}

function renderBlock(block, messageIndex, blockIndex) {
  const blockWithKey = { ...block, __key: `msg-${messageIndex}-block-${blockIndex}` };
  const context = { React, Text, View, Link, Image, styles };
  switch (block?.type) {
    case 'heading':
      return renderHeading(blockWithKey);
    case 'paragraph':
      return renderParagraph(blockWithKey);
    case 'quote':
      return renderQuote(blockWithKey);
    case 'list':
      return renderListBlock(blockWithKey);
    case 'code':
      return renderCodeBlock(blockWithKey, context);
    case 'table':
      return renderTableBlock(blockWithKey, context);
    case 'formula':
      return renderFormulaBlock(blockWithKey, context);
    case 'image':
      return renderImageBlock(blockWithKey, context);
    case 'horizontalRule':
      return renderHorizontalRule(blockWithKey);
    default:
      return renderParagraph({ ...blockWithKey, text: safeText(block?.text || '[未识别内容]') });
  }
}

function renderMessage(message, index) {
  const role = String(message?.role || 'system');
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
  const isUser = role === 'user';

  return React.createElement(
    View,
    {
      style: [styles.messageWrap, isUser ? styles.messageWrapUser : styles.messageWrapAssistant],
      key: `msg-${index}`,
      wrap: true
    },
    [
      React.createElement(
        Text,
        {
          style: [styles.roleTitle, roleStyle(role)],
          key: `msg-role-${index}`
        },
        `${index + 1}. ${roleLabel(role)}`
      ),
      ...blocks.map((block, blockIndex) => renderBlock(block, index, blockIndex))
    ]
  );
}

function createDocumentNode(payload, messages) {
  const locale = payload?.options?.locale || 'zh-CN';
  const now = new Date().toLocaleString(locale);
  const title = safeText(payload?.title || 'ChatGPT');
  const workspace = safeText(payload?.workspace || '');

  return React.createElement(
    Document,
    {
      title,
      author: 'ChatGPT Saver',
      producer: 'ChatGPT Saver PDF v2'
    },
    React.createElement(
      Page,
      {
        size: payload?.options?.page || 'A4',
        style: styles.page,
        wrap: true
      },
      [
        React.createElement(
          View,
          { style: styles.fixedHeader, fixed: true, key: 'fixed-header' },
          [
            React.createElement(
              Text,
              { style: styles.headerTitle, key: 'header-title' },
              workspace ? `${title} - ${workspace}` : title
            ),
            React.createElement(
              Text,
              { style: styles.headerMeta, key: 'header-meta' },
              now
            )
          ]
        ),
        React.createElement(
          View,
          { style: styles.content, key: 'main-content' },
          messages.map((message, index) => renderMessage(message, index))
        ),
        React.createElement(Text, {
          style: styles.fixedFooter,
          fixed: true,
          key: 'fixed-footer',
          render: ({ pageNumber, totalPages }) => `ChatGPT Saver PDF v2  |  ${pageNumber}/${totalPages}`
        })
      ]
    )
  );
}

self.onmessage = async (event) => {
  const data = event?.data || {};
  if (data.type !== 'render' || !data.requestId) return;

  const { requestId, payload } = data;
  try {
    ensureFontsRegistered();

    if (!payload || payload.version !== 'v2') {
      throw new Error('invalid v2 payload');
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    postProgress(requestId, 'layout', 0, messages.length || 1, '准备文档布局');
    messages.forEach((_, idx) => {
      postProgress(requestId, 'layout', idx + 1, messages.length || 1, `布局消息 ${idx + 1}/${messages.length}`);
    });

    postProgress(requestId, 'render', 0, 1, '开始 PDF 渲染');
    const documentNode = createDocumentNode(payload, messages);
    const blob = await pdf(documentNode).toBlob();
    const buffer = await blob.arrayBuffer();
    postProgress(requestId, 'finalize', 1, 1, '渲染完成');

    self.postMessage(
      {
        type: 'result',
        requestId,
        payload: {
          buffer,
          mimeType: 'application/pdf'
        }
      },
      [buffer]
    );
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: {
        code: 'PDF_V2_RENDER_FAILED',
        message: error?.message || String(error)
      }
    });
  }
};
