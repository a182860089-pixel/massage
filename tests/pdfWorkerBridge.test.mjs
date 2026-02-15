import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadBridge(context) {
  const code = fs.readFileSync(path.resolve('src/pdf-v2/workerBridge.js'), 'utf8');
  vm.runInContext(code, context, { filename: 'workerBridge.js' });
  return context.window.ChatGPTSaver.PDFWorkerBridge;
}

describe('PDF v2 worker bridge', () => {
  it('resolves successful worker render result', async () => {
    class FakeWorker {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }

      postMessage(message) {
        setTimeout(() => {
          this.onmessage?.({
            data: {
              type: 'progress',
              requestId: message.requestId,
              payload: { stage: 'layout', current: 1, total: 1, message: 'ok' }
            }
          });
          const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
          this.onmessage?.({
            data: {
              type: 'result',
              requestId: message.requestId,
              payload: { buffer, mimeType: 'application/pdf' }
            }
          });
        }, 0);
      }

      terminate() {}
    }

    const context = vm.createContext({
      Worker: FakeWorker,
      Blob,
      setTimeout,
      clearTimeout,
      console,
      window: {
        ChatGPTSaver: {},
      },
      chrome: {
        runtime: {
          getURL: () => 'chrome-extension://id/dist/pdfRender.worker.js'
        }
      }
    });
    context.globalThis = context;

    const bridge = loadBridge(context);
    const progress = [];
    const result = await bridge.exportWithWorker(
      {
        version: 'v2',
        title: 'demo',
        messages: []
      },
      {
        onProgress: (payload) => progress.push(payload)
      }
    );

    expect(result.success).toBe(true);
    expect(result.blob instanceof Blob).toBe(true);
    expect(result.blob.size).toBe(4);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('can cancel active task', async () => {
    class SlowWorker {
      constructor() {
        this.onmessage = null;
      }

      postMessage() {}
      terminate() {}
    }

    const context = vm.createContext({
      Worker: SlowWorker,
      Blob,
      setTimeout,
      clearTimeout,
      console,
      window: { ChatGPTSaver: {} },
      chrome: {
        runtime: { getURL: () => 'chrome-extension://id/dist/pdfRender.worker.js' }
      }
    });
    context.globalThis = context;

    const bridge = loadBridge(context);
    const pending = bridge.exportWithWorker({ version: 'v2', title: 'x', messages: [] }, { timeoutMs: 5000 });
    bridge.cancelCurrentTask('manual cancel');
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('CANCELLED');
  });
});
