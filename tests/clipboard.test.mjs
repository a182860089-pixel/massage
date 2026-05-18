import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ConversationModel } = require('../src/core/model.js');
const { ClipboardManager } = require('../src/core/clipboard.js');

let dom = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://chatgpt.com/c/test' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.window.ChatGPTSaver = { ConversationModel };
});

afterEach(() => {
  if (dom) dom.window.close();
  dom = null;
});

describe('ClipboardManager.conversationToMarkdown', () => {
  it('renders title + roles + plain blocks', () => {
    const model = ConversationModel.normalizeConversation({
      messages: [
        { role: 'user', content: '<p>question</p>', textContent: 'question' },
        { role: 'assistant', content: '<p>answer</p>', textContent: 'answer' }
      ]
    });
    const md = ClipboardManager.conversationToMarkdown(model, { title: 'Hi' });
    expect(md).toContain('# Hi');
    expect(md).toContain('## You');
    expect(md).toContain('question');
    expect(md).toContain('## ChatGPT');
    expect(md).toContain('answer');
  });

  it('renders advanced blocks via blockToPlainText', () => {
    const model = ConversationModel.normalizeConversation({
      messages: [{
        role: 'assistant',
        blocks: [
          ConversationModel.makeThoughtBlock({ role: 'assistant', summary: 'Thinking', detailsText: 'detail' }),
          ConversationModel.makeCanvasBlock({ role: 'assistant', title: 'My', lang: 'py', content: 'print()' }),
          ConversationModel.makeWebSearchBlock({ role: 'assistant', queries: ['q1'], sources: [{ title: 'A', url: 'https://a' }] })
        ]
      }]
    });
    const md = ClipboardManager.conversationToMarkdown(model);
    expect(md).toContain('[Thinking] Thinking');
    expect(md).toContain('[Canvas: My]');
    expect(md).toContain('```py');
    expect(md).toContain('[Web Search] q1');
    expect(md).toContain('https://a');
  });

  it('supports raw messages array (legacy fallback)', () => {
    const md = ClipboardManager.conversationToMarkdown([
      { role: 'user', textContent: 'hi' }
    ]);
    expect(md).toContain('hi');
  });

  it('returns empty when no messages', () => {
    expect(ClipboardManager.conversationToMarkdown(null)).toBe('');
    expect(ClipboardManager.conversationToMarkdown({})).toBe('');
  });
});

describe('ClipboardManager.conversationToRichHtml', () => {
  it('renders title + role headers + block HTML', () => {
    const model = ConversationModel.normalizeConversation({
      messages: [{ role: 'assistant', blocks: [
        ConversationModel.makeTextBlock({ role: 'assistant', html: '<p>hello</p>', text: 'hello' }),
        ConversationModel.makeCanvasBlock({ role: 'assistant', title: 'C', lang: 'js', content: 'x' })
      ]}]
    });
    const html = ClipboardManager.conversationToRichHtml(model, { title: 'T' });
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<h2>ChatGPT</h2>');
    expect(html).toContain('<p>hello</p>');
    expect(html).toContain('class="canvas-block"');
  });
});

describe('ClipboardManager.writeText', () => {
  it('uses navigator.clipboard.writeText when present', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const r = await ClipboardManager.writeText('hello');
    expect(r.success).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns failure for empty input', async () => {
    const r = await ClipboardManager.writeText('   ');
    expect(r.success).toBe(false);
  });
});
