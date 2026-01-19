/**
 * HTML 导出器 - 保留原始样式
 */

const HTMLExporter = {
  /**
   * 导出对话为 HTML
   */
  export() {
    const html = window.ChatGPTSaver.Parser.getConversationHTML();
    return html;
  },
  
  /**
   * 获取完整的 HTML 文档（带更多样式）
   */
  exportWithFullStyles() {
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    
    if (!conversation.messages.length) {
      return null;
    }
    
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(conversation.title)} - ChatGPT 对话记录</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif;
      line-height: 1.6;
      background: #f7f7f8;
      color: #374151;
    }
    
    .container {
      max-width: 850px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    
    /* 头部 */
    .chat-header {
      background: linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%);
      color: white;
      padding: 30px;
      border-radius: 16px;
      margin-bottom: 30px;
      box-shadow: 0 4px 20px rgba(16, 163, 127, 0.3);
    }
    
    .chat-header h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    
    .chat-header .meta {
      font-size: 14px;
      opacity: 0.9;
    }
    
    .chat-header .meta span {
      margin-right: 16px;
    }
    
    /* 消息容器 */
    .chat-content {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    /* 消息样式 */
    .message {
      background: white;
      border-radius: 12px;
      padding: 20px 24px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      position: relative;
    }
    
    .message.user {
      border-left: 4px solid #10a37f;
    }
    
    .message.assistant {
      border-left: 4px solid #6366f1;
    }
    
    .message .role {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid #f0f0f0;
    }
    
    .message.user .role {
      color: #10a37f;
    }
    
    .message.assistant .role {
      color: #6366f1;
    }
    
    .message .role .avatar {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    
    .message.user .role .avatar {
      background: #dcfce7;
    }
    
    .message.assistant .role .avatar {
      background: #e0e7ff;
    }
    
    /* 内容样式 */
    .message .content {
      font-size: 15px;
      line-height: 1.7;
    }
    
    .message .content p {
      margin-bottom: 12px;
    }
    
    .message .content p:last-child {
      margin-bottom: 0;
    }
    
    /* 代码块 */
    .message .content pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 16px 20px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 16px 0;
      font-size: 13px;
      line-height: 1.5;
    }
    
    .message .content pre code {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      background: transparent;
      padding: 0;
    }
    
    /* 行内代码 */
    .message .content :not(pre) > code {
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9em;
      color: #ef4444;
    }
    
    /* 列表 */
    .message .content ul,
    .message .content ol {
      margin: 12px 0;
      padding-left: 24px;
    }
    
    .message .content li {
      margin-bottom: 6px;
    }
    
    /* 引用 */
    .message .content blockquote {
      border-left: 4px solid #e5e7eb;
      margin: 16px 0;
      padding: 12px 16px;
      background: #f9fafb;
      border-radius: 0 8px 8px 0;
    }
    
    /* 表格 */
    .message .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    
    .message .content th,
    .message .content td {
      border: 1px solid #e5e7eb;
      padding: 10px 14px;
      text-align: left;
    }
    
    .message .content th {
      background: #f9fafb;
      font-weight: 600;
    }
    
    /* 链接 */
    .message .content a {
      color: #10a37f;
      text-decoration: none;
    }
    
    .message .content a:hover {
      text-decoration: underline;
    }
    
    /* 图片 */
    .message .content img {
      max-width: 100%;
      border-radius: 8px;
      margin: 12px 0;
    }
    
    /* 页脚 */
    .chat-footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      color: #9ca3af;
      font-size: 13px;
    }
    
    /* 代码高亮 */
    .hljs-keyword { color: #569cd6; }
    .hljs-string { color: #ce9178; }
    .hljs-number { color: #b5cea8; }
    .hljs-comment { color: #6a9955; }
    .hljs-function { color: #dcdcaa; }
    .hljs-class { color: #4ec9b0; }
    .hljs-variable { color: #9cdcfe; }
    .hljs-operator { color: #d4d4d4; }
    
    /* 打印样式 */
    @media print {
      body {
        background: white;
      }
      
      .container {
        max-width: 100%;
        padding: 0;
      }
      
      .chat-header {
        box-shadow: none;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      
      .message {
        box-shadow: none;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="chat-header">
      <h1>${this.escapeHtml(conversation.title)}</h1>
      <div class="meta">
        <span>📅 导出时间: ${new Date().toLocaleString('zh-CN')}</span>
        <span>💬 共 ${conversation.messages.length} 条消息</span>
        ${conversation.isWorkspace ? '<span>🏢 工作区对话</span>' : ''}
      </div>
    </header>
    
    <div class="chat-content">
      ${conversation.messages.map(msg => `
        <div class="message ${msg.role}">
          <div class="role">
            <span class="avatar">${msg.role === 'user' ? '👤' : '🤖'}</span>
            <span>${msg.role === 'user' ? '用户' : 'ChatGPT'}</span>
          </div>
          <div class="content">${msg.content}</div>
        </div>
      `).join('')}
    </div>
    
    <footer class="chat-footer">
      <p>由 ChatGPT 对话保存助手导出 | ${window.location.href}</p>
    </footer>
  </div>
</body>
</html>`;
    
    return html;
  },
  
  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.HTMLExporter = HTMLExporter;
