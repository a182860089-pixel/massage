import { describe, expect, it } from 'vitest';
import { splitCodeLines } from '../src/pdf-v2/renderers/codeRenderer.mjs';
import { normalizeFormulaText } from '../src/pdf-v2/renderers/formulaRenderer.mjs';
import { normalizeImagePayload } from '../src/pdf-v2/renderers/imageRenderer.mjs';
import { computeColumnWeights } from '../src/pdf-v2/renderers/tableRenderer.mjs';

describe('PDF v2 renderers helpers', () => {
  it('splitCodeLines keeps line boundaries', () => {
    expect(splitCodeLines('a\nb\r\nc')).toEqual(['a', 'b', 'c']);
    expect(splitCodeLines('')).toEqual(['']);
  });

  it('normalizeFormulaText prefers latex content', () => {
    expect(normalizeFormulaText({ latex: 'x^2', text: 'x2' })).toBe('x^2');
    expect(normalizeFormulaText({ text: 'fallback' })).toBe('fallback');
  });

  it('normalizeImagePayload applies defaults', () => {
    const normalized = normalizeImagePayload({ src: 'https://example.com/a.png', renderMode: 'link' });
    expect(normalized.src).toContain('example.com');
    expect(normalized.width).toBeGreaterThan(0);
    expect(normalized.height).toBeGreaterThan(0);
    expect(normalized.renderMode).toBe('link');
  });

  it('computeColumnWeights normalizes width ratios', () => {
    const weights = computeColumnWeights(['A', 'Long Header'], [['x', 'yyyy']]);
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(weights).toHaveLength(2);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(weights[1]).toBeGreaterThan(weights[0]);
  });
});
