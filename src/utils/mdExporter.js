/**
 * Markdown 导出器 - 使用 Turndown.js 将 HTML 转换为 Markdown
 */

const MarkdownExporter = {
  turndownService: null,
  
  /**
   * 初始化 Turndown 服务
   */
  init() {
    if (this.turndownService) {
      return;
    }
    
    // 检查 Turndown 是否已加载
    if (typeof TurndownService === 'undefined') {
      console.error('Turndown.js 未加载');
      return;
    }
    
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*'
    });
    
    // 添加自定义规则
    this.addCustomRules();
  },
  
  /**
   * 添加自定义转换规则
   */
  addCustomRules() {
    // 代码块处理
    this.turndownService.addRule('codeBlock', {
      filter: function(node) {
        return node.nodeName === 'PRE' && node.querySelector('code');
      },
      replacement: function(content, node) {
        const codeEl = node.querySelector('code');
        const code = codeEl.textContent;
        
        // 获取语言
        let language = '';
        const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
        if (langClass) {
          language = langClass.replace('language-', '');
        } else if (node.hasAttribute('data-language')) {
          language = node.getAttribute('data-language');
        }
        
        return '\n\n```' + language + '\n' + code + '\n```\n\n';
      }
    });
    
    // 行内代码处理
    this.turndownService.addRule('inlineCode', {
      filter: function(node) {
        return node.nodeName === 'CODE' && 
               node.parentNode.nodeName !== 'PRE';
      },
      replacement: function(content, node) {
        return '`' + node.textContent + '`';
      }
    });
    
    // 图片处理
    this.turndownService.addRule('image', {
      filter: 'img',
      replacement: function(content, node) {
        const alt = node.getAttribute('alt') || '图片';
        const src = node.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
    });
    
    // 删除不需要的元素
    this.turndownService.addRule('removeButtons', {
      filter: function(node) {
        return node.nodeName === 'BUTTON' || 
               (node.classList && (
                 node.classList.contains('copy-button') ||
                 node.classList.contains('absolute')
               ));
      },
      replacement: function() {
        return '';
      }
    });
  },
  
  /**
   * 导出对话为 Markdown
   */
  export() {
    this.init();
    
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    
    if (!conversation.messages.length) {
      return null;
    }
    
    let markdown = '';
    
    // 添加标题
    markdown += `# ${conversation.title}\n\n`;
    
    // 添加元信息
    markdown += `> 📅 导出时间: ${new Date().toLocaleString('zh-CN')}  \n`;
    markdown += `> 💬 共 ${conversation.messages.length} 条消息  \n`;
    if (conversation.isWorkspace) {
      markdown += `> 🏢 工作区对话  \n`;
    }
    markdown += `> 🔗 来源: ${conversation.url}\n\n`;
    markdown += `---\n\n`;
    
    // 转换每条消息
    conversation.messages.forEach((msg, index) => {
      const roleLabel = msg.role === 'user' ? '## 👤 用户' : '## 🤖 ChatGPT';
      markdown += `${roleLabel}\n\n`;
      
      // 将 HTML 内容转换为 Markdown
      const msgContent = this.htmlToMarkdown(msg.content);
      markdown += msgContent;
      markdown += '\n\n';
      
      // 添加分隔线（除了最后一条消息）
      if (index < conversation.messages.length - 1) {
        markdown += `---\n\n`;
      }
    });
    
    // 添加页脚
    markdown += `\n---\n\n`;
    markdown += `*由 ChatGPT 对话保存助手导出*\n`;
    
    return markdown;
  },
  
  /**
   * HTML 转 Markdown
   */
  htmlToMarkdown(html) {
    if (!this.turndownService) {
      this.init();
    }
    
    if (!this.turndownService) {
      // 降级方案：简单的文本提取
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText;
    }
    
    try {
      // 创建临时 DOM 元素
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // 清理不需要的元素
      tempDiv.querySelectorAll('button, [class*="copy"]').forEach(el => el.remove());
      
      // 转换为 Markdown
      let markdown = this.turndownService.turndown(tempDiv);
      
      // 清理多余的空行
      markdown = markdown.replace(/\n{3,}/g, '\n\n');
      
      return markdown.trim();
    } catch (error) {
      console.error('Markdown 转换失败:', error);
      // 降级方案
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText;
    }
  },
  
  /**
   * 简单文本导出（无 Turndown 时的降级方案）
   */
  exportSimple() {
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    
    if (!conversation.messages.length) {
      return null;
    }
    
    let text = '';
    text += `# ${conversation.title}\n\n`;
    text += `导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
    text += `---\n\n`;
    
    conversation.messages.forEach(msg => {
      const roleLabel = msg.role === 'user' ? '## 用户' : '## ChatGPT';
      text += `${roleLabel}\n\n${msg.textContent}\n\n---\n\n`;
    });
    
    return text;
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.MarkdownExporter = MarkdownExporter;
