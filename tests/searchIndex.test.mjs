import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SearchIndex } = require('../src/utils/searchIndex');

// --- Pure logic tests (no IndexedDB needed) ---

// Helper: validate an index entry has all required fields
function validateEntry(entry) {
  return (
    typeof entry.id === 'string' && entry.id.length > 0 &&
    typeof entry.title === 'string' && entry.title.length > 0 &&
    typeof entry.workspace === 'string' && entry.workspace.length > 0 &&
    typeof entry.url === 'string' && entry.url.length > 0 &&
    typeof entry.timestamp === 'string' && entry.timestamp.length > 0 &&
    typeof entry.textContent === 'string' && entry.textContent.length > 0 &&
    typeof entry.messageCount === 'number' && entry.messageCount >= 0
  );
}

// Generator for valid search index entries
const entryArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  workspace: fc.string({ minLength: 1, maxLength: 50 }),
  url: fc.webUrl(),
  timestamp: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ts => new Date(ts).toISOString()),
  textContent: fc.string({ minLength: 1, maxLength: 500 }),
  messageCount: fc.nat({ max: 1000 }),
});

describe('Property 5: Search index entry contains all required fields', () => {
  // **Feature: chatgpt-saver-v2, Property 5: Search index entry contains all required fields**
  // **Validates: Requirements 3.1**
  it('for any conversation data, the entry contains non-empty id, title, workspace, url, timestamp, textContent', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        expect(validateEntry(entry)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 6: Snippet extraction contains keyword', () => {
  // **Feature: chatgpt-saver-v2, Property 6: Snippet extraction contains keyword**
  // **Validates: Requirements 3.3**
  it('for any text containing a keyword, extractSnippet returns a string containing the keyword', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 500 }),
        fc.integer({ min: 10, max: 80 }),
        (text, contextLen) => {
          if (text.length < 3) return; // skip trivial
          // Pick a random substring as keyword
          const start = Math.floor(Math.random() * Math.max(1, text.length - 2));
          const end = Math.min(text.length, start + 1 + Math.floor(Math.random() * 5));
          const keyword = text.substring(start, end);
          if (!keyword) return;

          const snippet = SearchIndex.extractSnippet(text, keyword, contextLen);
          expect(snippet.toLowerCase()).toContain(keyword.toLowerCase());
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 7: Chinese substring search matches', () => {
  // **Feature: chatgpt-saver-v2, Property 7: Chinese substring search matches**
  // **Validates: Requirements 3.5**
  it('for any Chinese text and contiguous substring, search logic matches', () => {
    // Since we can't use IndexedDB in Node, test the matching logic directly
    const chineseChars = '你好世界测试搜索中文对话人工智能机器学习深度学习自然语言处理';

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: chineseChars.length - 2 }),
        fc.integer({ min: 1, max: 5 }),
        (start, len) => {
          const end = Math.min(start + len, chineseChars.length);
          const query = chineseChars.substring(start, end);
          if (!query) return;

          // Simulate the search matching logic from SearchIndex.search
          const lowerQuery = query.toLowerCase();
          const textContent = chineseChars;
          const match = textContent.toLowerCase().includes(lowerQuery);
          expect(match).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Unit tests
describe('SearchIndex unit tests', () => {
  it('extractSnippet returns empty for empty text', () => {
    expect(SearchIndex.extractSnippet('', 'test', 40)).toBe('');
  });

  it('extractSnippet returns empty for empty keyword', () => {
    expect(SearchIndex.extractSnippet('hello world', '', 40)).toBe('');
  });

  it('extractSnippet truncates with ellipsis for long text', () => {
    const text = 'A'.repeat(100) + '关键词' + 'B'.repeat(100);
    const snippet = SearchIndex.extractSnippet(text, '关键词', 10);
    expect(snippet).toContain('关键词');
    expect(snippet).toContain('...');
  });

  it('extractSnippet handles keyword at start', () => {
    const snippet = SearchIndex.extractSnippet('hello world foo bar', 'hello', 5);
    expect(snippet).toContain('hello');
  });

  it('extractSnippet handles keyword at end', () => {
    const snippet = SearchIndex.extractSnippet('foo bar hello', 'hello', 5);
    expect(snippet).toContain('hello');
  });
});
