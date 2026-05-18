import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ConversationModel } = require('../src/core/model.js');
const { apiTreeToModel, apiMessageToBlocks } = require('../src/adapters/chatgpt/apiSource.js');

let dom = null;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://chatgpt.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.window.ChatGPTSaver = { ConversationModel };
});
afterEach(() => {
  if (dom) dom.window.close();
  dom = null;
});

describe('apiTreeToModel', () => {
  it('flattens mapping tree along current_node path', () => {
    const tree = {
      conversation_id: 'conv-1',
      title: 'Hello',
      update_time: 1700000000,
      current_node: 'm3',
      mapping: {
        'root': { id: 'root', parent: null, children: ['m1'], message: null },
        'm1':   { id: 'm1', parent: 'root', children: ['m2'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['你好'] } } },
        'm2':   { id: 'm2', parent: 'm1',   children: ['m3'], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hi!'] } } },
        'm3':   { id: 'm3', parent: 'm2',   children: [],     message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['再见'] } } }
      }
    };
    const model = apiTreeToModel(tree);
    expect(model.id).toBe('conv-1');
    expect(model.title).toBe('Hello');
    expect(model.messages.length).toBe(3);
    expect(model.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(model.messages[0].blocks[0].text).toBe('你好');
    expect(model.messages[1].blocks[0].text).toBe('Hi!');
  });

  it('skips system messages', () => {
    const tree = {
      conversation_id: 'c2',
      title: 'X',
      current_node: 'b',
      mapping: {
        a: { id: 'a', parent: null, children: ['b'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['sys'] } } },
        b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi'] } } }
      }
    };
    const model = apiTreeToModel(tree);
    expect(model.messages.length).toBe(1);
    expect(model.messages[0].role).toBe('assistant');
  });
});

describe('apiMessageToBlocks', () => {
  it('thoughts content → thought blocks', () => {
    const msg = {
      author: { role: 'assistant' },
      content: { content_type: 'thoughts', thoughts: [
        { summary: 'planning', content: 'first plan' },
        { summary: 'check', content: 'second check' }
      ]}
    };
    const blocks = apiMessageToBlocks(msg, 'assistant', ConversationModel);
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe('thought');
    expect(blocks[0].summary).toBe('planning');
    expect(blocks[1].detailsText).toBe('second check');
  });

  it('code content_type → code block', () => {
    const msg = {
      author: { role: 'assistant' },
      content: { content_type: 'code', language: 'python', text: 'print(1)' }
    };
    const blocks = apiMessageToBlocks(msg, 'assistant', ConversationModel);
    expect(blocks[0].type).toBe('code');
    expect(blocks[0].lang).toBe('python');
    expect(blocks[0].code).toBe('print(1)');
  });

  it('search_result_groups metadata → web_search block', () => {
    const msg = {
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: ['基于搜索的回答'] },
      metadata: {
        search_result_groups: [{
          queries: ['redis windows'],
          entries: [
            { title: 'Redis Docs', url: 'https://redis.io/docs', snippet: 'Official' },
            { title: 'MS Redis', url: 'https://github.com/microsoftarchive/redis' }
          ]
        }]
      }
    };
    const blocks = apiMessageToBlocks(msg, 'assistant', ConversationModel);
    expect(blocks.find((b) => b.type === 'text')).toBeTruthy();
    const ws = blocks.find((b) => b.type === 'web_search');
    expect(ws).toBeTruthy();
    expect(ws.queries).toContain('redis windows');
    expect(ws.sources.length).toBe(2);
  });

  it('canvas metadata → canvas block', () => {
    const msg = {
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: ['查看右侧 canvas'] },
      metadata: {
        canvas: { id: 'cv1', title: 'My Doc', language: 'md', content: '# header\nbody' }
      }
    };
    const blocks = apiMessageToBlocks(msg, 'assistant', ConversationModel);
    const cv = blocks.find((b) => b.type === 'canvas');
    expect(cv).toBeTruthy();
    expect(cv.title).toBe('My Doc');
    expect(cv.content).toContain('header');
  });

  it('multimodal_text with image_asset_pointer → image block', () => {
    const msg = {
      author: { role: 'user' },
      content: { content_type: 'multimodal_text', parts: [
        'see this image',
        { content_type: 'image_asset_pointer', asset_pointer: 'file-abc', metadata: { dalle: { prompt: 'a cat' } } }
      ]}
    };
    const blocks = apiMessageToBlocks(msg, 'user', ConversationModel);
    expect(blocks.find((b) => b.type === 'text')).toBeTruthy();
    expect(blocks.find((b) => b.type === 'image')).toBeTruthy();
    expect(blocks.find((b) => b.type === 'image').alt).toBe('a cat');
  });
});
