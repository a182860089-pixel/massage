/**
 * 导出器统一接口 - 整合所有导出功能
 */

const Exporter = {
  /**
   * 记录日志（同时输出到控制台和日志收集器）
   */
  log(message) {
    console.log(message);
    if (window.ChatGPTSaver?.Logger) {
      window.ChatGPTSaver.Logger.add(message);
    }
  },
  
  /**
   * 导出当前对话
   */
  async exportConversation(formats = { html: true, md: true, pdf: true }) {
    const parser = window.ChatGPTSaver.Parser;
    const fileSystem = window.ChatGPTSaver.FileSystem;
    const logger = window.ChatGPTSaver?.Logger;
    
    // 显示日志面板（如果还没显示的话）
    if (logger && !logger.panelVisible) {
      logger.clear();
      logger.showPanel();
    }
    
    // 获取对话标题
    const title = parser.getConversationTitle();
    
    // 获取工作空间名称
    const workspaceName = parser.getWorkspaceName();
    
    if (!title) {
      this.log('❌ 无法获取对话标题');
      return { success: false, error: '无法获取对话标题' };
    }
    
    this.log(`📝 开始导出对话: ${title}`);
    this.log(`📁 工作空间: ${workspaceName || '无'}`);
    
    let htmlContent = null;
    let mdContent = null;
    let pdfBlob = null;
    
    try {
      // 生成 HTML
      if (formats.html) {
        this.log('📦 生成 HTML...');
        htmlContent = window.ChatGPTSaver.HTMLExporter.exportWithFullStyles();
        this.log(`✅ HTML 完成, 长度: ${htmlContent?.length || 0} 字符`);
      }
      
      // 生成 Markdown
      if (formats.md) {
        this.log('📦 生成 Markdown...');
        mdContent = window.ChatGPTSaver.MarkdownExporter.export();
        this.log(`✅ Markdown 完成, 长度: ${mdContent?.length || 0} 字符`);
      }
      
      // 生成 PDF
      if (formats.pdf) {
        this.log('📦 生成 PDF...');
        // 检查 PDF 导出是否可用
        if (!window.ChatGPTSaver.PDFExporter.isAvailable()) {
          const reason = window.ChatGPTSaver.PDFExporter.getUnavailableReason();
          this.log(`⚠️ PDF 导出不可用: ${reason}`);
        } else {
          // 使用带重试的导出，更稳定
          pdfBlob = await window.ChatGPTSaver.PDFExporter.exportWithRetry(2);
          if (pdfBlob) {
            const sizeKB = Math.round(pdfBlob.size / 1024);
            this.log(`✅ PDF 完成, 大小: ${sizeKB} KB`);
          } else {
            this.log('⚠️ PDF 生成失败，已跳过');
          }
        }
      }
      
      // 保存文件
      if (fileSystem.isAuthorized()) {
        this.log('💾 开始保存到本地文件夹...');
        const result = await fileSystem.saveConversation(title, htmlContent, mdContent, pdfBlob, formats, workspaceName);
        if (result.success) {
          this.log(`✅ 保存成功! 格式: ${result.saved.join(', ').toUpperCase()}`);
          if (result.workspaceName) {
            this.log(`📂 保存位置: ${result.workspaceName}/${result.folderName}`);
          } else {
            this.log(`📂 保存位置: ${result.folderName}`);
          }
          // 更新日志面板状态为成功
          if (logger) {
            const msg = `「${result.title}」已保存 (${result.saved.join(', ').toUpperCase()})`;
            logger.complete('保存成功', msg);
          }
        } else {
          if (logger) {
            logger.fail(result.error);
          }
        }
        return result;
      } else {
        this.log('⚠️ 未授权文件夹，使用下载方式保存...');
        const result = await window.ChatGPTSaver.DownloadFallback.saveConversation(title, htmlContent, mdContent, pdfBlob, formats);
        if (result.success && logger) {
          const msg = `「${result.title}」已下载 (${result.saved.join(', ').toUpperCase()})`;
          logger.complete('下载成功', msg);
        }
        return result;
      }
    } catch (error) {
      this.log(`❌ 导出失败: ${error.message}`);
      console.error('[Exporter] 错误堆栈:', error.stack);
      if (logger) {
        logger.fail(error.message);
      }
      return { success: false, error: error.message };
    }
  },
  
  /**
   * 仅生成导出内容（不保存）
   */
  async generateExports(formats = { html: true, md: true, pdf: true }) {
    const result = {
      title: window.ChatGPTSaver.Parser.getConversationTitle(),
      html: null,
      md: null,
      pdf: null
    };
    
    if (formats.html) {
      result.html = window.ChatGPTSaver.HTMLExporter.exportWithFullStyles();
    }
    
    if (formats.md) {
      result.md = window.ChatGPTSaver.MarkdownExporter.export();
    }
    
    if (formats.pdf) {
      result.pdf = await window.ChatGPTSaver.PDFExporter.export();
    }
    
    return result;
  },
  
  /**
   * 预览导出内容
   */
  previewHTML() {
    const html = window.ChatGPTSaver.HTMLExporter.exportWithFullStyles();
    if (html) {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  },
  
  /**
   * 检查是否可以导出
   */
  canExport() {
    const messages = window.ChatGPTSaver.Parser.getMessageElements();
    return messages.length > 0;
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.Exporter = Exporter;
