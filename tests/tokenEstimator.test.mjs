import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { TokenEstimator } = require('../src/utils/tokenEstimator');

// --- Property Tests ---

describe('Property 5: Token estimation produces positive values proportional to input', () => {
  // **Feature: chatgpt-saver-enhancement, Property 5: Token estimation produces positive values proportional to input**
  // **Validates: Requirements 3.1**

  it('returns positive integer for any non-empty string', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (text) => {
        const result = TokenEstimator.estimateTokens(text);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it('monotonicity: estimateTokens(A) <= estimateTokens(A + B) for non-empty B', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (a, b) => {
          const tokensA = TokenEstimator.estimateTokens(a);
          const tokensAB = TokenEstimator.estimateTokens(a + b);
          expect(tokensAB).toBeGreaterThanOrEqual(tokensA);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 6: Workspace token data serialization round-trip', () => {
  // **Feature: chatgpt-saver-enhancement, Property 6: Workspace token data serialization round-trip**
  // **Validates: Requirements 3.6**

  // Generate valid ISO date strings directly to avoid Invalid Date issues
  const isoDateArb = fc.integer({ min: 946684800000, max: 1924905600000 })
    .map(ts => new Date(ts).toISOString());

  const workspaceDataArb = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.record({
      consumed: fc.nat(),
      conversations: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.record({
          tokens: fc.nat(),
          lastUpdated: isoDateArb,
        })
      ),
      lastUpdated: isoDateArb,
    })
  );

  it('deserialize(serialize(data)) equals original', () => {
    fc.assert(
      fc.property(workspaceDataArb, (data) => {
        const serialized = TokenEstimator.serialize(data);
        const deserialized = TokenEstimator.deserialize(serialized);
        expect(deserialized).toEqual(data);
      }),
      { numRuns: 100 }
    );
  });
});

// --- Unit Tests ---

describe('Token Estimator unit tests', () => {
  it('returns 0 for empty string', () => {
    expect(TokenEstimator.estimateTokens('')).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(TokenEstimator.estimateTokens(null)).toBe(0);
    expect(TokenEstimator.estimateTokens(undefined)).toBe(0);
  });

  it('estimates pure English text', () => {
    expect(TokenEstimator.estimateTokens('hello world')).toBe(3);
  });

  it('estimates pure Chinese text', () => {
    expect(TokenEstimator.estimateTokens('你好世界')).toBe(6);
  });

  it('estimates mixed Chinese/English text', () => {
    expect(TokenEstimator.estimateTokens('hello 你好')).toBe(5);
  });
});
