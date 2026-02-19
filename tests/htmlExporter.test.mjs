import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { HTMLExporter } = require('../src/utils/htmlExporter');

const originalWindow = global.window;
const originalDocument = global.document;

let dom = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://chatgpt.com/c/test-conversation'
  });
  global.window = dom.window;
  global.document = dom.window.document;
});

afterEach(() => {
  if (dom) {
    dom.window.close();
    dom = null;
  }
  global.window = originalWindow;
  global.document = originalDocument;
});

describe('HTMLExporter', () => {
  it('returns null for empty conversations', () => {
    expect(HTMLExporter.exportConversation({ messages: [] })).toBeNull();
    expect(HTMLExporter.exportConversation(null)).toBeNull();
  });

  it('renders GPT-like layout with copy actions and runtime script', () => {
    const html = HTMLExporter.exportConversation({
      title: 'Redis 启动问题',
      isWorkspace: true,
      url: 'https://chatgpt.com/c/test',
      messages: [
        {
          role: 'user',
          content: '<p>不知道</p>',
          textContent: '不知道'
        },
        {
          role: 'assistant',
          content: '<p>可以这样试：</p><pre data-language="bat"><code>redis-server.exe redis.windows.conf</code></pre>',
          textContent: '可以这样试 redis-server.exe redis.windows.conf'
        }
      ]
    });

    expect(html).toContain('class="chat-turn user"');
    expect(html).toContain('class="chat-turn assistant"');
    expect(html).toContain('data-copy-kind="text"');
    expect(html).toContain('data-copy-kind="html"');
    expect(html).toContain('function initCodeBlocks()');
    expect(html).toContain('Workspace');
  });

  it('sanitizes unsafe nodes and normalizes code blocks', () => {
    const raw = [
      '<div>',
      '<script>alert(1)</script>',
      '<button>复制代码</button>',
      '<div class="copy-btn">Copy</div>',
      '<pre style="max-height:40px"><code class="language-bash">echo test</code></pre>',
      '<a href="https://example.com" onclick="evil()">link</a>',
      '</div>'
    ].join('');

    const sanitized = HTMLExporter.sanitizeMessageHtml(raw);

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('<button');
    expect(sanitized).not.toContain('copy-btn');
    expect(sanitized).not.toContain('onclick=');
    expect(sanitized).not.toContain('style=');
    expect(sanitized).toContain('data-language="bash"');
    expect(sanitized).toContain('language-bash');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });
});
