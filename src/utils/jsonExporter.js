/**
 * JSON 导出器 - 输出结构化 JSON，含自动摘要
 */

const SummaryGenerator = {
  /**
   * 根据对话长度生成摘要
   * @param {Array} messages - [{role, textContent}]
   * @returns {string}
   */
  generate(messages) {
    if (!messages || messages.length === 0) return '';

    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const total = messages.length;

    let selectedQuestions, selectedAnswers;

    if (total < 10) {
      selectedQuestions = userMessages;
      selectedAnswers = assistantMessages;
    } else if (total <= 30) {
      selectedQuestions = userMessages.slice(0, 3);
      selectedAnswers = assistantMessages.slice(-3);
    } else {
      selectedQuestions = userMessages.slice(0, 5);
      selectedAnswers = assistantMessages.slice(-5);
    }

    const parts = [];

    if (selectedQuestions.length > 0) {
      parts.push('## Key Questions');
      selectedQuestions.forEach((q, i) => {
        const text = (q.textContent || '').trim();
        if (text) parts.push(`${i + 1}. ${text}`);
      });
    }

    if (selectedAnswers.length > 0) {
      parts.push('');
      parts.push('## Recent Answers');
      selectedAnswers.forEach((a, i) => {
        const text = (a.textContent || '').trim();
        const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
        if (preview) parts.push(`${i + 1}. ${preview}`);
      });
    }

    return parts.join('\n');
  }
};

const JSONExporter = {
  /**
   * 导出对话为结构化 JSON 对象
   * @param {Object} conversation - Parser.parseConversation() 的输出
   * @returns {Object|null}
   */
  exportFromConversation(conversation) {
    if (!conversation || !conversation.messages || conversation.messages.length === 0) {
      return null;
    }

    const now = new Date().toISOString();

    const messages = conversation.messages.map((msg, index) => ({
      index,
      role: msg.role || 'unknown',
      content: msg.content || '',
      textContent: msg.textContent || '',
      timestamp: now
    }));

    return {
      title: conversation.title || '',
      workspace: conversation.workspace || '',
      createdAt: now,
      url: conversation.url || '',
      messageCount: messages.length,
      summary: SummaryGenerator.generate(conversation.messages),
      messages
    };
  },

  /**
   * 从浏览器环境导出（依赖 ChatGPTSaver.Parser）
   * @returns {Object|null}
   */
  export() {
    const parser = window.ChatGPTSaver.Parser;
    const conversation = parser.parseConversation();
    const workspaceName = parser.getWorkspaceName();

    const data = this.exportFromConversation({
      ...conversation,
      workspace: workspaceName
    });

    return data;
  },

  /**
   * 序列化为格式化 JSON 字符串
   * @param {Object} data
   * @returns {string}
   */
  serialize(data) {
    return JSON.stringify(data, null, 2);
  },

  /**
   * 反序列化 JSON 字符串
   * @param {string} jsonString
   * @returns {Object}
   */
  deserialize(jsonString) {
    return JSON.parse(jsonString);
  }
};

// 导出到浏览器全局（content script 环境）
if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.JSONExporter = JSONExporter;
  window.ChatGPTSaver.SummaryGenerator = SummaryGenerator;
}

// 导出到 Node.js（测试环境）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JSONExporter, SummaryGenerator };
}
