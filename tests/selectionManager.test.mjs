import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SelectionManager } = require('../src/utils/selectionManager');

// Helper: create a fresh manager state for each test
function freshManager() {
  SelectionManager.activate();
  return SelectionManager;
}

describe('Property 2: Selection toggle is an involution', () => {
  // **Feature: chatgpt-saver-v2, Property 2: Selection toggle is an involution**
  // **Validates: Requirements 2.2**
  it('toggling any index twice returns selection to original state', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 0, max: 99 }),
        (initialIndices, toggleIndex) => {
          const mgr = freshManager();
          // Set up initial state
          for (const idx of initialIndices) {
            mgr._selectedIndices.add(idx);
          }
          const before = new Set(mgr._selectedIndices);

          // Toggle twice
          mgr.toggle(toggleIndex);
          mgr.toggle(toggleIndex);

          const after = mgr.getSelectedIndices();
          expect(after).toEqual(before);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Shift-select produces contiguous range', () => {
  // **Feature: chatgpt-saver-v2, Property 3: Shift-select produces contiguous range**
  // **Validates: Requirements 2.3**
  it('shift-selecting from i to j selects all indices in [min(i,j), max(i,j)]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        (i, j) => {
          const mgr = freshManager();
          // First click sets lastClickedIndex
          mgr.toggle(i);
          // Shift-select to j
          mgr.shiftSelect(j);

          const selected = mgr.getSelectedIndices();
          const start = Math.min(i, j);
          const end = Math.max(i, j);

          // All indices in [start, end] must be selected
          for (let k = start; k <= end; k++) {
            expect(selected.has(k)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 4: Fragment export preserves order and content', () => {
  // **Feature: chatgpt-saver-v2, Property 4: Fragment export preserves order and content**
  // **Validates: Requirements 2.4, 2.5**
  it('getSelectedMessages returns exactly the selected messages in original order', () => {
    const messageArb = fc.record({
      role: fc.constantFrom('user', 'assistant'),
      content: fc.string({ minLength: 1, maxLength: 100 }),
    });

    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 50 }),
        fc.array(fc.nat(), { minLength: 0, maxLength: 20 }),
        (messages, rawIndices) => {
          const mgr = freshManager();

          // Clamp indices to valid range and deduplicate
          const validIndices = [...new Set(rawIndices.map(i => i % messages.length))];
          for (const idx of validIndices) {
            mgr.toggle(idx);
          }

          const result = mgr.getSelectedMessages(messages);
          const sortedIndices = validIndices.sort((a, b) => a - b);

          // Same count
          expect(result.length).toBe(sortedIndices.length);

          // Same content in order
          for (let k = 0; k < result.length; k++) {
            expect(result[k]).toEqual(messages[sortedIndices[k]]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Unit tests
describe('SelectionManager unit tests', () => {
  beforeEach(() => {
    SelectionManager.activate();
  });

  it('starts with empty selection', () => {
    expect(SelectionManager.selectedCount()).toBe(0);
  });

  it('toggle adds and removes', () => {
    SelectionManager.toggle(5);
    expect(SelectionManager.selectedCount()).toBe(1);
    SelectionManager.toggle(5);
    expect(SelectionManager.selectedCount()).toBe(0);
  });

  it('clear resets selection', () => {
    SelectionManager.toggle(1);
    SelectionManager.toggle(2);
    SelectionManager.clear();
    expect(SelectionManager.selectedCount()).toBe(0);
  });

  it('deactivate resets everything', () => {
    SelectionManager.toggle(1);
    SelectionManager.deactivate();
    expect(SelectionManager.isActive()).toBe(false);
    expect(SelectionManager.selectedCount()).toBe(0);
  });

  it('shiftSelect with no prior click just selects the index', () => {
    SelectionManager.activate();
    SelectionManager._lastClickedIndex = -1;
    SelectionManager.shiftSelect(5);
    expect(SelectionManager.getSelectedIndices().has(5)).toBe(true);
  });
});
