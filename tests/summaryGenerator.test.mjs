import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SummaryGenerator } = require('../src/utils/jsonExporter');

// --- Generators ---
const userMsg = fc.record({
  role: fc.constant('user'),
  textContent: fc.string({ minLength: 1, maxLength: 100 }),
});

const assistantMsg = fc.record({
  role: fc.constant('assistant'),
  textContent: fc.string({ minLength: 1, maxLength: 100 }),
});

const messagesArb = (minLen, maxLen) =>
  fc.array(fc.oneof(userMsg, assistantMsg), { minLength: minLen, maxLength: maxLen });

// --- Property Tests ---

describe('Property 3: Summary content correctness by conversation length', () => {
  // **Feature: chatgpt-saver-enhancement, Property 3: Summary content correctness by conversation length**
  // **Validates: Requirements 2.1, 2.2, 2.3**

  it('<10 messages: summary contains all user and assistant textContent', () => {
    fc.assert(
      fc.property(messagesArb(1, 9), (messages) => {
        const summary = SummaryGenerator.generate(messages);
        const userMsgs = messages.filter(m => m.role === 'user');
        const assistantMsgs = messages.filter(m => m.role === 'assistant');
        userMsgs.forEach(m => {
          if (m.textContent.trim()) expect(summary).toContain(m.textContent.trim());
        });
        assistantMsgs.forEach(m => {
          const text = m.textContent.trim();
          if (text) {
            const preview = text.length > 200 ? text.substring(0, 200) : text;
            expect(summary).toContain(preview);
          }
        });
      }),
      { numRuns: 100 }
    );
  });

  it('10-30 messages: summary contains first 3 user + last 3 assistant', () => {
    fc.assert(
      fc.property(messagesArb(10, 30), (messages) => {
        const summary = SummaryGenerator.generate(messages);
        const userMsgs = messages.filter(m => m.role === 'user');
        const assistantMsgs = messages.filter(m => m.role === 'assistant');

        userMsgs.slice(0, 3).forEach(m => {
          if (m.textContent.trim()) expect(summary).toContain(m.textContent.trim());
        });
        assistantMsgs.slice(-3).forEach(m => {
          const text = m.textContent.trim();
          if (text) {
            const preview = text.length > 200 ? text.substring(0, 200) : text;
            expect(summary).toContain(preview);
          }
        });
      }),
      { numRuns: 100 }
    );
  });

  it('>30 messages: summary contains first 5 user + last 5 assistant', () => {
    fc.assert(
      fc.property(messagesArb(31, 50), (messages) => {
        const summary = SummaryGenerator.generate(messages);
        const userMsgs = messages.filter(m => m.role === 'user');
        const assistantMsgs = messages.filter(m => m.role === 'assistant');

        userMsgs.slice(0, 5).forEach(m => {
          if (m.textContent.trim()) expect(summary).toContain(m.textContent.trim());
        });
        assistantMsgs.slice(-5).forEach(m => {
          const text = m.textContent.trim();
          if (text) {
            const preview = text.length > 200 ? text.substring(0, 200) : text;
            expect(summary).toContain(preview);
          }
        });
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 4: Summary format contains required sections', () => {
  // **Feature: chatgpt-saver-enhancement, Property 4: Summary format contains required sections**
  // **Validates: Requirements 2.4**
  it('non-empty conversation summary contains Key Questions and Recent Answers', () => {
    fc.assert(
      fc.property(messagesArb(2, 40), (messages) => {
        const hasUser = messages.some(m => m.role === 'user');
        const hasAssistant = messages.some(m => m.role === 'assistant');
        if (!hasUser || !hasAssistant) return;

        const summary = SummaryGenerator.generate(messages);
        expect(summary).toContain('Key Questions');
        expect(summary).toContain('Recent Answers');
      }),
      { numRuns: 100 }
    );
  });
});

// --- Unit Tests ---

describe('Summary Generator unit tests', () => {
  it('returns empty string for empty messages', () => {
    expect(SummaryGenerator.generate([])).toBe('');
    expect(SummaryGenerator.generate(null)).toBe('');
  });

  it('handles exactly 10 messages (boundary)', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      textContent: `Message ${i}`,
    }));
    const summary = SummaryGenerator.generate(msgs);
    expect(summary).toContain('Key Questions');
    expect(summary).toContain('Message 0');
    expect(summary).toContain('Message 2');
    expect(summary).toContain('Message 4');
  });

  it('handles exactly 31 messages (boundary)', () => {
    const msgs = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      textContent: `Msg${i}`,
    }));
    const summary = SummaryGenerator.generate(msgs);
    expect(summary).toContain('Msg0');
    expect(summary).toContain('Msg2');
    expect(summary).toContain('Msg4');
    expect(summary).toContain('Msg6');
    expect(summary).toContain('Msg8');
  });
});
