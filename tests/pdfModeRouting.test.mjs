import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

function loadPDFExporter() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    console,
    setTimeout,
    clearTimeout
  });
  context.window.ChatGPTSaver = {};
  context.globalThis = context.window;

  const code = fs.readFileSync(path.resolve('src/utils/pdfExporter.js'), 'utf8');
  vm.runInContext(code, context, { filename: 'src/utils/pdfExporter.js' });
  return context.window.ChatGPTSaver.PDFExporter;
}

describe('PDF mode routing', () => {
  const smallConversation = {
    title: 'Small',
    messages: [{ role: 'user', content: '<p>Hello</p>', textContent: 'Hello' }]
  };

  it('uses structured chain for structured_auto mode', async () => {
    const exporter = loadPDFExporter();
    const calls = [];

    exporter.exportStructuredV2 = async () => { calls.push('v2'); return null; };
    exporter.exportStructured = async () => { calls.push('structured'); return 'structured-result'; };
    exporter.exportVisual = async () => { calls.push('visual'); return 'visual-result'; };

    const result = await exporter.exportWithFallback({ mode: 'structured_auto', conversation: smallConversation });
    expect(result).toBe('structured-result');
    expect(calls).toEqual(['v2', 'structured']);
  });

  it('uses visual directly when visual mode is explicitly requested for small conversations', async () => {
    const exporter = loadPDFExporter();
    const calls = [];

    exporter.analyzeConversation = () => ({ estimatedPages: 12, risk: 'low' });
    exporter.exportVisual = async () => { calls.push('visual'); return 'visual-result'; };
    exporter.exportStructuredV2 = async () => { calls.push('v2'); return 'v2-result'; };
    exporter.exportStructured = async () => { calls.push('structured'); return 'structured-result'; };

    const result = await exporter.exportWithFallback({ mode: 'visual', conversation: smallConversation });
    expect(result).toBe('visual-result');
    expect(calls).toEqual(['visual']);
  });

  it('splits large conversations before returning PDF package', async () => {
    const exporter = loadPDFExporter();
    exporter.analyzeConversation = () => ({ estimatedPages: 220, risk: 'high' });
    exporter.exportStructuredParts = async () => ({
      success: true,
      parts: [{ nameSuffix: 'part01', blob: 'blob-a' }, { nameSuffix: 'part02', blob: 'blob-b' }]
    });

    const result = await exporter.exportPackage({
      mode: 'structured_auto',
      conversation: {
        title: 'Large',
        messages: [{ role: 'assistant', content: '<p>x</p>', textContent: 'x' }]
      }
    });

    expect(result.success).toBe(true);
    expect(result.split).toBe(true);
    expect(result.parts).toHaveLength(2);
  });
});
