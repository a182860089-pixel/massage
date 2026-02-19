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
  it('prefers html_print when mode is html_print', async () => {
    const exporter = loadPDFExporter();
    const calls = [];

    exporter.exportHtmlPrint = async () => { calls.push('html'); return 'html-result'; };
    exporter.exportStructuredV2 = async () => { calls.push('v2'); return 'v2-result'; };
    exporter.exportStructured = async () => { calls.push('structured'); return 'structured-result'; };
    exporter.exportVisual = async () => { calls.push('visual'); return 'visual-result'; };

    const result = await exporter.exportWithFallback({ mode: 'html_print' });
    expect(result).toBe('html-result');
    expect(calls).toEqual(['html']);
  });

  it('falls back to structured chain when html_print fails', async () => {
    const exporter = loadPDFExporter();
    const calls = [];

    exporter.exportHtmlPrint = async () => { calls.push('html'); return null; };
    exporter.exportStructuredV2 = async () => { calls.push('v2'); return null; };
    exporter.exportStructured = async () => { calls.push('structured'); return 'structured-result'; };
    exporter.exportVisual = async () => { calls.push('visual'); return 'visual-result'; };

    const result = await exporter.exportWithFallback({ mode: 'html_print' });
    expect(result).toBe('structured-result');
    expect(calls).toEqual(['html', 'v2', 'structured']);
  });

  it('uses visual directly when mode is visual', async () => {
    const exporter = loadPDFExporter();
    const calls = [];

    exporter.exportHtmlPrint = async () => { calls.push('html'); return 'html-result'; };
    exporter.exportStructuredV2 = async () => { calls.push('v2'); return 'v2-result'; };
    exporter.exportStructured = async () => { calls.push('structured'); return 'structured-result'; };
    exporter.exportVisual = async () => { calls.push('visual'); return 'visual-result'; };

    const result = await exporter.exportWithFallback({ mode: 'visual' });
    expect(result).toBe('visual-result');
    expect(calls).toEqual(['visual']);
  });
});

