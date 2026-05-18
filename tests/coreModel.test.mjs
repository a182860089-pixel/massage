import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ConversationModel } = require('../src/core/model.js');

describe('ConversationModel - block factories', () => {
  it('makeTextBlock', () => {
    const b = ConversationModel.makeTextBlock({ role: 'user', html: '<p>hi</p>', text: 'hi' });
    expect(b.type).toBe('text');
    expect(b.role).toBe('user');
    expect(b.html).toContain('<p>hi</p>');
  });

  it('makeCanvasBlock & makeThoughtBlock & makeWebSearchBlock & makeDeepResearchBlock', () => {
    expect(ConversationModel.makeCanvasBlock({ role: 'assistant', title: 't', content: 'x' }).type).toBe('canvas');
    expect(ConversationModel.makeThoughtBlock({ role: 'assistant', summary: 's', detailsText: 'd' }).type).toBe('thought');
    expect(ConversationModel.makeWebSearchBlock({ role: 'assistant', queries: ['q'], sources: [{ title: 't', url: 'https://a' }] }).sources.length).toBe(1);
    expect(ConversationModel.makeDeepResearchBlock({ role: 'assistant', reportText: 'r', citations: [{ url: 'https://x' }] }).type).toBe('deep_research');
  });
});

describe('ConversationModel.normalizeConversation', () => {
  it('upgrades legacy {role, content, textContent} to text blocks', () => {
    const m = ConversationModel.normalizeConversation({
      title: 'Hi',
      messages: [
        { role: 'user', content: '<p>hello</p>', textContent: 'hello' },
        { role: 'assistant', content: '<p>world</p>', textContent: 'world' }
      ]
    });
    expect(m.title).toBe('Hi');
    expect(m.messages.length).toBe(2);
    expect(m.messages[0].blocks[0].type).toBe('text');
    expect(m.messages[1].blocks[0].html).toContain('world');
  });

  it('passes through new-format messages with blocks[]', () => {
    const input = {
      title: 'X',
      messages: [
        { role: 'assistant', blocks: [
          { type: 'thought', role: 'assistant', summary: 'thinking', detailsText: '...' },
          { type: 'text', role: 'assistant', html: '<p>ok</p>', text: 'ok' }
        ]}
      ]
    };
    const m = ConversationModel.normalizeConversation(input);
    expect(m.messages[0].blocks.length).toBe(2);
    expect(m.messages[0].blocks[0].type).toBe('thought');
    expect(m.messages[0].blocks[1].type).toBe('text');
  });

  it('drops empty messages', () => {
    const m = ConversationModel.normalizeConversation({
      messages: [{ role: 'user' }, { role: 'user', textContent: 'q' }]
    });
    expect(m.messages.length).toBe(1);
  });
});

describe('ConversationModel.modelToLegacyConversation', () => {
  it('renders 4 advanced block types into HTML tags', () => {
    const model = ConversationModel.normalizeConversation({
      title: 'Adv',
      messages: [{
        role: 'assistant',
        blocks: [
          ConversationModel.makeCanvasBlock({ role: 'assistant', title: 'My Canvas', lang: 'py', content: 'print(1)' }),
          ConversationModel.makeThoughtBlock({ role: 'assistant', summary: 'Thoughts', detailsText: 'reasoning here' }),
          ConversationModel.makeWebSearchBlock({ role: 'assistant', queries: ['kw'], sources: [{ title: 'A', url: 'https://a.com', snippet: 'snip' }] }),
          ConversationModel.makeDeepResearchBlock({ role: 'assistant', reportText: 'long report', citations: [{ title: 'C1', url: 'https://c1' }] })
        ]
      }]
    });
    const legacy = ConversationModel.modelToLegacyConversation(model);
    const html = legacy.messages[0].content;
    expect(html).toContain('class="canvas-block"');
    expect(html).toContain('class="thought-block"');
    expect(html).toContain('class="web-search-block"');
    expect(html).toContain('class="deep-research-block"');
    // text 兜底
    expect(legacy.messages[0].textContent).toContain('Canvas');
    expect(legacy.messages[0].textContent).toContain('Thoughts');
  });
});

describe('ConversationModel.blockToPlainText', () => {
  it('canvas with content', () => {
    const txt = ConversationModel.blockToPlainText(
      ConversationModel.makeCanvasBlock({ role: 'assistant', title: 'T', lang: 'js', content: 'console.log(1)' })
    );
    expect(txt).toContain('[Canvas: T]');
    expect(txt).toContain('```js');
    expect(txt).toContain('console.log(1)');
  });

  it('thought summary only by default', () => {
    const txt = ConversationModel.blockToPlainText(
      ConversationModel.makeThoughtBlock({ role: 'assistant', summary: 'Thought 5s', detailsText: 'long' })
    );
    expect(txt).toContain('Thought 5s');
    expect(txt).not.toContain('long');
  });

  it('thought details when option enabled', () => {
    const txt = ConversationModel.blockToPlainText(
      ConversationModel.makeThoughtBlock({ role: 'assistant', summary: 's', detailsText: 'long' }),
      { includeThoughtDetails: true }
    );
    expect(txt).toContain('long');
  });

  it('web_search lists sources', () => {
    const txt = ConversationModel.blockToPlainText(
      ConversationModel.makeWebSearchBlock({
        role: 'assistant',
        queries: ['q1', 'q2'],
        sources: [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }]
      })
    );
    expect(txt).toContain('q1');
    expect(txt).toContain('https://a');
    expect(txt).toContain('https://b');
  });
});
