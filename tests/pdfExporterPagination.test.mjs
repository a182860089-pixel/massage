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

describe('PDF exporter pagination helpers', () => {
  it('computeSliceHeightPx keeps safety pixels and respects remaining bounds', () => {
    const exporter = loadPDFExporter();
    exporter.sliceBoundarySafetyPx = 2;

    expect(exporter.computeSliceHeightPx(50, 10, 1200)).toBe(498);
    expect(exporter.computeSliceHeightPx(50, 10, 120)).toBe(120);
    expect(exporter.computeSliceHeightPx(0.05, 10, 120)).toBe(1);
    expect(exporter.computeSliceHeightPx(20, 10, 0)).toBe(0);
  });

  it('maybeTrimSlice is no-op by default to avoid cross-page content loss', () => {
    const exporter = loadPDFExporter();
    const canvas = { width: 20, height: 20 };
    exporter.enableSliceWhitespaceTrim = false;
    expect(exporter.maybeTrimSlice(canvas, {})).toBe(canvas);
  });
});
