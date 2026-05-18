#!/usr/bin/env node

/**
 * Live test for:
 * GET /api/plugin/card-keys/client-config
 *
 * Usage:
 *   node scripts/test-client-config-api.mjs
 *   node scripts/test-client-config-api.mjs --base https://seat.20050225.xyz
 *   node scripts/test-client-config-api.mjs --url https://seat.20050225.xyz/api/plugin/card-keys/client-config
 */

const DEFAULT_BASE_URL = 'https://seat.20050225.xyz';
const DEFAULT_PATH = '/api/plugin/card-keys/client-config';
const DEFAULT_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE_URL, url: '', timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--base' && next) {
      args.base = next;
      i += 1;
      continue;
    }
    if (token === '--url' && next) {
      args.url = next;
      i += 1;
      continue;
    }
    if (token === '--timeout' && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) args.timeoutMs = n;
      i += 1;
    }
  }
  return args;
}

function ensureString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`字段 ${fieldName} 必须是字符串，实际为 ${typeof value}`);
  }
}

function validateDataPayload(data, prefix = 'data') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`字段 ${prefix} 必须是对象`);
  }
  ensureString(data.plugin_announcement_md, `${prefix}.plugin_announcement_md`);
  ensureString(data.plugin_upgrade_url, `${prefix}.plugin_upgrade_url`);
  ensureString(data.updated_at, `${prefix}.updated_at`);
}

function validateResponseShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('响应 JSON 必须是对象');
  }
  if (typeof payload.success !== 'boolean') {
    throw new Error('字段 success 必须是布尔值');
  }

  if (payload.success === true) {
    validateDataPayload(payload.data);
    return { ok: true, businessSuccess: true };
  }

  ensureString(payload.message, 'message');
  validateDataPayload(payload.data);
  return { ok: true, businessSuccess: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = args.url || `${String(args.base || '').replace(/\/+$/, '')}${DEFAULT_PATH}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);

  console.log(`[test] GET ${endpoint}`);
  console.log('[test] Header: Accept: application/json');
  console.log('[test] Body: <none>');

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    const rawText = await response.text();
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(`响应不是合法 JSON。HTTP=${response.status} Body=${rawText.slice(0, 300)}`);
    }

    validateResponseShape(payload);

    console.log(`[test] HTTP status: ${response.status}`);
    console.log(`[test] success: ${payload.success}`);
    console.log(`[test] updated_at: ${payload?.data?.updated_at || ''}`);

    if (payload.success === true) {
      console.log('[result] PASS: 接口请求成功，且返回结构符合约定');
      return;
    }

    console.error(`[result] FAIL: 接口已响应，但业务失败 -> ${payload.message}`);
    process.exitCode = 2;
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `请求超时（>${args.timeoutMs}ms）`
      : (error?.message || String(error));
    console.error(`[result] FAIL: ${message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

main();

