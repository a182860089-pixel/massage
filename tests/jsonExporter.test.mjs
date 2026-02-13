import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { JSONExporter, SummaryGenerator } = require('../src/utils/jsonExporter');

// --- Generators ---
const messageArb = fc.record({
  role: fc.constantFrom('user', 'assistant'),
  content: fc.string({ minLength: 1, maxLength: 200 }),
  textContent: fc.string({ minLength: 1, maxLength: 200 }),
});

const conversationArb = (minMsg = 1, maxMsg = 50) =>
  fc.record({
    title: fc.string({ minLength: 1, maxLength: 50 }),
    workspace: fc.string({ minLength: 1, maxLength: 30 }),
    url: fc.webUrl(),
    messages: fc.array(messageArb, { minLength: minMsg, maxLength: maxMsg }),
  });

// --- Property Tests ---

describe('Property 1: JSON output structure completeness', () => {
  // **Feature: chatgpt-saver-enhancement, Property 1: JSON output structure completeness**
  // **Validates: Requirements 1.1, 1.3**
  it('should contain all required fields for any valid conversation', () => {
    fc.assert(
      fc.property(conversationArb(), (conv) => {
        const result = JSONExporter.exportFromConversation(conv);
        expect(result).not.toBeNull();
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('workspace');
        expect(result).toHaveProperty('createdAt');
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('messageCount');
        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('messages');
        expect(result.messageCount).toBe(conv.messages.length);
        result.messages.forEach((msg) => {
          expect(msg).toHaveProperty('index');
          expect(msg).toHaveProperty('role');
          expect(msg).toHaveProperty('content');
          expect(msg).toHaveProperty('textContent');
          expect(msg).toHaveProperty('timestamp');
        });
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 2: JSON serialization round-trip', () => {
  // **Feature: chatgpt-saver-enhancement, Property 2: JSON serialization round-trip**
  // **Validates: Requirements 1.2, 6.2**
  it('deserialize(serialize(data)) should equal original', () => {
    fc.assert(
      fc.property(conversationArb(), (conv) => {
        const data = JSONExporter.exportFromConversation(conv);
        const serialized = JSONExporter.serialize(data);
        const deserialized = JSONExporter.deserialize(serialized);
        expect(deserialized).toEqual(data);
      }),
      { numRuns: 100 }
    );
  });
});

// --- Unit Tests ---

describe('JSON Exporter unit tests', () => {
  it('returns null for empty conversation', () => {
    expect(JSONExporter.exportFromConversation({ messages: [] })).toBeNull();
    expect(JSONExporter.exportFromConversation(null)).toBeNull();
  });

  it('handles special characters in title', () => {
    const conv = {
      title: '测试 <script>alert("xss")</script>',
      workspace: '个人帐户',
      url: 'https://chatgpt.com/c/123',
      messages: [{ role: 'user', content: 'hi', textContent: 'hi' }],
    };
    const result = JSONExporter.exportFromConversation(conv);
    expect(result.title).toBe(conv.title);
    const rt = JSONExporter.deserialize(JSONExporter.serialize(result));
    expect(rt.title).toBe(conv.title);
  });

  it('serialize produces 2-space indented JSON', () => {
    const data = { a: 1 };
    const s = JSONExporter.serialize(data);
    expect(s).toBe('{\n  "a": 1\n}');
  });

  it('handles exactly 10 messages (boundary for summary strategy)', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `<p>Msg${i}</p>`,
      textContent: `Msg${i}`,
    }));
    const result = JSONExporter.exportFromConversation({
      title: 'Test', workspace: 'ws', url: 'https://chatgpt.com/c/1', messages: msgs,
    });
    expect(result.messageCount).toBe(10);
    expect(result.summary).toContain('Key Questions');
  });

  it('handles exactly 30 messages (upper boundary of 10-30 range)', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `<p>M${i}</p>`,
      textContent: `M${i}`,
    }));
    const result = JSONExporter.exportFromConversation({
      title: 'T30', workspace: 'ws', url: 'https://chatgpt.com/c/2', messages: msgs,
    });
    expect(result.messageCount).toBe(30);
    // 10-30 range: first 3 user questions
    expect(result.summary).toContain('M0');
    expect(result.summary).toContain('M2');
    expect(result.summary).toContain('M4');
  });

  it('handles exactly 31 messages (triggers >30 strategy)', () => {
    const msgs = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `<p>X${i}</p>`,
      textContent: `X${i}`,
    }));
    const result = JSONExporter.exportFromConversation({
      title: 'T31', workspace: 'ws', url: 'https://chatgpt.com/c/3', messages: msgs,
    });
    expect(result.messageCount).toBe(31);
    // >30 range: first 5 user questions
    expect(result.summary).toContain('X0');
    expect(result.summary).toContain('X2');
    expect(result.summary).toContain('X4');
    expect(result.summary).toContain('X6');
    expect(result.summary).toContain('X8');
  });
});
