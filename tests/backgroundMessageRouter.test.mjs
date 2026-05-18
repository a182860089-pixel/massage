/**
 * background.js 中的卡密接口转发器 + 客户端配置获取的隔离测试。
 *
 * 直接 import ESM 入口会触发 chrome.* 全局副作用（onInstalled / alarms 注册），
 * 所以这里用文件级 string + new Function 的方式抽取 handlePluginCardKeyRequest
 * 与 handlePluginGetClientConfig 两个纯函数做单测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bgPath = path.resolve(__dirname, '..', 'src', 'background', 'background.js');
const source = readFileSync(bgPath, 'utf8');

function extract(name) {
  // 简单状态机：找到 `async function name(` 起，跟踪括号配平到函数末尾
  const startMarker = `async function ${name}(`;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`cannot find ${startMarker}`);
  let i = source.indexOf('{', startIdx);
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error(`cannot find end of ${name}`);
}

const handlePluginCardKeyRequestSrc = extract('handlePluginCardKeyRequest');
const fetchClientConfigFromApiSrc = extract('fetchClientConfigFromApi');
const handlePluginGetClientConfigSrc = extract('handlePluginGetClientConfig');

const moduleCode = `
  'use strict';
  ${fetchClientConfigFromApiSrc}
  ${handlePluginCardKeyRequestSrc}
  ${handlePluginGetClientConfigSrc}
  return { handlePluginCardKeyRequest, handlePluginGetClientConfig, fetchClientConfigFromApi };
`;

function loadBgFns({ fetchImpl, clientConfigCache, baseApiUrl = 'https://seat.20050225.xyz', clientConfigUrl = 'https://seat.20050225.xyz/api/plugin/card-keys/client-config' }) {
  const fn = new Function(
    'fetch',
    'BASE_API_URL',
    'CLIENT_CONFIG_URL',
    'clientConfigCache',
    moduleCode
  );
  return fn(fetchImpl, baseApiUrl, clientConfigUrl, clientConfigCache);
}

beforeEach(() => {
  // nothing
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handlePluginCardKeyRequest', () => {
  it('forwards card_key/email/client_id and passes through JSON response', async () => {
    const respJson = {
      success: true,
      message: 'ok',
      data: { authorized: true, card_type: 'unlimited' }
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => respJson
    }));
    const { handlePluginCardKeyRequest } = loadBgFns({ fetchImpl });

    const sendResponse = vi.fn();
    await handlePluginCardKeyRequest(
      '/api/plugin/card-keys/activate',
      { card_key: 'K', email: 'a@b.com', client_id: 'cid' },
      sendResponse
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://seat.20050225.xyz/api/plugin/card-keys/activate');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ card_key: 'K', email: 'a@b.com', client_id: 'cid' });
    expect(sendResponse).toHaveBeenCalledWith(respJson);
  });

  it('wraps fetch exception into network_error response (post-fix: must include network_error:true so content keeps cache)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const { handlePluginCardKeyRequest } = loadBgFns({ fetchImpl });

    const sendResponse = vi.fn();
    await handlePluginCardKeyRequest(
      '/api/plugin/card-keys/status',
      { card_key: 'K', email: 'a@b.com', client_id: 'cid' },
      sendResponse
    );

    const arg = sendResponse.mock.calls[0][0];
    expect(arg.success).toBe(false);
    expect(arg.network_error).toBe(true);
    expect(arg.data?.authorized).toBe(false);
    expect(arg.message).toContain('网络错误');
  });

  it('treats non-2xx HTTP as network_error (do not let upstream HTTP 502 clear local cache)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({})
    }));
    const { handlePluginCardKeyRequest } = loadBgFns({ fetchImpl });

    const sendResponse = vi.fn();
    await handlePluginCardKeyRequest(
      '/api/plugin/card-keys/status',
      { card_key: 'K', email: 'a@b.com', client_id: 'cid' },
      sendResponse
    );

    const arg = sendResponse.mock.calls[0][0];
    expect(arg.success).toBe(false);
    expect(arg.network_error).toBe(true);
    expect(arg.message).toContain('HTTP 502');
  });
});

describe('handlePluginGetClientConfig', () => {
  it('when no cache provided, calls fetcher and returns network result', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { plugin_announcement_md: 'hi' } })
    }));
    const { handlePluginGetClientConfig } = loadBgFns({ fetchImpl, clientConfigCache: null });

    const sendResponse = vi.fn();
    await handlePluginGetClientConfig({}, sendResponse);

    const resp = sendResponse.mock.calls[0][0];
    expect(resp.success).toBe(true);
    expect(resp.source).toBe('network');
    expect(resp.data?.plugin_announcement_md).toBe('hi');
  });

  it('uses cache when provided; honors forceRefresh option', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { plugin_announcement_md: 'fresh' } })
    }));
    const cache = {
      fetchWithCache: vi.fn(async (fetcher, options) => {
        expect(typeof fetcher).toBe('function');
        return {
          success: true,
          data: { noticeMarkdown: options?.forceRefresh ? 'fresh' : 'cached' },
          stale: false,
          source: options?.forceRefresh ? 'network' : 'memory',
          fetchedAt: 1
        };
      })
    };
    const { handlePluginGetClientConfig } = loadBgFns({ fetchImpl, clientConfigCache: cache });

    const sendCached = vi.fn();
    await handlePluginGetClientConfig({ forceRefresh: false }, sendCached);
    expect(sendCached.mock.calls[0][0].source).toBe('memory');

    const sendRefreshed = vi.fn();
    await handlePluginGetClientConfig({ forceRefresh: true }, sendRefreshed);
    expect(sendRefreshed.mock.calls[0][0].source).toBe('network');
  });

  it('returns success:false when fetch fails and no cache available', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const { handlePluginGetClientConfig } = loadBgFns({ fetchImpl, clientConfigCache: null });

    const sendResponse = vi.fn();
    await handlePluginGetClientConfig({}, sendResponse);
    const resp = sendResponse.mock.calls[0][0];
    expect(resp.success).toBe(false);
    expect(resp.message).toContain('down');
  });
});
