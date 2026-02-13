import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { TemplateManager } = require('../src/utils/templateManager');

// Reset in-memory store before each test
beforeEach(() => {
  TemplateManager._memStore = [];
});

// Generator for variable names (word characters only)
const varNameArb = fc.stringMatching(/^[a-zA-Z_]\w{0,19}$/);

describe('Property 8: Variable extraction finds all placeholders', () => {
  // **Feature: chatgpt-saver-v2, Property 8: Variable extraction finds all placeholders**
  // **Validates: Requirements 4.2**
  it('for any string with N unique {{var}} patterns, extractVariables returns exactly N names', () => {
    fc.assert(
      fc.property(
        fc.set(varNameArb, { minLength: 0, maxLength: 10 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        (varNamesSet, filler) => {
          const varNames = Array.from(varNamesSet);
          // Remove any accidental {{...}} patterns from filler
          const cleanFiller = filler.replace(/\{\{\w+\}\}/g, '');
          // Build a template with known variables embedded in filler text
          let content = cleanFiller;
          for (const v of varNames) {
            content += ` {{${v}}} `;
          }
          const extracted = TemplateManager.extractVariables(content);
          expect(extracted.length).toBe(varNames.length);
          for (const v of varNames) {
            expect(extracted).toContain(v);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 9: Template variable replacement is complete', () => {
  // **Feature: chatgpt-saver-v2, Property 9: Template variable replacement is complete**
  // **Validates: Requirements 4.4**
  it('for any template with complete variable mapping, result has zero {{...}} patterns', () => {
    fc.assert(
      fc.property(
        fc.set(varNameArb, { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (varNamesSet, filler) => {
          const varNames = Array.from(varNamesSet);
          if (varNames.length === 0) return;
          // Remove accidental {{...}} from filler
          const cleanFiller = filler.replace(/\{\{\w+\}\}/g, '');
          // Build template
          let content = cleanFiller;
          const variables = {};
          for (const v of varNames) {
            content += ` {{${v}}} `;
            variables[v] = 'replaced_' + v;
          }
          const result = TemplateManager.applyTemplate(content, variables);
          // No remaining {{...}} patterns
          expect(result).not.toMatch(/\{\{\w+\}\}/);
          // Each replacement value is present
          for (const v of varNames) {
            expect(result).toContain('replaced_' + v);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Property 10: Template edit preserves creation timestamp', () => {
  // **Feature: chatgpt-saver-v2, Property 10: Template edit preserves creation timestamp**
  // **Validates: Requirements 4.5**
  it('updating content does not change createdAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (name, content, newContent) => {
          TemplateManager._memStore = [];
          const saved = await TemplateManager.save({ name, content });
          const originalCreatedAt = saved.createdAt;

          // Small delay to ensure updatedAt differs
          await new Promise(r => setTimeout(r, 1));

          const updated = await TemplateManager.update(saved.id, { content: newContent });
          expect(updated.createdAt).toBe(originalCreatedAt);
          expect(updated.content).toBe(newContent);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 11: Template delete removes exactly one', () => {
  // **Feature: chatgpt-saver-v2, Property 11: Template delete removes exactly one**
  // **Validates: Requirements 4.6**
  it('deleting a template from N templates results in N-1 without that id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }),
            content: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.nat(),
        async (templateDefs, pickIdx) => {
          TemplateManager._memStore = [];
          const saved = [];
          for (const def of templateDefs) {
            saved.push(await TemplateManager.save(def));
          }
          const n = saved.length;
          const target = saved[pickIdx % n];

          await TemplateManager.remove(target.id);
          const remaining = await TemplateManager.getAll();

          expect(remaining.length).toBe(n - 1);
          expect(remaining.find(t => t.id === target.id)).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 12: Template data serialization round-trip', () => {
  // **Feature: chatgpt-saver-v2, Property 12: Template data serialization round-trip**
  // **Validates: Requirements 5.1, 5.2**
  it('deserialize(serialize(data)) deeply equals original', () => {
    const templateArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 36 }),
      name: fc.string({ minLength: 0, maxLength: 50 }),
      content: fc.string({ minLength: 0, maxLength: 200 }),
      createdAt: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ts => new Date(ts).toISOString()),
      updatedAt: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ts => new Date(ts).toISOString()),
    });

    fc.assert(
      fc.property(
        fc.array(templateArb, { minLength: 0, maxLength: 10 }),
        (templates) => {
          const serialized = TemplateManager.serialize(templates);
          const deserialized = TemplateManager.deserialize(serialized);
          expect(deserialized).toEqual(templates);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Unit tests
describe('TemplateManager unit tests', () => {
  beforeEach(() => {
    TemplateManager._memStore = [];
  });

  it('save and getAll', async () => {
    await TemplateManager.save({ name: 'Test', content: 'Hello {{name}}' });
    const all = await TemplateManager.getAll();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('Test');
  });

  it('extractVariables returns empty for no placeholders', () => {
    expect(TemplateManager.extractVariables('no vars here')).toEqual([]);
  });

  it('extractVariables deduplicates', () => {
    const vars = TemplateManager.extractVariables('{{a}} {{b}} {{a}}');
    expect(vars.length).toBe(2);
    expect(vars).toContain('a');
    expect(vars).toContain('b');
  });

  it('applyTemplate preserves unmatched vars', () => {
    const result = TemplateManager.applyTemplate('{{a}} {{b}}', { a: 'X' });
    expect(result).toBe('X {{b}}');
  });

  it('serialize produces 2-space indented JSON', () => {
    const data = { a: 1 };
    expect(TemplateManager.serialize(data)).toBe('{\n  "a": 1\n}');
  });

  it('remove returns false for non-existent id', async () => {
    const result = await TemplateManager.remove('nonexistent');
    expect(result).toBe(false);
  });
});
