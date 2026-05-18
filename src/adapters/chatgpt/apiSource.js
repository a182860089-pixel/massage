/**
 * ChatGPT 后端 API 数据源：分页拉取全部对话列表 + 拿单条对话详情。
 *
 * 端点（chatgpt.com 域名内同源 fetch，自带 cookie）：
 *   GET /api/auth/session                      → { accessToken }
 *   GET /backend-api/conversations?offset=..&limit=100&order=updated
 *   GET /backend-api/conversation/{id}         → 对话详情 mapping 树
 *
 * 注意：本模块只在 ChatGPT 域名下运行（content script context），不能跑在
 * background SW 也不能跨域。
 *
 * 输出：每个 conversation 转成统一 ConversationModel。
 */

const ChatGPTApiSource = {
  _accessToken: null,
  _accessTokenExpireAt: 0,

  /**
   * 拿 accessToken；缓存 50 分钟（实际 token 寿命 ~60min）。
   */
  async getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && this._accessToken && Date.now() < this._accessTokenExpireAt) {
      return this._accessToken;
    }
    const resp = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) throw new Error(`session HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json?.accessToken) throw new Error('no_access_token');
    this._accessToken = json.accessToken;
    this._accessTokenExpireAt = Date.now() + 50 * 60 * 1000;
    return this._accessToken;
  },

  /**
   * 列出全部对话（async generator），按 update_time 倒序。
   *
   *   for await (const item of api.listAll({pageSize:100})) { ... }
   *
   * 每条 item 形如：{id, title, create_time, update_time}
   */
  async *listAll({ pageSize = 100, order = 'updated', maxItems = Infinity, abortSignal } = {}) {
    let offset = 0;
    let yielded = 0;
    while (yielded < maxItems) {
      if (abortSignal?.aborted) return;
      const limit = Math.min(pageSize, 100);
      const token = await this.getAccessToken();
      const url = `/backend-api/conversations?offset=${offset}&limit=${limit}&order=${encodeURIComponent(order)}`;
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        signal: abortSignal
      });
      if (resp.status === 401) {
        // token 过期重试一次
        await this.getAccessToken({ forceRefresh: true });
        continue;
      }
      if (!resp.ok) throw new Error(`conversations HTTP ${resp.status}`);
      const data = await resp.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) return;
      for (const it of items) {
        if (yielded >= maxItems) return;
        yield it;
        yielded += 1;
      }
      if (items.length < limit) return;
      offset += limit;
    }
  },

  /**
   * 一次性列全部（数组形式），仅在量小或无须流式时用。
   */
  async listAllArray(options = {}) {
    const out = [];
    for await (const it of this.listAll(options)) out.push(it);
    return out;
  },

  /**
   * 取单条详情，并直接转成 ConversationModel。
   */
  async fetchConversationAsModel(id, { abortSignal } = {}) {
    if (!id) throw new Error('id required');
    const token = await this.getAccessToken();
    const resp = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      signal: abortSignal
    });
    if (resp.status === 401) {
      await this.getAccessToken({ forceRefresh: true });
      return this.fetchConversationAsModel(id, { abortSignal });
    }
    if (!resp.ok) throw new Error(`conversation HTTP ${resp.status}`);
    const tree = await resp.json();
    return apiTreeToModel(tree);
  }
};

/**
 * ChatGPT 后端 API 返回的对话树 → ConversationModel。
 *
 * 后端返回结构：
 *   {
 *     conversation_id: "xxx",
 *     title: "xxx",
 *     create_time, update_time,
 *     current_node: "<leafNodeId>",   // 当前激活分支的叶子
 *     mapping: {
 *       [nodeId]: { id, parent, children:[id...], message: {...} | null }
 *     }
 *   }
 *
 * 走主分支（current_node 一路向上回溯 parent）拿到一条线性 message 序列。
 */
function apiTreeToModel(tree) {
  const Model = (typeof window !== 'undefined' && window.ChatGPTSaver?.ConversationModel) ||
    (typeof require === 'function' ? (function () { try { return require('../../core/model.js').ConversationModel; } catch (_) { return null; } })() : null);
  if (!Model) return null;
  if (!tree || typeof tree !== 'object') return null;

  const mapping = tree.mapping || {};
  const currentNode = tree.current_node || findLeafFromMapping(mapping);
  const pathIds = currentNode ? walkUpToRoot(mapping, currentNode) : [];
  const messages = [];
  pathIds.forEach((nodeId) => {
    const node = mapping[nodeId];
    const msg = node?.message;
    if (!msg) return;
    const role = Model.normalizeRole(msg.author?.role || 'assistant');
    if (role === 'system') return;
    const blocks = apiMessageToBlocks(msg, role, Model);
    if (blocks.length) messages.push({ role, id: nodeId, blocks });
  });

  return Model.normalizeConversation({
    platform: Model.PLATFORM.CHATGPT,
    id: tree.conversation_id || '',
    title: tree.title || '',
    url: tree.conversation_id ? `https://chatgpt.com/c/${tree.conversation_id}` : '',
    timestamp: tree.update_time
      ? new Date((tree.update_time * 1000) | 0).toISOString()
      : new Date().toISOString(),
    messages
  }, { platform: Model.PLATFORM.CHATGPT });
}

function walkUpToRoot(mapping, leafId) {
  const path = [];
  let cur = leafId;
  const seen = new Set();
  while (cur && mapping[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = mapping[cur].parent;
  }
  return path.reverse();
}

function findLeafFromMapping(mapping) {
  // 兜底：找一个没有 children 的节点
  for (const id of Object.keys(mapping)) {
    const node = mapping[id];
    if (!node) continue;
    if (!Array.isArray(node.children) || node.children.length === 0) return id;
  }
  return null;
}

/**
 * 单条 API message → Block[]
 *
 * API message.content 结构常见：
 *   { content_type: 'text',          parts: [str, str, ...] }
 *   { content_type: 'code',          language, text }
 *   { content_type: 'thoughts',      thoughts: [{summary, content}] }
 *   { content_type: 'multimodal_text', parts: [str | {asset_pointer, content_type:'image_asset_pointer', ...}] }
 *   { content_type: 'system_error' / 'user_editable_context' ... }
 *   recipient/metadata 提示 tool 调用：metadata.search_result_groups / metadata.canvas / metadata.deep_research
 */
function apiMessageToBlocks(msg, role, Model) {
  const blocks = [];
  const content = msg.content || {};
  const ct = content.content_type;

  if (ct === 'thoughts' && Array.isArray(content.thoughts)) {
    content.thoughts.forEach((t) => {
      blocks.push(Model.makeThoughtBlock({
        role,
        summary: String(t.summary || 'Thoughts').trim(),
        detailsText: String(t.content || '').trim(),
        detailsHtml: ''
      }));
    });
  } else if (ct === 'code') {
    blocks.push(Model.makeCodeBlock({
      role,
      lang: String(content.language || '').trim(),
      code: String(content.text || '')
    }));
  } else if (ct === 'multimodal_text' && Array.isArray(content.parts)) {
    content.parts.forEach((p) => {
      if (typeof p === 'string') {
        if (p.trim()) blocks.push(Model.makeTextBlock({ role, text: p, html: textToHtml(p) }));
      } else if (p && typeof p === 'object') {
        if (p.content_type === 'image_asset_pointer' || p.asset_pointer) {
          blocks.push(Model.makeImageBlock({
            role,
            url: p.asset_pointer || '',
            alt: p.metadata?.dalle?.prompt || p.metadata?.image_caption || 'image'
          }));
        } else if (p.text) {
          blocks.push(Model.makeTextBlock({ role, text: String(p.text), html: textToHtml(String(p.text)) }));
        }
      }
    });
  } else if (ct === 'text' || ct === 'tether_quote' || ct === 'tether_browsing_display' || !ct) {
    const parts = Array.isArray(content.parts) ? content.parts : (typeof content.text === 'string' ? [content.text] : []);
    parts.forEach((p) => {
      const text = (typeof p === 'string') ? p : (p?.text || '');
      if (text && text.trim()) {
        blocks.push(Model.makeTextBlock({ role, text, html: textToHtml(text) }));
      }
    });
  }

  // metadata 里的 Web Search citations
  const meta = msg.metadata || {};
  const searchGroups = meta.search_result_groups || meta.citations;
  if (Array.isArray(searchGroups) && searchGroups.length) {
    const sources = [];
    const queries = [];
    searchGroups.forEach((g) => {
      if (Array.isArray(g.queries)) queries.push(...g.queries.map(String));
      const entries = g.entries || g.results || g;
      if (Array.isArray(entries)) {
        entries.forEach((e) => {
          if (e?.url) sources.push({ title: String(e.title || e.url), url: String(e.url), snippet: String(e.snippet || '') });
        });
      }
    });
    if (sources.length || queries.length) {
      blocks.push(Model.makeWebSearchBlock({ role, queries, sources }));
    }
  }

  // metadata 里的 Canvas
  if (meta.canvas && (meta.canvas.title || meta.canvas.content)) {
    blocks.push(Model.makeCanvasBlock({
      role,
      canvasId: String(meta.canvas.id || ''),
      title: String(meta.canvas.title || ''),
      lang: String(meta.canvas.language || ''),
      content: String(meta.canvas.content || '')
    }));
  }

  return blocks;
}

function textToHtml(text) {
  const safe = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<p>' + safe.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChatGPTApiSource, apiTreeToModel, apiMessageToBlocks };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.ChatGPTApiSource = ChatGPTApiSource;
  window.ChatGPTSaver.ChatGPTApiTreeToModel = apiTreeToModel;
}
