// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parserPath = path.resolve(__dirname, '..', 'src', 'content', 'parser.js');
const source = readFileSync(parserPath, 'utf8');

let Parser;

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = 'ChatGPT';
  delete window.ChatGPTSaver;
  const fn = new Function('window', 'document', source + '\nreturn window.ChatGPTSaver.Parser;');
  Parser = fn(window, document);
});

describe('ChatGPTParser.getConversationTitle', () => {
  it('extracts title from document.title with ChatGPT suffix', () => {
    document.title = 'My Conversation - ChatGPT';
    expect(Parser.getConversationTitle()).toBe('My Conversation');
  });

  it('falls back to URL-based label when no other source is available', () => {
    document.title = 'ChatGPT';
    history.pushState({}, '', '/c/abc123def456');
    const title = Parser.getConversationTitle();
    expect(title.startsWith('对话_') || title.startsWith('ChatGPT对话_')).toBe(true);
  });
});

describe('ChatGPTParser.getMessageElements', () => {
  it('returns elements via data-message-author-role when present', () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">Hi</div></div>
      <div data-message-author-role="assistant"><div class="markdown prose">Hello</div></div>
    `;
    const messages = Parser.getMessageElements();
    expect(messages).toHaveLength(2);
  });

  it('returns empty array when no matches', () => {
    document.body.innerHTML = '<div>no messages here</div>';
    expect(Parser.getMessageElements()).toEqual([]);
  });
});

describe('ChatGPTParser.parseMessage / parseConversation', () => {
  it('parses user and assistant messages with cleaned content', () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">Hi there</div></div>
        <div data-message-author-role="assistant"><div class="markdown prose">Hello world</div></div>
      </main>
    `;
    const parsed = Parser.parseConversation();
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].textContent).toContain('Hi there');
    expect(parsed.messages[1].role).toBe('assistant');
    expect(parsed.messages[1].textContent).toContain('Hello world');
  });

  it('returns empty messages list when document body has no chat content', () => {
    const parsed = Parser.parseConversation();
    expect(parsed.messages).toEqual([]);
  });
});

describe('ChatGPTParser.getContentHash', () => {
  it('produces stable hash for same content and different hash when content changes', () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">A</div></div>
    `;
    const h1 = Parser.getContentHash();

    document.body.innerHTML = `
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">A</div></div>
    `;
    const h2 = Parser.getContentHash();
    expect(h2).toBe(h1);

    document.body.innerHTML = `
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">B</div></div>
    `;
    const h3 = Parser.getContentHash();
    expect(h3).not.toBe(h1);
  });
});

describe('ChatGPTParser.isGPTTyping', () => {
  it('detects stop-generating button as typing state', () => {
    document.body.innerHTML = '<button data-testid="stop-button"></button>';
    expect(Parser.isGPTTyping()).toBe(true);
  });

  it('returns false when no typing indicators present', () => {
    document.body.innerHTML = '<div>idle</div>';
    expect(Parser.isGPTTyping()).toBe(false);
  });
});

describe('ChatGPTParser.getWorkspaceName', () => {
  it('returns 个人帐户 by default when nothing matches', () => {
    expect(Parser.getWorkspaceName()).toBe('个人帐户');
  });
});

describe('ChatGPTParser.isWorkspacePage', () => {
  it('matches /g/ and /gpts/ paths', () => {
    history.pushState({}, '', '/g/some-gpt');
    expect(Parser.isWorkspacePage()).toBe(true);

    history.pushState({}, '', '/gpts/123');
    expect(Parser.isWorkspacePage()).toBe(true);

    history.pushState({}, '', '/c/abc');
    expect(Parser.isWorkspacePage()).toBe(false);
  });
});
