import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PlatformAdapterRegistry } = require('../src/adapters/_base.js');

beforeEach(() => PlatformAdapterRegistry.reset());

const fakeChatGpt = {
  id: 'chatgpt',
  hostMatches: (url) => /chatgpt\.com|chat\.openai\.com/.test(url || ''),
  parseConversationModel: () => ({ messages: [] })
};

const fakeGemini = {
  id: 'gemini',
  hostMatches: (url) => /gemini\.google\.com/.test(url || ''),
  parseConversationModel: () => ({ messages: [] })
};

describe('PlatformAdapterRegistry', () => {
  it('registers and lists adapters in insertion order', () => {
    PlatformAdapterRegistry.register(fakeChatGpt);
    PlatformAdapterRegistry.register(fakeGemini);
    const ids = PlatformAdapterRegistry.list().map((a) => a.id);
    expect(ids).toEqual(['chatgpt', 'gemini']);
  });

  it('resolves adapter by URL', () => {
    PlatformAdapterRegistry.register(fakeChatGpt);
    PlatformAdapterRegistry.register(fakeGemini);
    expect(PlatformAdapterRegistry.resolveForUrl('https://chatgpt.com/c/x').id).toBe('chatgpt');
    expect(PlatformAdapterRegistry.resolveForUrl('https://gemini.google.com/app/y').id).toBe('gemini');
    expect(PlatformAdapterRegistry.resolveForUrl('https://example.com/')).toBeNull();
  });

  it('rejects invalid adapters', () => {
    expect(() => PlatformAdapterRegistry.register(null)).toThrow();
    expect(() => PlatformAdapterRegistry.register({})).toThrow(/id/);
    expect(() => PlatformAdapterRegistry.register({ id: 'x' })).toThrow(/hostMatches/);
    expect(() => PlatformAdapterRegistry.register({ id: 'x', hostMatches: () => true })).toThrow(/parseConversationModel/);
  });
});
