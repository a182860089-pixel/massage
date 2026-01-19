/**
 * PDF 导出器 - 使用 html2canvas 支持中文，正确处理分页
 */

const PDFExporter = {
  // 最大重试次数
  maxRetries: 2,
  
  /**
   * 检查 PDF 导出是否可用
   */
  isAvailable() {
    return typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined';
  },
  
  /**
   * 获取不可用的原因
   */
  getUnavailableReason() {
    if (typeof html2canvas === 'undefined') {
      return 'html2canvas 库未加载';
    }
    if (typeof jspdf === 'undefined') {
      return 'jsPDF 库未加载';
    }
    return null;
  },
  
  /**
   * 导出对话为 PDF
   */
  async export() {
    if (!this.isAvailable()) {
      const reason = this.getUnavailableReason();
      console.error('PDF 导出不可用:', reason);
      return null;
    }
    
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    
    if (!conversation.messages.length) {
      console.log('没有消息可导出');
      return null;
    }
    
    try {
      const { jsPDF } = jspdf;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 15;
      const headerHeight = 12;
      const footerHeight = 12;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;
      
      // 创建临时容器
      const container = this.createPDFContainer(conversation, contentWidth);
      document.body.appendChild(container);
      
      // 等待渲染
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 使用 html2canvas 渲染
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: container.offsetWidth,
        height: container.offsetHeight
      });
      
      // 移除临时容器
      document.body.removeChild(container);
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
      // 计算图片在 PDF 中的尺寸
      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      // 计算需要多少页
      const totalPages = Math.ceil(imgHeight / contentHeight);
      
      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }
        
        // 添加页眉
        this.addHeader(pdf, conversation.title, page + 1, pageWidth, margin);
        
        // 计算当前页的图片裁剪位置
        const sourceY = page * contentHeight * (canvas.height / imgHeight);
        const sourceHeight = Math.min(
          contentHeight * (canvas.height / imgHeight),
          canvas.height - sourceY
        );
        
        // 创建当前页的画布
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceHeight;
        
        const ctx = pageCanvas.getContext('2d');
        ctx.drawImage(
          canvas,
          0, sourceY,
          canvas.width, sourceHeight,
          0, 0,
          canvas.width, sourceHeight
        );
        
        const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95);
        const pageImgHeight = (sourceHeight * imgWidth) / canvas.width;
        
        // 添加图片到 PDF
        pdf.addImage(
          pageImgData,
          'JPEG',
          margin,
          margin + headerHeight,
          imgWidth,
          pageImgHeight
        );
        
        // 添加页脚
        this.addFooter(pdf, page + 1, totalPages, pageWidth, pageHeight, margin);
      }
      
      return pdf.output('blob');
    } catch (error) {
      console.error('PDF 生成失败:', error);
      // 尝试清理临时容器
      const container = document.getElementById('pdf-export-container');
      if (container) {
        try { document.body.removeChild(container); } catch (e) {}
      }
      return null;
    }
  },
  
  /**
   * 带重试的导出（更稳定）
   */
  async exportWithRetry(retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await this.export();
        if (result) return result;
        
        // 如果返回 null 但没有报错，等待后重试
        if (i < retries) {
          console.log(`PDF 导出返回空，等待 ${500 * (i + 1)}ms 后重试...`);
          await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
      } catch (error) {
        console.error(`PDF 导出第 ${i + 1} 次尝试失败:`, error);
        if (i < retries) {
          await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
      }
    }
    return null;
  },
  
  /**
   * 创建 PDF 内容容器
   */
  createPDFContainer(conversation, widthMM) {
    // 将 mm 转换为像素 (假设 96 DPI)
    const widthPx = widthMM * 3.78;
    
    const container = document.createElement('div');
    container.id = 'pdf-export-container';
    container.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      width: ${widthPx}px;
      background: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', 'Segoe UI', sans-serif;
      padding: 20px;
      line-height: 1.6;
      font-size: 14px;
    `;
    
    // 添加标题
    const header = document.createElement('div');
    header.style.cssText = `
      text-align: center;
      margin-bottom: 20px;
      padding: 20px;
      background: linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%);
      border-radius: 10px;
      color: white;
    `;
    header.innerHTML = `
      <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600;">${this.escapeHtml(conversation.title)}</h1>
      <p style="margin: 0; font-size: 12px; opacity: 0.9;">
        导出时间: ${new Date().toLocaleString('zh-CN')} | 共 ${conversation.messages.length} 条消息
      </p>
    `;
    container.appendChild(header);
    
    // 添加消息
    conversation.messages.forEach((msg) => {
      const isUser = msg.role === 'user';
      const messageDiv = document.createElement('div');
      messageDiv.style.cssText = `
        margin: 15px 0;
        padding: 15px;
        border-radius: 8px;
        background: ${isUser ? '#f0fdf4' : '#f8fafc'};
        border-left: 4px solid ${isUser ? '#10a37f' : '#6366f1'};
      `;
      
      const roleLabel = isUser ? '👤 用户' : '🤖 ChatGPT';
      const roleColor = isUser ? '#10a37f' : '#6366f1';
      
      messageDiv.innerHTML = `
        <div style="font-weight: 600; color: ${roleColor}; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; font-size: 14px;">
          ${roleLabel}
        </div>
        <div style="color: #374151; font-size: 13px; line-height: 1.7; word-wrap: break-word;">
          ${this.formatContent(msg.content)}
        </div>
      `;
      
      container.appendChild(messageDiv);
    });
    
    return container;
  },
  
  /**
   * 格式化内容
   */
  formatContent(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // 处理代码块
    temp.querySelectorAll('pre').forEach(pre => {
      pre.style.cssText = `
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 12px;
        border-radius: 6px;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 12px;
        margin: 10px 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-x: auto;
      `;
    });
    
    // 处理行内代码
    temp.querySelectorAll('code').forEach(code => {
      if (code.parentElement.tagName !== 'PRE') {
        code.style.cssText = `
          background: #f3f4f6;
          padding: 2px 5px;
          border-radius: 3px;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 12px;
          color: #e11d48;
        `;
      }
    });
    
    // 移除按钮等
    temp.querySelectorAll('button, [class*="copy"], svg').forEach(el => el.remove());
    
    return temp.innerHTML;
  },
  
  /**
   * 添加页眉
   */
  addHeader(pdf, title, pageNum, pageWidth, margin) {
    pdf.setFontSize(9);
    pdf.setTextColor(130, 130, 130);
    
    // 左侧标题（使用安全文本）
    const safeTitle = this.toSafeText(title, 50);
    pdf.text(safeTitle, margin, 8);
    
    // 右侧日期
    pdf.text(new Date().toLocaleDateString('en-US'), pageWidth - margin - 20, 8);
    
    // 分隔线
    pdf.setDrawColor(230, 230, 230);
    pdf.line(margin, 10, pageWidth - margin, 10);
  },
  
  /**
   * 添加页脚
   */
  addFooter(pdf, currentPage, totalPages, pageWidth, pageHeight, margin) {
    const y = pageHeight - 8;
    
    // 分隔线
    pdf.setDrawColor(230, 230, 230);
    pdf.line(margin, y - 4, pageWidth - margin, y - 4);
    
    pdf.setFontSize(9);
    pdf.setTextColor(130, 130, 130);
    
    // 左侧来源
    pdf.text('ChatGPT Saver', margin, y);
    
    // 右侧页码
    pdf.text(`${currentPage} / ${totalPages}`, pageWidth - margin - 15, y);
  },
  
  /**
   * 转换为安全文本（仅用于页眉页脚）
   */
  toSafeText(text, maxLength) {
    if (!text) return 'ChatGPT';
    
    let safe = '';
    for (let i = 0; i < text.length && safe.length < maxLength; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) {
        safe += text[i];
      }
    }
    
    if (safe.trim().length === 0) {
      safe = 'ChatGPT';
    }
    
    return safe.trim() + (text.length > maxLength ? '...' : '');
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
window.ChatGPTSaver.PDFExporter = PDFExporter;
