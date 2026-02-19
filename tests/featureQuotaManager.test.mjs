import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { FeatureQuotaManager } = require('../src/utils/featureQuotaManager');

function setAccessMode(mode) {
  globalThis.window = {
    ChatGPTSaver: {
      AccessManager: {
        getAccessMode: () => mode
      }
    }
  };
}

describe('FeatureQuotaManager', () => {
  beforeEach(() => {
    setAccessMode('free');
    FeatureQuotaManager._state = null;
    FeatureQuotaManager._memStore = {};
  });

  it('uses default free quotas and decrements markdown/pdf permanently', async () => {
    await FeatureQuotaManager.init();
    let snapshot = await FeatureQuotaManager.getSnapshot(0);
    expect(snapshot.export.md.remaining).toBe(20);
    expect(snapshot.export.pdf.remaining).toBe(20);

    const r1 = await FeatureQuotaManager.consume('export-md', 1);
    const r2 = await FeatureQuotaManager.consume('export-pdf', 1);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    snapshot = await FeatureQuotaManager.getSnapshot(0);
    expect(snapshot.export.md.remaining).toBe(19);
    expect(snapshot.export.pdf.remaining).toBe(19);
  });

  it('blocks when export quota is exhausted', async () => {
    await FeatureQuotaManager.init();
    for (let i = 0; i < 20; i++) {
      const r = await FeatureQuotaManager.consume('export-md', 1);
      expect(r.success).toBe(true);
    }
    const blocked = await FeatureQuotaManager.consume('export-md', 1);
    expect(blocked.success).toBe(false);
    expect(String(blocked.message)).toContain('Markdown');
  });

  it('resets monthly quotas on natural-month rollover but keeps permanent export counters', async () => {
    await FeatureQuotaManager.init();
    await FeatureQuotaManager.consume('export-md', 1);
    await FeatureQuotaManager.consume('continuation', 5);
    await FeatureQuotaManager.consume('navigation', 12);

    FeatureQuotaManager._state.monthly.period = '2000-01';
    await FeatureQuotaManager._saveState();

    FeatureQuotaManager._state = null;
    await FeatureQuotaManager.init();
    const snapshot = await FeatureQuotaManager.getSnapshot(0);

    expect(snapshot.export.md.remaining).toBe(19);
    expect(snapshot.monthly.continuation.used).toBe(0);
    expect(snapshot.monthly.navigation.used).toBe(0);
  });

  it('bypasses quotas for card users', async () => {
    setAccessMode('card');
    await FeatureQuotaManager.init();
    const r = await FeatureQuotaManager.consume('export-md', 999);
    expect(r.success).toBe(true);
    expect(r.unlimited).toBe(true);

    const snapshot = await FeatureQuotaManager.getSnapshot(10);
    expect(snapshot.isCard).toBe(true);
    expect(snapshot.export.md.exhausted).toBe(false);
    expect(snapshot.template.allowed).toBe(true);
  });
});
