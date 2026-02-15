/**
 * PDF 导出器 - 使用 html2canvas 支持中文，正确处理分页
 */

const PDFExporter = {
  // 最大重试次数
  maxRetries: 2,
  unicodeFontName: 'NotoSansSC',
  unicodeFontFile: 'ChatGPTSaver-NotoSansSC-Regular.ttf',
  unicodeFontBinary: null,
  unicodeFontLoadingPromise: null,
  unicodeFontEnabled: false,
  
  /**
   * 检查 PDF 导出是否可用
   */
  isAvailable() {
    const legacyReady = typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined';
    const v2Ready = !!(
      window.ChatGPTSaver?.PDFASTBuilder &&
      window.ChatGPTSaver?.PDFWorkerBridge &&
      typeof window.ChatGPTSaver.PDFWorkerBridge.isSupported === 'function' &&
      window.ChatGPTSaver.PDFWorkerBridge.isSupported()
    );
    return legacyReady || v2Ready;
  },
  
  /**
   * 获取不可用的原因
   */
  getUnavailableReason() {
    const hasBuilder = !!window.ChatGPTSaver?.PDFASTBuilder;
    const hasBridge = !!window.ChatGPTSaver?.PDFWorkerBridge;
    const workerOk = !!window.ChatGPTSaver?.PDFWorkerBridge?.isSupported?.();
    const legacyReady = typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined';
    if (legacyReady || (hasBuilder && hasBridge && workerOk)) return null;

    const reasons = [];
    if (typeof html2canvas === 'undefined') reasons.push('html2canvas 库未加载');
    if (typeof jspdf === 'undefined') reasons.push('jsPDF 库未加载');
    if (!hasBuilder) reasons.push('PDFASTBuilder 未加载');
    if (!hasBridge) reasons.push('PDFWorkerBridge 未加载');
    if (hasBridge && !workerOk) reasons.push('Worker 环境不可用');
    return reasons.join(' | ');
  },

  _containsNonAscii(text) {
    return /[^\x00-\x7F]/.test(String(text || ''));
  },

  _conversationNeedsUnicode(conversation) {
    if (!conversation || !Array.isArray(conversation.messages)) return false;
    return conversation.messages.some((msg) =>
      this._containsNonAscii(msg?.textContent || msg?.content || '')
    );
  },

  _arrayBufferToBinaryString(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let result = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      result += String.fromCharCode.apply(null, chunk);
    }
    return result;
  },

  async _loadUnicodeFontBinary() {
    if (this.unicodeFontBinary) return this.unicodeFontBinary;
    if (this.unicodeFontLoadingPromise) return this.unicodeFontLoadingPromise;

    const candidates = [];
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        const manifest = chrome.runtime.getManifest?.();
        const webResources = Array.isArray(manifest?.web_accessible_resources)
          ? manifest.web_accessible_resources
          : [];
        const listedInManifest = webResources.some((entry) =>
          Array.isArray(entry?.resources) && entry.resources.includes('src/lib/NotoSansSC-Regular.ttf')
        );
        // 仅当 manifest 明确暴露字体资源时才尝试本地扩展 URL，避免控制台出现权限拦截噪音
        if (listedInManifest) {
          candidates.push(chrome.runtime.getURL('src/lib/NotoSansSC-Regular.ttf'));
        }
      }
    } catch (e) {
      // ignore
    }
    candidates.push(
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/TTF/SimplifiedChinese/NotoSansSC-Regular.ttf'
    );

    this.unicodeFontLoadingPromise = (async () => {
      for (const url of candidates) {
        try {
          const resp = await fetch(url, { cache: 'force-cache' });
          if (!resp.ok) continue;
          const buf = await resp.arrayBuffer();
          if (!buf || !buf.byteLength) continue;
          this.unicodeFontBinary = this._arrayBufferToBinaryString(buf);
          this.unicodeFontEnabled = true;
          return this.unicodeFontBinary;
        } catch (e) {
          // try next
        }
      }
      this.unicodeFontEnabled = false;
      this.unicodeFontBinary = null;
      return null;
    })();

    const out = await this.unicodeFontLoadingPromise;
    this.unicodeFontLoadingPromise = null;
    return out;
  },

  async ensureUnicodeFont(pdf) {
    if (!pdf) return false;
    if (pdf.__saverUnicodeFontReady) return true;

    const binary = await this._loadUnicodeFontBinary();
    if (!binary) return false;

    try {
      pdf.addFileToVFS(this.unicodeFontFile, binary);
      pdf.addFont(this.unicodeFontFile, this.unicodeFontName, 'normal');
      pdf.__saverUnicodeFontReady = true;
      return true;
    } catch (e) {
      console.warn('[PDF] 注册 Unicode 字体失败:', e?.message || e);
      return false;
    }
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
      
      const imgData = canvas.toDataURL('image/png');
      
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
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          canvas,
          0, sourceY,
          canvas.width, sourceHeight,
          0, 0,
          canvas.width, sourceHeight
        );
        
        const pageImgData = pageCanvas.toDataURL('image/png');
        const pageImgHeight = (sourceHeight * imgWidth) / canvas.width;
        
        // 添加图片到 PDF
        pdf.addImage(
          pageImgData,
          'PNG',
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
      box-sizing: border-box;
      line-height: 1.6;
      font-size: 14px;
    `;

    // 限制原始页面复杂布局类对导出容器的影响，减少异常大空白和截断
    const resetStyle = document.createElement('style');
    resetStyle.textContent = `
      #pdf-export-container * { box-sizing: border-box !important; }
      #pdf-export-container [hidden],
      #pdf-export-container [aria-hidden="true"],
      #pdf-export-container button,
      #pdf-export-container [class*="copy"] {
        display: none !important;
      }
    `;
    container.appendChild(resetStyle);
    
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

    // 移除高风险元素
    temp.querySelectorAll('script, style, link, iframe, video, audio, button, [class*="copy"], svg').forEach(el => el.remove());
    // 去除可能导致截断/黑块的布局属性
    temp.querySelectorAll('*').forEach((el) => {
      if (!(el instanceof Element)) return;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag !== 'a' && tag !== 'img') {
        Array.from(el.attributes).forEach((attr) => {
          const n = String(attr.name || '').toLowerCase();
          if (n === 'style' || n === 'class' || n === 'id' || n.startsWith('data-') || n.startsWith('aria-')) {
            el.removeAttribute(attr.name);
          }
        });
      }
      // 移除常见的截断类行为
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
      el.style.position = 'static';
      el.style.filter = 'none';
      el.style.backdropFilter = 'none';
      el.style.transform = 'none';
      el.style.webkitLineClamp = 'unset';
    });

    // 处理代码块
    temp.querySelectorAll('pre').forEach(pre => {
      pre.style.cssText = `
        background: #f3f4f6;
        color: #111827;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        font-family: 'Consolas', 'Monaco', 'Menlo', monospace;
        font-size: 12px;
        margin: 10px 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-wrap: anywhere;
      `;
    });

    // 处理行内代码
    temp.querySelectorAll('code').forEach(code => {
      if (code.parentElement && String(code.parentElement.tagName || '').toUpperCase() !== 'PRE') {
        code.style.cssText = `
          background: #f3f4f6;
          padding: 2px 5px;
          border-radius: 3px;
          font-family: 'Consolas', 'Monaco', monospace;
          font-size: 12px;
          color: #dc2626;
        `;
      }
    });

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
    const pageText = Number(totalPages) > 0 ? `${currentPage} / ${totalPages}` : `${currentPage}`;
    pdf.text(pageText, pageWidth - margin - 15, y);
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
    const safePageHeight = Math.max(1, Math.floor(pageHeightPx));
    const totalPages = Math.ceil(canvas.height / safePageHeight);

    for (let page = 1; page < totalPages; page++) {
      const y = page * safePageHeight;
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
   * 构建稳定的分页切片计划（使用整数像素步进，避免浮点累计误差）
   */
  buildSlicePlan(totalHeightPx, pageHeightPx) {
    const total = Math.max(0, Math.floor(Number(totalHeightPx) || 0));
    const page = Math.max(1, Math.floor(Number(pageHeightPx) || 1));
    const slices = [];
    let sourceY = 0;
    while (sourceY < total) {
      const sourceHeight = Math.min(page, total - sourceY);
      slices.push({ sourceY, sourceHeight });
      sourceY += sourceHeight;
    }
    return slices;
  },

  /**
   * 检测切片中真实内容的上下边界（非近白像素）
   */
  detectInkBounds(canvas, sampleStep = 2) {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height).data;
    let top = -1;
    let bottom = -1;

    for (let y = 0; y < height; y++) {
      let hasInk = false;
      for (let x = 0; x < width; x += sampleStep) {
        const idx = (y * width + x) * 4;
        const r = imageData[idx];
        const g = imageData[idx + 1];
        const b = imageData[idx + 2];
        const a = imageData[idx + 3];
        if (a > 5 && (r < 248 || g < 248 || b < 248)) {
          hasInk = true;
          break;
        }
      }
      if (hasInk) {
        if (top === -1) top = y;
        bottom = y;
      }
    }

    if (top === -1 || bottom === -1) return null;
    return { top, bottom };
  },

  /**
   * 裁剪分页切片的顶部/底部大空白，减少“页首大白块”和“页尾被截断”观感问题
   */
  trimSliceWhitespace(canvas, options = {}) {
    if (!canvas || !canvas.width || !canvas.height) return canvas;
    const trimTop = options.trimTop !== false;
    const trimBottom = options.trimBottom !== false;
    const thresholdPx = Math.max(0, Number(options.thresholdPx) || 20);
    const keepPaddingPx = Math.max(0, Number(options.keepPaddingPx) || 4);
    const bounds = this.detectInkBounds(canvas, 2);
    if (!bounds) return canvas;

    const topBlank = bounds.top;
    const bottomBlank = (canvas.height - 1) - bounds.bottom;
    const cropTop = trimTop && topBlank > thresholdPx ? Math.max(0, topBlank - keepPaddingPx) : 0;
    const cropBottom = trimBottom && bottomBlank > thresholdPx ? Math.max(0, bottomBlank - keepPaddingPx) : 0;
    const newHeight = canvas.height - cropTop - cropBottom;
    if (newHeight <= 0 || (cropTop === 0 && cropBottom === 0)) return canvas;

    const trimmed = document.createElement('canvas');
    trimmed.width = canvas.width;
    trimmed.height = newHeight;
    const tctx = trimmed.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, trimmed.width, trimmed.height);
    tctx.drawImage(canvas, 0, cropTop, canvas.width, newHeight, 0, 0, canvas.width, newHeight);
    return trimmed;
  },

  /**
   * 统计 canvas 是否出现“几乎全黑”异常（常见于透明+JPEG 或渲染失败）
   */
  isCanvasMostlyBlack(canvas, options = {}) {
    if (!canvas || !canvas.width || !canvas.height) return false;
    const sampleStep = Math.max(1, Number(options.sampleStep) || 8);
    const threshold = Number(options.threshold) || 0.92;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blackCount = 0;
    let total = 0;
    for (let y = 0; y < canvas.height; y += sampleStep) {
      for (let x = 0; x < canvas.width; x += sampleStep) {
        const idx = (y * canvas.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a > 200 && r < 12 && g < 12 && b < 12) blackCount += 1;
        total += 1;
      }
    }
    if (total === 0) return false;
    return (blackCount / total) >= threshold;
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
        if (this.isCanvasMostlyBlack(canvas)) {
          throw new Error('segmented-canvas-mostly-black');
        }

        const imgWidth = contentWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const remainingOnPage = pageHeight - margin - footerHeight - currentY;

        // 如果整个消息能放进当前页剩余空间
        if (imgHeight <= remainingOnPage) {
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, currentY, imgWidth, imgHeight);
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
            Math.max(1, Math.floor(availableMm * pxPerMm)),
            canvas.height - sourceYPx
          );
          if (sliceHeightPx <= 0) break;

          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeightPx;
          const sctx = sliceCanvas.getContext('2d');
          sctx.fillStyle = '#ffffff';
          sctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          sctx.drawImage(
            canvas, 0, sourceYPx, canvas.width, sliceHeightPx,
            0, 0, canvas.width, sliceHeightPx
          );

          const sliceForPdf = this.trimSliceWhitespace(sliceCanvas, {
            trimTop: sourceYPx > 0,
            trimBottom: sourceYPx + sliceHeightPx < canvas.height,
            thresholdPx: 24,
            keepPaddingPx: 4
          });
          const sliceMmHeight = (sliceForPdf.height * imgWidth) / sliceForPdf.width;
          pdf.addImage(sliceForPdf.toDataURL('image/png'), 'PNG', margin, currentY, imgWidth, sliceMmHeight);
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
    container.style.cssText = `position:absolute;left:-9999px;top:0;width:${widthPx}px;background:white;font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei','Segoe UI',sans-serif;padding:10px;box-sizing:border-box;font-size:14px;line-height:1.6;`;

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
    if (this.isCanvasMostlyBlack(canvas)) {
      throw new Error('batch-canvas-mostly-black');
    }
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
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, currentY, imgWidth, imgHeight);
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
          Math.max(1, Math.floor(availableMm * pxPerMm)),
          canvas.height - sourceYPx
        );
        if (sliceHeightPx <= 0) break;

        // 创建切片 canvas
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0, sourceYPx, canvas.width, sliceHeightPx,
          0, 0, canvas.width, sliceHeightPx
        );

        const sliceForPdf = this.trimSliceWhitespace(sliceCanvas, {
          trimTop: sourceYPx > 0,
          trimBottom: sourceYPx + sliceHeightPx < canvas.height,
          thresholdPx: 24,
          keepPaddingPx: 4
        });
        const sliceMmHeight = (sliceForPdf.height * imgWidth) / sliceForPdf.width;
        pdf.addImage(sliceForPdf.toDataURL('image/png'), 'PNG', margin, currentY, imgWidth, sliceMmHeight);
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

  _supportsStructuredV2() {
    return !!(
      window.ChatGPTSaver?.PDFASTBuilder &&
      window.ChatGPTSaver?.PDFWorkerBridge &&
      typeof window.ChatGPTSaver.PDFASTBuilder.buildConversationAst === 'function' &&
      typeof window.ChatGPTSaver.PDFWorkerBridge.exportWithWorker === 'function' &&
      window.ChatGPTSaver.PDFWorkerBridge.isSupported?.()
    );
  },

  cancelStructuredV2(reason = 'cancelled by user') {
    const bridge = window.ChatGPTSaver?.PDFWorkerBridge;
    if (bridge && typeof bridge.cancelCurrentTask === 'function') {
      bridge.cancelCurrentTask(reason);
    }
  },

  async exportStructuredV2(options = {}) {
    if (!this._supportsStructuredV2()) return null;

    const parser = window.ChatGPTSaver.Parser;
    const builder = window.ChatGPTSaver.PDFASTBuilder;
    const bridge = window.ChatGPTSaver.PDFWorkerBridge;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

    const conversation = parser.parseConversation();
    if (!conversation.messages.length) return null;
    const workspace = parser.getWorkspaceName?.() || '';

    try {
      const request = await builder.buildConversationAst(conversation, {
        workspace,
        imageBudget: options.imageBudget,
        requestOptions: {
          quality: 'near-publish',
          page: 'A4',
          locale: 'zh-CN',
          embedFonts: true
        },
        onProgress: (payload) => {
          if (!payload) return;
          onProgress(payload.current || 0, payload.total || conversation.messages.length, payload);
        }
      });

      const result = await bridge.exportWithWorker(request, {
        timeoutMs: Number(options.timeoutMs) || 240000,
        onProgress: (payload) => {
          if (!payload) return;
          onProgress(payload.current || 0, payload.total || conversation.messages.length, payload);
        }
      });

      if (result?.success && result.blob) return result.blob;
      if (result?.error) {
        console.warn('[PDF] structured-v2 失败，准备回退 legacy:', result.error.code, result.error.message);
      }
      return null;
    } catch (error) {
      console.error('[PDF] structured-v2 导出失败:', error);
      return null;
    }
  },

  _createStructuredContext(title) {
    const { jsPDF } = jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const ctx = {
      pdf,
      title,
      pageWidth: 210,
      pageHeight: 297,
      margin: 15,
      headerHeight: 12,
      footerHeight: 12,
      lineHeight: 4.2,
      pageNum: 1
    };
    ctx.contentWidth = ctx.pageWidth - ctx.margin * 2;
    ctx.topY = ctx.margin + ctx.headerHeight + 2;
    ctx.bottomY = ctx.pageHeight - ctx.margin - ctx.footerHeight;
    ctx.cursorY = ctx.topY;
    this.addHeader(pdf, title, 1, ctx.pageWidth, ctx.margin);
    return ctx;
  },

  _structuredNewPage(ctx) {
    this.addFooter(ctx.pdf, ctx.pageNum, 0, ctx.pageWidth, ctx.pageHeight, ctx.margin);
    ctx.pdf.addPage();
    ctx.pageNum += 1;
    this.addHeader(ctx.pdf, ctx.title, ctx.pageNum, ctx.pageWidth, ctx.margin);
    ctx.cursorY = ctx.topY;
  },

  _structuredEnsureSpace(ctx, neededHeight) {
    if (ctx.cursorY + neededHeight <= ctx.bottomY) return;
    this._structuredNewPage(ctx);
  },

  _extractFormulaText(node) {
    if (!node) return '';
    const direct = [
      node.getAttribute?.('data-tex'),
      node.getAttribute?.('data-latex'),
      node.getAttribute?.('aria-label')
    ].find(Boolean);
    if (direct) return String(direct).trim();

    const texAnnotation = node.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (texAnnotation) return texAnnotation;

    const mathScript = node.querySelector?.('script[type="math/tex"]')?.textContent?.trim();
    if (mathScript) return mathScript;

    const assistiveMath = node.querySelector?.('mjx-assistive-mml')?.textContent?.trim();
    if (assistiveMath) return assistiveMath;

    return '';
  },

  _isMathNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const cls = String(node.className || '').toLowerCase();
    const tag = String(node.tagName || '').toLowerCase();
    return cls.includes('katex') || cls.includes('mathjax') || cls.includes('math') || tag === 'math' || tag === 'mjx-container';
  },

  _extractInlineText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'br') return '\n';
    if (this._isMathNode(node)) {
      const formula = this._extractFormulaText(node);
      return formula ? `$${formula}$` : '[公式]';
    }
    if (tag === 'code') return `\`${node.textContent || ''}\``;

    return Array.from(node.childNodes).map(child => this._extractInlineText(child)).join('');
  },

  _writeParagraph(ctx, text, options = {}) {
    const content = String(text || '').replace(/\r/g, '').trim();
    if (!content) return;

    const fontSize = Number(options.fontSize || 11);
    const indent = Number(options.indent || 0);
    const color = options.color || [55, 65, 81];
    const spacingAfter = Number(options.spacingAfter || 2);
    const lineHeight = Number(options.lineHeight || 4.3);
    const fallbackFont = options.font || 'helvetica';
    const style = options.style || 'normal';
    const shouldUseUnicode = this._containsNonAscii(content) && !!ctx.unicodeFontReady;
    const font = shouldUseUnicode ? this.unicodeFontName : fallbackFont;

    ctx.pdf.setFont(font, style);
    ctx.pdf.setFontSize(fontSize);
    ctx.pdf.setTextColor(color[0], color[1], color[2]);

    const maxWidth = Math.max(20, ctx.contentWidth - indent);
    const lines = ctx.pdf.splitTextToSize(content, maxWidth);
    lines.forEach((line) => {
      if (ctx.cursorY + lineHeight > ctx.bottomY) this._structuredNewPage(ctx);
      ctx.pdf.text(line, ctx.margin + indent, ctx.cursorY);
      ctx.cursorY += lineHeight;
    });
    ctx.cursorY += spacingAfter;
  },

  _writeCodeBlock(ctx, text) {
    const codeText = String(text || '').replace(/\r/g, '').trim();
    if (!codeText) return;
    const lines = codeText.split('\n');
    const useUnicode = this._containsNonAscii(codeText) && !!ctx.unicodeFontReady;
    ctx.pdf.setFont(useUnicode ? this.unicodeFontName : 'courier', 'normal');
    ctx.pdf.setFontSize(9.5);
    ctx.pdf.setTextColor(31, 41, 55);
    const wrapped = lines.flatMap(line => ctx.pdf.splitTextToSize(line, ctx.contentWidth - 6));
    const lineHeight = 3.8;
    const minBlockHeight = lineHeight + 6;

    let i = 0;
    while (i < wrapped.length) {
      const freeHeight = Math.max(minBlockHeight, ctx.bottomY - ctx.cursorY);
      const linesPerPage = Math.max(1, Math.floor((freeHeight - 6) / lineHeight));
      const chunk = wrapped.slice(i, i + linesPerPage);
      const blockHeight = chunk.length * lineHeight + 6;
      this._structuredEnsureSpace(ctx, blockHeight);

      ctx.pdf.setFillColor(243, 244, 246);
      ctx.pdf.rect(ctx.margin, ctx.cursorY, ctx.contentWidth, blockHeight, 'F');
      ctx.pdf.setDrawColor(229, 231, 235);
      ctx.pdf.rect(ctx.margin, ctx.cursorY, ctx.contentWidth, blockHeight);
      chunk.forEach((line, idx) => {
        ctx.pdf.text(line, ctx.margin + 2, ctx.cursorY + 4 + idx * lineHeight);
      });
      ctx.cursorY += blockHeight + 2;
      i += chunk.length;
      if (i < wrapped.length) this._structuredNewPage(ctx);
    }
  },

  _writeTable(ctx, tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('th,td')).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim())
    ).filter(r => r.length > 0);
    if (!rows.length) return;

    this._writeParagraph(ctx, '表格：', { fontSize: 10, color: [75, 85, 99], spacingAfter: 1 });
    rows.forEach((row, idx) => {
      const prefix = idx === 1 && rows[0].every(Boolean) ? '|---|' : '|';
      const line = idx === 1 && rows[0].every(Boolean)
        ? row.map(() => '---').join('|')
        : row.map(cell => cell || ' ').join('|');
      this._writeCodeBlock(ctx, `${prefix}${line}|`);
    });
    ctx.cursorY += 1;
  },

  async _writeImageBlock(ctx, node) {
    try {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;background:#fff;padding:8px;max-width:700px;';
      const clone = node.cloneNode(true);
      host.appendChild(clone);
      document.body.appendChild(host);
      await new Promise(resolve => setTimeout(resolve, 30));
      const canvas = await html2canvas(host, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      document.body.removeChild(host);

      const imgWidth = ctx.contentWidth;
      let imgHeight = (canvas.height * imgWidth) / canvas.width;
      const maxHeight = Math.max(20, ctx.bottomY - ctx.topY - 2);
      if (imgHeight > maxHeight) imgHeight = maxHeight;
      this._structuredEnsureSpace(ctx, imgHeight + 2);
      ctx.pdf.addImage(canvas.toDataURL('image/png'), 'PNG', ctx.margin, ctx.cursorY, imgWidth, imgHeight);
      ctx.cursorY += imgHeight + 2;
    } catch (e) {
      this._writeParagraph(ctx, '[图像块导出失败]', { fontSize: 10, color: [153, 27, 27] });
    }
  },

  async _renderStructuredNode(ctx, node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      this._writeParagraph(ctx, node.textContent || '', { fontSize: 11 });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'pre') {
      const code = node.innerText || node.textContent || '';
      this._writeCodeBlock(ctx, code);
      return;
    }
    if (tag === 'table') {
      this._writeTable(ctx, node);
      return;
    }
    if (tag === 'canvas' || tag === 'img' || tag === 'svg' || node.querySelector('canvas, img, svg')) {
      await this._writeImageBlock(ctx, node);
      return;
    }
    if (this._isMathNode(node) || tag === 'math') {
      const formula = this._extractFormulaText(node);
      if (formula) this._writeCodeBlock(ctx, `公式: ${formula}`);
      else await this._writeImageBlock(ctx, node);
      return;
    }
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      const sizes = { h1: 16, h2: 15, h3: 14, h4: 13, h5: 12, h6: 11 };
      this._writeParagraph(ctx, this._extractInlineText(node), {
        fontSize: sizes[tag],
        style: 'bold',
        spacingAfter: 2.5,
        color: [17, 24, 39]
      });
      return;
    }
    if (tag === 'blockquote') {
      const quoteText = this._extractInlineText(node).split('\n').map(line => line.trim()).filter(Boolean).map(line => `> ${line}`).join('\n');
      this._writeParagraph(ctx, quoteText, { fontSize: 10.5, indent: 3, color: [75, 85, 99] });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(node.children).filter(el => String(el.tagName || '').toLowerCase() === 'li');
      items.forEach((li, idx) => {
        const bullet = tag === 'ol' ? `${idx + 1}. ` : '• ';
        this._writeParagraph(ctx, `${bullet}${this._extractInlineText(li)}`, { fontSize: 11, indent: 2, spacingAfter: 1.5 });
      });
      ctx.cursorY += 1;
      return;
    }

    const blockTags = new Set(['p', 'div', 'section', 'article', 'li']);
    if (blockTags.has(tag)) {
      if (node.querySelector('pre, table, canvas, img, svg, math, .katex, .mathjax, mjx-container')) {
        const children = Array.from(node.childNodes);
        for (const child of children) {
          await this._renderStructuredNode(ctx, child);
        }
        return;
      }
      const text = this._extractInlineText(node);
      this._writeParagraph(ctx, text, { fontSize: 11 });
      return;
    }

    const fallback = this._extractInlineText(node);
    this._writeParagraph(ctx, fallback, { fontSize: 11 });
  },

  async exportStructured(options = {}) {
    if (!this.isAvailable()) return null;
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    if (!conversation.messages.length) return null;

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

    try {
      const ctx = this._createStructuredContext(conversation.title || 'ChatGPT');
      const needUnicode = this._conversationNeedsUnicode(conversation);
      let unicodeReady = false;
      if (needUnicode) {
        unicodeReady = await this.ensureUnicodeFont(ctx.pdf);
        if (!unicodeReady) {
          console.warn('[PDF] structured 检测到中文/Unicode，但字体加载失败，将回退视觉模式避免乱码');
          return null;
        }
      }
      ctx.unicodeFontReady = unicodeReady;
      this._writeParagraph(ctx, `导出时间: ${new Date().toLocaleString('zh-CN')} | 共 ${conversation.messages.length} 条消息`, {
        fontSize: 9.5,
        color: [107, 114, 128],
        spacingAfter: 3
      });

      for (let i = 0; i < conversation.messages.length; i++) {
        const msg = conversation.messages[i];
        const role = msg.role === 'user' ? '用户' : 'ChatGPT';
        const roleColor = msg.role === 'user' ? [16, 163, 127] : [79, 70, 229];
        this._writeParagraph(ctx, `${i + 1}. ${role}`, {
          fontSize: 11.5,
          style: 'bold',
          color: roleColor,
          spacingAfter: 1.5
        });

        const root = document.createElement('div');
        root.innerHTML = msg.content || '';
        const nodes = Array.from(root.childNodes);
        if (!nodes.length) {
          this._writeParagraph(ctx, msg.textContent || '', { fontSize: 11 });
        } else {
          for (const node of nodes) {
            await this._renderStructuredNode(ctx, node);
          }
        }

        this._structuredEnsureSpace(ctx, 3);
        ctx.pdf.setDrawColor(229, 231, 235);
        ctx.pdf.line(ctx.margin, ctx.cursorY, ctx.margin + ctx.contentWidth, ctx.cursorY);
        ctx.cursorY += 3;
        onProgress(i + 1, conversation.messages.length);
      }

      this.addFooter(ctx.pdf, ctx.pageNum, ctx.pageNum, ctx.pageWidth, ctx.pageHeight, ctx.margin);
      return ctx.pdf.output('blob');
    } catch (error) {
      console.error('[PDF] structured 导出失败:', error);
      return null;
    }
  },

  /**
   * 视觉还原模式（原有截图路径）
   */
  async exportVisual(options = {}) {
    if (!this.isAvailable()) return null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    if (!conversation.messages.length) return null;

    if (conversation.messages.length > 15) {
      try {
        const result = await this.exportSegmented();
        if (result) return result;
      } catch (e) {
        console.warn('[PDF] 分段渲染失败，回退到流式模式:', e.message);
      }
      try {
        return await this.exportStreamed({ onProgress });
      } catch (e) {
        console.error('[PDF] 流式模式也失败:', e);
        return null;
      }
    }

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

      if (this.isCanvasMostlyBlack(canvas)) {
        console.warn('[PDF] visual 整体 canvas 异常偏黑，自动回退分段模式');
        return await this.exportSegmented();
      }

      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pxPerMm = canvas.width / imgWidth;
      const pageHeightPx = Math.max(1, Math.floor(contentHeight * pxPerMm));

      if (this.detectPageGaps(canvas, pageHeightPx)) {
        return await this.exportSegmented();
      }

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const slices = this.buildSlicePlan(canvas.height, pageHeightPx);
      const totalPages = slices.length;

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();
        this.addHeader(pdf, conversation.title, page + 1, pageWidth, margin);

        const sourceY = slices[page].sourceY;
        const sourceHeight = slices[page].sourceHeight;
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceHeight;
        const pctx = pageCanvas.getContext('2d');
        pctx.fillStyle = '#ffffff';
        pctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        pctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);

        const sliceForPdf = this.trimSliceWhitespace(pageCanvas, {
          trimTop: page > 0,
          trimBottom: page < totalPages - 1,
          thresholdPx: 24,
          keepPaddingPx: 4
        });
        const pageImgHeight = (sliceForPdf.height * imgWidth) / sliceForPdf.width;
        pdf.addImage(sliceForPdf.toDataURL('image/png'), 'PNG', margin, margin + headerHeight, imgWidth, pageImgHeight);
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
  },

  /**
   * 带自动降级的导出
   * 兼容旧签名: exportWithFallback(onProgress)
   * 新签名: exportWithFallback({ mode, onProgress })
   */
  async exportWithFallback(optionsOrProgress) {
    let options = {};
    if (typeof optionsOrProgress === 'function') {
      options = { onProgress: optionsOrProgress };
    } else if (optionsOrProgress && typeof optionsOrProgress === 'object') {
      options = optionsOrProgress;
    }

    const mode = options.mode === 'visual' ? 'visual' : 'structured';
    if (mode === 'visual') {
      return this.exportVisual(options);
    }

    const structuredV2 = await this.exportStructuredV2(options);
    if (structuredV2) return structuredV2;

    const structured = await this.exportStructured(options);
    if (structured) return structured;
    console.warn('[PDF] structured 模式不可用或失败，已自动回退 visual 模式');
    return this.exportVisual(options);
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.PDFExporter = PDFExporter;
