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
  },

  /**
   * 检测 canvas 分页处是否有空白断层
   */
  detectPageGaps(canvas, pageHeightPx) {
    if (!canvas || pageHeightPx <= 0) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const totalPages = Math.ceil(canvas.height / pageHeightPx);

    for (let page = 1; page < totalPages; page++) {
      const y = page * pageHeightPx;
      const scanStart = Math.max(0, y - 5);
      const scanEnd = Math.min(canvas.height, y + 5);
      const scanHeight = scanEnd - scanStart;
      if (scanHeight <= 0) continue;

      const imageData = ctx.getImageData(0, scanStart, canvas.width, scanHeight);
      const data = imageData.data;
      let allWhite = true;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
          allWhite = false;
          break;
        }
      }
      if (allWhite) return true;
    }
    return false;
  },

  /**
   * 按消息分段生成 canvas 并组合为 PDF
   */
  async exportSegmented() {
    if (!this.isAvailable()) return null;

    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    if (!conversation.messages.length) return null;

    try {
      const { jsPDF } = jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = 210, pageHeight = 297, margin = 15;
      const headerHeight = 12, footerHeight = 12;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;
      const widthPx = contentWidth * 3.78;

      let currentY = margin + headerHeight;
      let pageNum = 1;

      // 添加首页页眉
      this.addHeader(pdf, conversation.title, pageNum, pageWidth, margin);

      for (const msg of conversation.messages) {
        const container = document.createElement('div');
        container.style.cssText = `position:absolute;left:-9999px;top:0;width:${widthPx}px;background:white;font-family:-apple-system,sans-serif;padding:10px;font-size:14px;line-height:1.6;`;
        const isUser = msg.role === 'user';
        container.innerHTML = `<div style="padding:12px;border-radius:8px;background:${isUser ? '#f0fdf4' : '#f8fafc'};border-left:4px solid ${isUser ? '#10a37f' : '#6366f1'};margin:8px 0;"><div style="font-weight:600;color:${isUser ? '#10a37f' : '#6366f1'};margin-bottom:8px;font-size:14px;">${isUser ? '👤 用户' : '🤖 ChatGPT'}</div><div style="color:#374151;font-size:13px;line-height:1.7;">${this.formatContent(msg.content)}</div></div>`;
        document.body.appendChild(container);
        await new Promise(r => setTimeout(r, 50));

        const canvas = await html2canvas(container, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
        document.body.removeChild(container);

        const imgWidth = contentWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const remainingOnPage = pageHeight - margin - footerHeight - currentY;

        // 如果整个消息能放进当前页剩余空间
        if (imgHeight <= remainingOnPage) {
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, currentY, imgWidth, imgHeight);
          currentY += imgHeight + 2;
          continue;
        }

        // 消息比剩余空间大 — 分割到多页
        const pxPerMm = canvas.height / imgHeight;
        let sourceYPx = 0;

        while (sourceYPx < canvas.height) {
          const availableMm = pageHeight - margin - footerHeight - currentY;
          if (availableMm < 10) {
            this.addFooter(pdf, pageNum, 0, pageWidth, pageHeight, margin);
            pdf.addPage();
            pageNum++;
            currentY = margin + headerHeight;
            this.addHeader(pdf, conversation.title, pageNum, pageWidth, margin);
            continue;
          }

          const sliceHeightPx = Math.min(
            Math.round(availableMm * pxPerMm),
            canvas.height - sourceYPx
          );
          if (sliceHeightPx <= 0) break;

          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeightPx;
          sliceCanvas.getContext('2d').drawImage(
            canvas, 0, sourceYPx, canvas.width, sliceHeightPx,
            0, 0, canvas.width, sliceHeightPx
          );

          const sliceMmHeight = sliceHeightPx / pxPerMm;
          pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, currentY, imgWidth, sliceMmHeight);
          currentY += sliceMmHeight;
          sourceYPx += sliceHeightPx;

          if (sourceYPx < canvas.height) {
            this.addFooter(pdf, pageNum, 0, pageWidth, pageHeight, margin);
            pdf.addPage();
            pageNum++;
            currentY = margin + headerHeight;
            this.addHeader(pdf, conversation.title, pageNum, pageWidth, margin);
          }
        }

        currentY += 2;
      }

      this.addFooter(pdf, pageNum, pageNum, pageWidth, pageHeight, margin);
      return pdf.output('blob');
    } catch (e) {
      console.error('PDF 分段导出失败:', e);
      return null;
    }
  },

  /**
   * 计算批次分配：将 N 条消息按 batchSize 分批
   * 纯逻辑函数，可独立测试
   * @param {number} totalMessages - 消息总数
   * @param {number} batchSize - 每批消息数
   * @returns {Array<{start: number, end: number}>} 批次范围数组
   */
  computeBatches(totalMessages, batchSize) {
    if (totalMessages <= 0 || batchSize <= 0) return [];
    const batches = [];
    for (let i = 0; i < totalMessages; i += batchSize) {
      batches.push({ start: i, end: Math.min(i + batchSize, totalMessages) });
    }
    return batches;
  },

  /**
   * 渲染一批消息为 canvas
   * @param {Array} messages - 本批消息数组
   * @param {number} widthPx - 容器宽度（像素）
   * @returns {Promise<HTMLCanvasElement>}
   */
  async renderBatch(messages, widthPx) {
    const container = document.createElement('div');
    container.style.cssText = `position:absolute;left:-9999px;top:0;width:${widthPx}px;background:white;font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei','Segoe UI',sans-serif;padding:10px;font-size:14px;line-height:1.6;`;

    for (const msg of messages) {
      const isUser = msg.role === 'user';
      const msgDiv = document.createElement('div');
      msgDiv.style.cssText = `padding:12px;border-radius:8px;background:${isUser ? '#f0fdf4' : '#f8fafc'};border-left:4px solid ${isUser ? '#10a37f' : '#6366f1'};margin:8px 0;`;
      msgDiv.innerHTML = `<div style="font-weight:600;color:${isUser ? '#10a37f' : '#6366f1'};margin-bottom:8px;font-size:14px;">${isUser ? '👤 用户' : '🤖 ChatGPT'}</div><div style="color:#374151;font-size:13px;line-height:1.7;word-wrap:break-word;">${this.formatContent(msg.content)}</div>`;
      container.appendChild(msgDiv);
    }

    document.body.appendChild(container);
    await new Promise(r => setTimeout(r, 30));

    const canvas = await html2canvas(container, {
      scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff'
    });

    document.body.removeChild(container);
    return canvas;
  },

  /**
   * 将多个 canvas 组装为 PDF（支持单个 canvas 跨页分割）
   * @param {Array<HTMLCanvasElement>} canvases - canvas 数组
   * @param {string} title - 对话标题
   * @param {number} totalMessages - 消息总数
   * @returns {Blob}
   */
  assemblePDF(canvases, title, totalMessages) {
    const { jsPDF } = jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = 210, pageHeight = 297, margin = 15;
    const headerHeight = 12, footerHeight = 12;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;

    let currentY = margin + headerHeight;
    let pageNum = 1;

    // 添加标题页头
    this.addHeader(pdf, title, pageNum, pageWidth, margin);

    // 添加标题块
    const titleText = this.toSafeText(title, 60) || 'ChatGPT';
    pdf.setFontSize(14);
    pdf.setTextColor(16, 163, 127);
    pdf.text(titleText, margin, currentY + 5);
    pdf.setFontSize(9);
    pdf.setTextColor(130, 130, 130);
    pdf.text(`${new Date().toLocaleString('en-US')} | ${totalMessages} messages`, margin, currentY + 12);
    currentY += 20;

    for (const canvas of canvases) {
      if (!canvas) continue;
      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const remainingOnPage = pageHeight - margin - footerHeight - currentY;

      // 如果整个 canvas 能放进当前页剩余空间，直接放
      if (imgHeight <= remainingOnPage) {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, currentY, imgWidth, imgHeight);
        currentY += imgHeight + 2;
        continue;
      }

      // canvas 比剩余空间大 — 需要分割渲染到多页
      // 像素/毫米 比率
      const pxPerMm = canvas.height / imgHeight;
      let sourceYPx = 0; // 当前在 canvas 中的像素偏移

      while (sourceYPx < canvas.height) {
        const availableMm = pageHeight - margin - footerHeight - currentY;
        if (availableMm < 10) {
          // 剩余空间太小，直接换页
          this.addFooter(pdf, pageNum, 0, pageWidth, pageHeight, margin);
          pdf.addPage();
          pageNum++;
          currentY = margin + headerHeight;
          this.addHeader(pdf, title, pageNum, pageWidth, margin);
          continue;
        }

        const sliceHeightPx = Math.min(
          Math.round(availableMm * pxPerMm),
          canvas.height - sourceYPx
        );
        if (sliceHeightPx <= 0) break;

        // 创建切片 canvas
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        ctx.drawImage(
          canvas,
          0, sourceYPx, canvas.width, sliceHeightPx,
          0, 0, canvas.width, sliceHeightPx
        );

        const sliceMmHeight = sliceHeightPx / pxPerMm;
        pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, currentY, imgWidth, sliceMmHeight);
        currentY += sliceMmHeight;
        sourceYPx += sliceHeightPx;

        // 如果还有剩余内容，换页继续
        if (sourceYPx < canvas.height) {
          this.addFooter(pdf, pageNum, 0, pageWidth, pageHeight, margin);
          pdf.addPage();
          pageNum++;
          currentY = margin + headerHeight;
          this.addHeader(pdf, title, pageNum, pageWidth, margin);
        }
      }

      currentY += 2; // 批次间距
    }

    this.addFooter(pdf, pageNum, pageNum, pageWidth, pageHeight, margin);
    return pdf.output('blob');
  },

  /**
   * 流式分批导出 PDF — 主要导出方法
   * 每批渲染少量消息，批次之间让出主线程，避免长对话卡顿
   * @param {Object} options
   * @param {number} options.batchSize - 每批消息数（默认 3）
   * @param {Function} options.onProgress - 进度回调 (currentMsg, totalMsg)
   * @returns {Promise<Blob|null>}
   */
  async exportStreamed(options = {}) {
    if (!this.isAvailable()) return null;

    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    if (!conversation.messages.length) return null;

    const batchSize = options.batchSize || 3;
    const onProgress = options.onProgress || (() => {});
    const messages = conversation.messages;
    const batches = this.computeBatches(messages.length, batchSize);
    const contentWidth = 210 - 15 * 2; // pageWidth - margin*2
    const widthPx = contentWidth * 3.78;

    const canvases = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchMessages = messages.slice(batch.start, batch.end);

      try {
        const canvas = await this.renderBatch(batchMessages, widthPx);
        canvases.push(canvas);
      } catch (err) {
        console.warn(`[PDF] 批次 ${i + 1}/${batches.length} 渲染失败，跳过:`, err.message);
        canvases.push(null); // placeholder for skipped batch
      }

      onProgress(batch.end, messages.length);

      // 让出主线程，避免阻塞 UI
      await new Promise(r => setTimeout(r, 0));
    }

    // 过滤掉失败的批次并组装 PDF
    const validCanvases = canvases.filter(c => c !== null);
    if (validCanvases.length === 0) return null;

    try {
      return this.assemblePDF(validCanvases, conversation.title, messages.length);
    } catch (err) {
      console.error('[PDF] 组装 PDF 失败:', err);
      return null;
    }
  },

  /**
   * 带自动降级的导出：优先使用流式渲染，短对话回退到整体渲染
   */
  async exportWithFallback(onProgress) {
    if (!this.isAvailable()) return null;

    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    if (!conversation.messages.length) return null;

    // 超过 15 条消息使用流式渲染，避免卡顿
    if (conversation.messages.length > 15) {
      console.log(`[PDF] ${conversation.messages.length} 条消息，使用流式渲染`);
      try {
        const result = await this.exportStreamed({ onProgress });
        if (result) return result;
      } catch (e) {
        console.warn('[PDF] 流式渲染失败，回退到分段模式:', e.message);
      }
      // 流式失败，回退到分段
      try {
        return await this.exportSegmented();
      } catch (e) {
        console.error('[PDF] 分段模式也失败:', e);
        return null;
      }
    }

    // 短对话使用整体 canvas 模式
    try {
      const { jsPDF } = jspdf;
      const pageWidth = 210, pageHeight = 297, margin = 15;
      const headerHeight = 12, footerHeight = 12;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;

      const container = this.createPDFContainer(conversation, contentWidth);
      document.body.appendChild(container);
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(container, {
        scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
        width: container.offsetWidth, height: container.offsetHeight
      });
      document.body.removeChild(container);

      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pageHeightPx = contentHeight * (canvas.height / imgHeight);

      if (this.detectPageGaps(canvas, pageHeightPx)) {
        return await this.exportSegmented();
      }

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const totalPages = Math.ceil(imgHeight / contentHeight);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();
        this.addHeader(pdf, conversation.title, page + 1, pageWidth, margin);

        const sourceY = page * pageHeightPx;
        const sourceHeight = Math.min(pageHeightPx, canvas.height - sourceY);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceHeight;
        pageCanvas.getContext('2d').drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);

        const pageImgHeight = (sourceHeight * imgWidth) / canvas.width;
        pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin + headerHeight, imgWidth, pageImgHeight);
        this.addFooter(pdf, page + 1, totalPages, pageWidth, pageHeight, margin);
      }

      return pdf.output('blob');
    } catch (error) {
      console.error('[PDF] 整体模式失败，尝试流式:', error);
      try {
        return await this.exportStreamed();
      } catch (e) {
        console.error('[PDF] 流式也失败:', e);
        return null;
      }
    }
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.PDFExporter = PDFExporter;
