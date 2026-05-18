import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { CommandBus, Commands } = require('../src/core/commandBus.js');

beforeEach(() => {
  CommandBus.reset();
});

describe('CommandBus', () => {
  it('registers and dispatches a handler', async () => {
    const handler = vi.fn(async (args) => ({ ok: true, args }));
    CommandBus.register('foo.bar', handler);
    expect(CommandBus.has('foo.bar')).toBe(true);
    const result = await CommandBus.dispatch('foo.bar', { a: 1 });
    expect(result).toEqual({ ok: true, args: { a: 1 } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('throws when no handler', async () => {
    await expect(CommandBus.dispatch('not.found')).rejects.toThrow(/No handler/);
  });

  it('falls back to registerAny', async () => {
    const any = vi.fn(async ({ commandId }) => ({ commandId }));
    CommandBus.registerAny(any);
    const r = await CommandBus.dispatch('any.thing', { x: 1 });
    expect(r).toEqual({ commandId: 'any.thing' });
    expect(any).toHaveBeenCalled();
  });

  it('unregister works', async () => {
    CommandBus.register('a', () => 1);
    CommandBus.unregister('a');
    expect(CommandBus.has('a')).toBe(false);
    await expect(CommandBus.dispatch('a')).rejects.toThrow();
  });

  it('list returns command ids', () => {
    CommandBus.register('a', () => 1);
    CommandBus.register('b', () => 2);
    CommandBus.registerAny(() => 0);
    expect(CommandBus.list().sort()).toEqual(['a', 'b']);
  });

  it('register validates input', () => {
    expect(() => CommandBus.register('', () => {})).toThrow();
    expect(() => CommandBus.register('x', null)).toThrow();
  });

  it('exposes Commands constants', () => {
    expect(Commands.EXPORT_CURRENT).toBe('export.current');
    expect(Commands.COPY_MARKDOWN).toBe('copy.markdown');
    expect(Commands.COPY_RICH_TEXT).toBe('copy.richtext');
  });
});
