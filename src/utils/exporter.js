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
   * @param {Object} formats - 导出格式配置
   * @param {boolean} forceExport - 是否强制导出（跳过更新检查）
   */
  async exportConversation(formats = { html: true, md: true, pdf: true }, forceExport = false) {
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
    
    const messages = parser.getMessageElements();
    const currentMessageCount = messages.length;
    
    this.log(`📝 开始导出对话: ${title}`);
    this.log(`📁 工作空间: ${workspaceName || '无'}`);
    this.log(`💬 当前消息数: ${currentMessageCount}`);
    
    // 检查是否需要更新（仅在文件夹模式且非强制导出时）
    if (!forceExport && fileSystem.isAuthorized()) {
      this.log('🔍 检查是否需要更新...');
      const checkResult = await fileSystem.checkConversationNeedsUpdate(title, workspaceName, currentMessageCount);
      if (!checkResult.needsUpdate) {
        this.log(`✅ 对话已是最新: ${checkResult.path}`);
        this.log(`💬 已保存 ${checkResult.savedCount} 条消息，当前 ${checkResult.currentCount} 条`);
        if (logger) {
          logger.complete('跳过', `对话无新消息，无需更新`);
        }
        return { success: true, skipped: true, reason: 'unchanged' };
      }
      if (checkResult.reason === 'updated') {
        this.log(`🔄 检测到新消息: ${checkResult.savedCount} → ${checkResult.currentCount}`);
      } else if (checkResult.reason === 'new') {
        this.log('🆕 新对话，将创建保存');
      } else {
        this.log(`📦 需要保存 (原因: ${checkResult.reason})`);
      }
    }
    
    let htmlContent = null;
    let mdContent = null;
    let pdfBlob = null;
    
    try {
      // 生成 JSON
      let jsonContent = null;
      if (formats.json) {
        this.log('📦 生成 JSON...');
        jsonContent = window.ChatGPTSaver.JSONExporter.export();
        if (jsonContent) {
          const jsonStr = window.ChatGPTSaver.JSONExporter.serialize(jsonContent);
          jsonContent = jsonStr;
          this.log(`✅ JSON 完成, 长度: ${jsonStr.length} 字符`);
        } else {
          this.log('⚠️ JSON 生成失败（无内容）');
        }
      }
      
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
          // 使用带重试的导出，更稳定；传递进度回调
          const onProgress = (current, total) => {
            this.log(`📦 正在导出 ${current}/${total} 条消息...`);
            if (window.ChatGPTSaver.UI && window.ChatGPTSaver.UI.showToast) {
              const pct = Math.round((current / total) * 100);
              window.ChatGPTSaver.UI.showToast(`📦 正在导出 ${current}/${total} 条消息 (${pct}%)`, 'saving', 0);
            }
          };
          pdfBlob = await window.ChatGPTSaver.PDFExporter.exportWithFallback(onProgress);
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
        const result = await fileSystem.saveConversation(title, htmlContent, mdContent, pdfBlob, formats, workspaceName, jsonContent);
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
  },

  /**
   * 导出选中的消息（Conversation Fragment）
   * @param {Object} conversation - { title, messages }
   * @param {Object} formats - 导出格式配置
   */
  async exportSelectedMessages(conversation, formats = { html: true, md: true, json: true }) {
    const fileSystem = window.ChatGPTSaver.FileSystem;
    const logger = window.ChatGPTSaver?.Logger;

    if (logger && !logger.panelVisible) { logger.clear(); logger.showPanel(); }

    this.log(`📝 导出选中消息: ${conversation.title} (${conversation.messages.length} 条)`);

    let htmlContent = null, mdContent = null, pdfBlob = null, jsonContent = null;

    try {
      if (formats.json && window.ChatGPTSaver.JSONExporter) {
        this.log('📦 生成 JSON...');
        const data = window.ChatGPTSaver.JSONExporter.exportFromConversation({
          title: conversation.title,
          workspace: window.ChatGPTSaver.Parser.getWorkspaceName(),
          url: location.href,
          messages: conversation.messages
        });
        if (data) jsonContent = window.ChatGPTSaver.JSONExporter.serialize(data);
      }

      if (formats.html && window.ChatGPTSaver.HTMLExporter) {
        this.log('📦 生成 HTML...');
        htmlContent = window.ChatGPTSaver.HTMLExporter.exportFromMessages(conversation.messages, conversation.title);
      }

      if (formats.md && window.ChatGPTSaver.MarkdownExporter) {
        this.log('📦 生成 Markdown...');
        mdContent = window.ChatGPTSaver.MarkdownExporter.exportFromMessages(conversation.messages, conversation.title);
      }

      if (formats.pdf && window.ChatGPTSaver.PDFExporter?.isAvailable()) {
        this.log('📦 生成 PDF...');
        // For selected messages, use streamed export with custom messages
        // Skip PDF for fragment export to keep it simple — PDF requires DOM rendering
        this.log('⚠️ PDF 选择导出暂不支持，已跳过');
      }

      if (fileSystem.isAuthorized()) {
        this.log('💾 保存到本地文件夹...');
        const workspaceName = window.ChatGPTSaver.Parser.getWorkspaceName();
        const result = await fileSystem.saveConversation(
          conversation.title, htmlContent, mdContent, pdfBlob, formats, workspaceName, jsonContent
        );
        if (result.success) {
          this.log(`✅ 保存成功! 格式: ${result.saved.join(', ').toUpperCase()}`);
          if (logger) logger.complete('保存成功', `「${result.title}」已保存`);
        }
        return result;
      } else {
        this.log('⚠️ 未授权文件夹，使用下载方式...');
        const result = await window.ChatGPTSaver.DownloadFallback?.saveConversation(
          conversation.title, htmlContent, mdContent, pdfBlob, formats
        );
        return result || { success: false, error: '下载失败' };
      }
    } catch (error) {
      this.log(`❌ 导出失败: ${error.message}`);
      if (logger) logger.fail(error.message);
      return { success: false, error: error.message };
    }
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.Exporter = Exporter;
