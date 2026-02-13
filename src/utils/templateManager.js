/**
 * TemplateManager — Prompt 模板库管理
 * 支持模板 CRUD、变量提取与替换、JSON 序列化
 */

const TemplateManager = {
  _storageKey: 'promptTemplates',

  /**
   * 生成 UUID
   */
  _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  },

  /**
   * 获取所有模板
   * @returns {Promise<Array>}
   */
  async getAll() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      return new Promise((resolve) => {
        chrome.storage.local.get([this._storageKey], (r) => {
          resolve(r[this._storageKey] || []);
        });
      });
    }
    // Node.js fallback for testing
    return this._memStore || [];
  },

  /**
   * 保存所有模板到存储
   */
  async _saveAll(templates) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [this._storageKey]: templates }, resolve);
      });
    }
    this._memStore = templates;
  },

  /**
   * 保存新模板
   * @param {Object} template - { name, content }
   * @returns {Promise<Object>} 保存后的模板（含 id, createdAt, updatedAt）
   */
  async save(template) {
    const templates = await this.getAll();
    const now = new Date().toISOString();
    const newTemplate = {
      id: this._uuid(),
      name: template.name || '',
      content: template.content || '',
      createdAt: now,
      updatedAt: now
    };
    templates.push(newTemplate);
    await this._saveAll(templates);
    return newTemplate;
  },


  /**
   * 更新模板（保留 createdAt）
   * @param {string} id
   * @param {Object} changes - { name?, content? }
   * @returns {Promise<Object|null>}
   */
  async update(id, changes) {
    const templates = await this.getAll();
    const idx = templates.findIndex(t => t.id === id);
    if (idx < 0) return null;
    const template = templates[idx];
    if (changes.name !== undefined) template.name = changes.name;
    if (changes.content !== undefined) template.content = changes.content;
    template.updatedAt = new Date().toISOString();
    // createdAt is preserved — not modified
    templates[idx] = template;
    await this._saveAll(templates);
    return template;
  },

  /**
   * 删除模板
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    const templates = await this.getAll();
    const filtered = templates.filter(t => t.id !== id);
    if (filtered.length === templates.length) return false;
    await this._saveAll(filtered);
    return true;
  },

  /**
   * 提取模板中的变量占位符 {{variable_name}}
   * @param {string} content
   * @returns {string[]} 唯一变量名数组
   */
  extractVariables(content) {
    if (!content) return [];
    const regex = /\{\{(\w+)\}\}/g;
    const vars = new Set();
    let match;
    while ((match = regex.exec(content)) !== null) {
      vars.add(match[1]);
    }
    return Array.from(vars);
  },

  /**
   * 替换模板中的变量
   * @param {string} content - 模板内容
   * @param {Object} variables - { varName: value }
   * @returns {string}
   */
  applyTemplate(content, variables) {
    if (!content) return '';
    return content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables.hasOwnProperty(varName) ? variables[varName] : match;
    });
  },

  /**
   * 序列化为 JSON（2-space 缩进）
   */
  serialize(data) {
    return JSON.stringify(data, null, 2);
  },

  /**
   * 反序列化 JSON
   */
  deserialize(json) {
    return JSON.parse(json);
  }
};

// Export for both browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TemplateManager };
} else {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.TemplateManager = TemplateManager;
}
