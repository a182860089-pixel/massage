(function () {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 180000;

function createError(code, message) {
  return { code, message: String(message || 'unknown error') };
}

function normalizeArrayBuffer(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const start = value.byteOffset || 0;
    const end = start + value.byteLength;
    return value.buffer.slice(start, end);
  }
  return null;
}

  const PDFWorkerBridge = {
    _activeTask: null,
    _taskIdSeed: 0,

    isSupported() {
      return typeof Worker !== 'undefined' && !!globalThis.chrome?.runtime?.getURL;
    },

    _nextTaskId() {
      this._taskIdSeed += 1;
      return `pdf_v2_${Date.now()}_${this._taskIdSeed}`;
    },

    async _createWorker() {
      const workerUrl = chrome.runtime.getURL('dist/pdfRender.worker.js');
      const workerName = 'chatgpt-saver-pdf-v2';

      // 优先直接加载（某些环境可行）
      try {
        const directWorker = new Worker(workerUrl, { name: workerName });
        return { worker: directWorker, objectUrl: null };
      } catch (error) {
        // 在 chatgpt.com 这类页面常见 SecurityError：extension URL 不能直接作为 worker 脚本
      }

      // 回退：读取扩展内脚本文本 -> Blob URL，同源到页面上下文后再创建 worker
      const response = await fetch(workerUrl);
      if (!response.ok) {
        throw new Error(`load worker script failed: ${response.status} ${response.statusText}`);
      }
      const source = await response.text();
      if (!source || source.length < 20) {
        throw new Error('worker script is empty');
      }
      const blob = new Blob([source], { type: 'text/javascript' });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const blobWorker = new Worker(objectUrl, { name: workerName });
        return { worker: blobWorker, objectUrl };
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      }
    },

    cancelCurrentTask(reason = 'cancelled') {
      if (!this._activeTask) return;
      const task = this._activeTask;
      this._activeTask = null;
      if (typeof task.cancel === 'function') {
        task.cancel(reason);
        return;
      }
      if (task.timeoutId) clearTimeout(task.timeoutId);
      try {
        task.worker?.terminate();
      } catch (e) {
        // ignore
      }
      task.resolve?.({
        success: false,
        error: createError('CANCELLED', reason)
      });
    },

    async exportWithWorker(request, options = {}) {
      if (!this.isSupported()) {
        return {
          success: false,
          error: createError('UNSUPPORTED', 'Web Worker is unavailable in current environment')
        };
      }

      // 同时只跑一个导出任务，避免并发吃满内存
      if (this._activeTask) {
        this.cancelCurrentTask('replaced by a new export task');
      }

      const requestId = this._nextTaskId();
      const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
      const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

      return new Promise((resolve) => {
        let settled = false;
        let workerPackage = null;
        let worker = null;

        const finish = (result) => {
          if (settled) return;
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);
          try {
            if (worker) worker.terminate();
          } catch (e) {
            // ignore
          }
          if (workerPackage?.objectUrl) {
            try {
              URL.revokeObjectURL(workerPackage.objectUrl);
            } catch (e) {
              // ignore
            }
          }
          if (this._activeTask?.requestId === requestId) this._activeTask = null;
          resolve(result);
        };

        const timeoutId = setTimeout(() => {
          finish({
            success: false,
            error: createError('TIMEOUT', `PDF worker timed out after ${timeoutMs}ms`)
          });
        }, timeoutMs);

        // 先注册可取消占位任务，确保 worker 初始化阶段也可立即取消
        this._activeTask = {
          requestId,
          worker: null,
          timeoutId,
          resolve: finish,
          cancel: (reason) => {
            finish({
              success: false,
              error: createError('CANCELLED', reason || 'cancelled')
            });
          }
        };

        (async () => {
          try {
            workerPackage = await this._createWorker();
            worker = workerPackage.worker;
            if (settled) return;

            if (this._activeTask?.requestId === requestId) {
              this._activeTask.worker = worker;
            }

            worker.onmessage = (event) => {
              const data = event?.data || {};
              if (data.requestId !== requestId) return;

              if (data.type === 'progress') {
                onProgress(data.payload || {});
                return;
              }

              if (data.type === 'result') {
                try {
                  const payload = data.payload || {};
                  const buffer = normalizeArrayBuffer(payload.buffer);
                  if (!buffer) {
                    finish({
                      success: false,
                      error: createError('INVALID_RESULT', 'worker returned invalid pdf buffer')
                    });
                    return;
                  }
                  const blob = new Blob([buffer], { type: payload.mimeType || 'application/pdf' });
                  finish({
                    success: true,
                    blob
                  });
                } catch (error) {
                  finish({
                    success: false,
                    error: createError('RESULT_PARSE_FAILED', error?.message || error)
                  });
                }
                return;
              }

              if (data.type === 'error') {
                const err = data.error || {};
                finish({
                  success: false,
                  error: createError(err.code || 'WORKER_ERROR', err.message || 'pdf render worker failed')
                });
              }
            };

            worker.onerror = (error) => {
              finish({
                success: false,
                error: createError('WORKER_RUNTIME_ERROR', error?.message || 'worker runtime error')
              });
            };

            worker.postMessage({
              type: 'render',
              requestId,
              payload: request
            });
          } catch (error) {
            finish({
              success: false,
              error: createError('WORKER_INIT_FAILED', error?.message || error)
            });
          }
        })();
      });
    }
  };

  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.PDFWorkerBridge = PDFWorkerBridge;
})();
