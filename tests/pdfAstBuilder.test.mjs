import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

function loadBrowserScript(scriptPath, context) {
  const code = fs.readFileSync(scriptPath, 'utf8');
  vm.runInContext(code, context, { filename: scriptPath });
}

function createBuilder() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    setTimeout,
    clearTimeout,
    console
  });
  context.window.ChatGPTSaver = {};
  context.window.scheduler = { yield: () => Promise.resolve() };
  context.globalThis = context.window;

  loadBrowserScript(path.resolve('src/pdf-v2/normalizers.js'), context);
  loadBrowserScript(path.resolve('src/pdf-v2/astBuilder.js'), context);
  return context.window.ChatGPTSaver.PDFASTBuilder;
}

describe('PDF v2 AST builder', () => {
  it('builds structured blocks from mixed HTML', async () => {
    const builder = createBuilder();
    const progress = [];
    const conversation = {
      title: 'Test Conversation',
      messages: [
        {
          role: 'assistant',
          content: `
            <h2>标题</h2>
            <p>第一段文本</p>
            <ul><li>项目A</li><li>项目B</li></ul>
            <pre data-language="js"><code>const a = 1;\nconsole.log(a);</code></pre>
            <table><tr><th>列1</th><th>列2</th></tr><tr><td>值1</td><td>值2</td></tr></table>
            <blockquote>引用段落</blockquote>
            <div class="katex" data-tex="x^2 + y^2 = z^2"></div>
            <img src="https://example.com/test.png" alt="示例图片" width="200" height="100" />
            <hr />
          `,
          textContent: 'fallback'
        }
      ]
    };

    const ast = await builder.buildConversationAst(conversation, {
      workspace: 'WS-1',
      onProgress: (payload) => progress.push(payload)
    });

    expect(ast.version).toBe('v2');
    expect(ast.title).toBe('Test Conversation');
    expect(ast.workspace).toBe('WS-1');
    expect(ast.messages).toHaveLength(1);
    const blocks = ast.messages[0].blocks;
    const types = blocks.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('code');
    expect(types).toContain('table');
    expect(types).toContain('quote');
    expect(types).toContain('formula');
    expect(types).toContain('image');
    expect(types).toContain('horizontalRule');
    expect(progress.length).toBe(1);
    expect(progress[0].stage).toBe('parse');
  });

  it('falls back to text paragraph on invalid/empty HTML', async () => {
    const builder = createBuilder();
    const ast = await builder.buildConversationAst({
      title: 'Fallback',
      messages: [{ role: 'assistant', content: '<script>bad()</script>', textContent: '纯文本内容' }]
    });

    expect(ast.messages).toHaveLength(1);
    expect(ast.messages[0].blocks).toHaveLength(1);
    expect(ast.messages[0].blocks[0].type).toBe('paragraph');
    expect(ast.messages[0].blocks[0].text).toContain('纯文本内容');
  });
});
