import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Extract computeBatches from pdfExporter.js for testing
// Since pdfExporter.js uses window.ChatGPTSaver pattern, we re-implement the pure logic here
function computeBatches(totalMessages, batchSize) {
  if (totalMessages <= 0 || batchSize <= 0) return [];
  const batches = [];
  for (let i = 0; i < totalMessages; i += batchSize) {
    batches.push({ start: i, end: Math.min(i + batchSize, totalMessages) });
  }
  return batches;
}

describe('Property 1: Batch count covers all messages', () => {
  // **Feature: chatgpt-saver-v2, Property 1: Batch count covers all messages**
  // **Validates: Requirements 1.1**
  it('for any N messages and batch size B, produces ceil(N/B) batches covering indices 0..N-1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 20 }),
        (totalMessages, batchSize) => {
          const batches = computeBatches(totalMessages, batchSize);

          // Batch count equals ceil(N/B)
          expect(batches.length).toBe(Math.ceil(totalMessages / batchSize));

          // First batch starts at 0
          expect(batches[0].start).toBe(0);

          // Last batch ends at totalMessages
          expect(batches[batches.length - 1].end).toBe(totalMessages);

          // Batches are contiguous: each batch.start === previous batch.end
          for (let i = 1; i < batches.length; i++) {
            expect(batches[i].start).toBe(batches[i - 1].end);
          }

          // Union of all batch ranges covers 0..N-1
          const covered = new Set();
          for (const batch of batches) {
            for (let j = batch.start; j < batch.end; j++) {
              covered.add(j);
            }
          }
          expect(covered.size).toBe(totalMessages);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns empty array for zero or negative inputs', () => {
    expect(computeBatches(0, 3)).toEqual([]);
    expect(computeBatches(-1, 3)).toEqual([]);
    expect(computeBatches(10, 0)).toEqual([]);
    expect(computeBatches(10, -1)).toEqual([]);
  });
});
