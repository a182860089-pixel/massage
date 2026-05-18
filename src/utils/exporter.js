const Exporter = {
  normalizePdfMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    if (raw === 'visual') return 'visual';
    if (raw === 'structured') return 'structured';
    return 'structured_auto';
  },

  log(message) {
    console.log(message);
    if (window.ChatGPTSaver?.Logger) window.ChatGPTSaver.Logger.add(message);
  },

  _conversationDigest(conversation) {
    const fs = window.ChatGPTSaver?.FileSystem;
    const last = Array.isArray(conversation?.messages) ? conversation.messages.slice(-1).map((msg) => ({
      role: msg.role,
      textContent: msg.textContent || '',
      content: msg.content || ''
    })) : [];
    return fs?.simpleHash?.(JSON.stringify(last)) || '';
  },

  _pdfModeLabel(mode) {
    if (mode === 'visual') return '视觉还原';
    if (mode === 'structured') return '结构化';
    return '自动结构化';
  },

  async _ensureFolderReady() {
    const fileSystem = window.ChatGPTSaver?.FileSystem;
    if (!fileSystem) return { ready: false, error: 'file_system_unavailable' };
    return fileSystem.ensureFolderReady({ interactive: false, reason: 'export' });
  },

  async exportConversation(formats = { html: true, md: true, pdf: true, json: true }, forceExport = false, options = {}) {
    const parser = window.ChatGPTSaver.Parser;
    const fileSystem = window.ChatGPTSaver.FileSystem;
    const logger = window.ChatGPTSaver?.Logger;
    const quotaManager = window.ChatGPTSaver?.FeatureQuotaManager;
    const assetManager = window.ChatGPTSaver?.ConversationAssets;

    if (logger && !logger.panelVisible) {
      logger.clear();
      logger.showPanel();
    }

    const ready = await this._ensureFolderReady();
    if (!ready.ready) {
      const error = ready.error || '检测到未设置或已失效的保存文件夹';
      this.log(`❌ ${error}`);
      if (logger) logger.fail(error);
      return { success: false, error, folderState: ready.folderState || null };
    }

    let effectiveFormats = {
      html: formats?.html !== false,
      md: formats?.md !== false,
      pdf: formats?.pdf !== false,
      json: formats?.json !== false
    };

    if (quotaManager?.applyExportFormats) {
      const applied = await quotaManager.applyExportFormats(effectiveFormats);
      effectiveFormats = applied.formats;
      if (applied.blocked?.length) {
        this.log(`⚠️ 已自动禁用无额度格式: ${applied.blocked.map((item) => item.toUpperCase()).join(' / ')}`);
      }
    }

    if (!effectiveFormats.html && !effectiveFormats.md && !effectiveFormats.pdf && !effectiveFormats.json) {
      return { success: false, error: '可导出格式额度已用完或未勾选可用格式', folderState: ready.folderState || null };
    }

    const conversation = parser.parseConversation();
    const title = conversation?.title || parser.getConversationTitle();
    const workspaceName = parser.getWorkspaceName();
    if (!title || !conversation?.messages?.length) {
      return { success: false, error: '没有可导出的内容', folderState: ready.folderState || null };
    }

    const assetSnapshot = assetManager?.inspectConversationAssets
      ? await assetManager.inspectConversationAssets(conversation)
      : { assetsDigest: '' };
    const updateMeta = {
      messageCount: conversation.messages.length,
      lastMessageDigest: this._conversationDigest(conversation),
      assetsDigest: assetSnapshot?.assetsDigest || ''
    };

    this.log(`📝 开始导出对话: ${title}`);
    this.log(`📁 工作空间: ${workspaceName || '无'}`);
    this.log(`💬 当前消息数: ${conversation.messages.length}`);

    if (!forceExport) {
      this.log('🔍 检查是否需要更新...');
      const checkResult = await fileSystem.checkConversationNeedsUpdate(title, workspaceName, updateMeta);
      if (!checkResult.needsUpdate) {
        this.log(`✅ 对话已是最新: ${checkResult.path}`);
        if (logger) logger.complete('跳过', '对话无新内容，无需更新');
        return {
          success: true,
          skipped: true,
          reason: 'unchanged',
          folderState: ready.folderState || null,
          saved: [],
          savedAssets: []
        };
      }
      this.log(`📦 需要保存 (原因: ${checkResult.reason})`);
    }

    let jsonContent = null;
    let htmlContent = null;
    let mdContent = null;
    let pdfResult = null;

    try {
      if (effectiveFormats.json) {
        this.log('📦 生成 JSON...');
        const jsonData = window.ChatGPTSaver.JSONExporter.export();
        if (jsonData) jsonContent = window.ChatGPTSaver.JSONExporter.serialize(jsonData);
      }

      if (effectiveFormats.html) {
        this.log('📦 生成 HTML...');
        htmlContent = window.ChatGPTSaver.HTMLExporter.exportWithFullStyles();
      }

      if (effectiveFormats.md) {
        this.log('📦 生成 Markdown...');
        mdContent = window.ChatGPTSaver.MarkdownExporter.export();
      }

      if (effectiveFormats.pdf) {
        this.log(`🧭 PDF 模式: ${this._pdfModeLabel(this.normalizePdfMode(options.pdfMode))}`);
        let lastEmitTime = 0;
        let lastPct = -1;
        pdfResult = await window.ChatGPTSaver.PDFExporter.exportPackage({
          mode: this.normalizePdfMode(options.pdfMode),
          conversation,
          workspaceName,
          onProgress: (current, total, detail = null) => {
            const safeTotal = Math.max(1, Number(total) || 1);
            const safeCurrent = Math.max(0, Math.min(Number(current) || 0, safeTotal));
            const pct = Math.round((safeCurrent / safeTotal) * 100);
            const now = Date.now();
            if (safeCurrent !== safeTotal && pct === lastPct && (now - lastEmitTime) < 100) return;
            lastPct = pct;
            lastEmitTime = now;
            const prefix = detail?.stage ? `[${detail.stage}] ` : '';
            this.log(`📦 ${prefix}正在导出 ${safeCurrent}/${safeTotal} 条消息 (${pct}%)...`);
            window.ChatGPTSaver.UI?.showToast?.(`📦 ${prefix}正在导出 ${safeCurrent}/${safeTotal} 条消息 (${pct}%)`, 'saving', 0);
          }
        });
        if (!pdfResult?.success) {
          this.log('⚠️ PDF 生成失败，已跳过');
        } else if (pdfResult.split) {
          this.log(`⚠️ 对话过长，PDF 已拆分为 ${pdfResult.parts.length} 份`);
        } else if (pdfResult.blob) {
          this.log(`✅ PDF 完成, 大小: ${Math.round(pdfResult.blob.size / 1024)} KB`);
        }
      }

      const saveResult = await fileSystem.saveConversation(
        title,
        htmlContent,
        mdContent,
        pdfResult?.success ? (pdfResult.split ? { parts: pdfResult.parts } : pdfResult.blob) : null,
        effectiveFormats,
        workspaceName,
        jsonContent
      );
      if (!saveResult.success) {
        if (logger) logger.fail(saveResult.error);
        return { ...saveResult, folderState: ready.folderState || null };
      }

      const assetResult = assetManager?.collectConversationAssets
        ? await assetManager.collectConversationAssets({ conversation, snapshot: assetSnapshot })
        : { success: false, savedAssets: [], warnings: [] };

      const result = {
        ...saveResult,
        success: true,
        folderState: ready.folderState || null,
        savedAssets: Array.isArray(assetResult?.savedAssets) ? assetResult.savedAssets.map((item) => item.name) : [],
        splitPdfParts: saveResult.splitPdfParts || (pdfResult?.split ? pdfResult.parts.map((item, index) => item.fileName || `${saveResult.title}_part${String(index + 1).padStart(2, '0')}.pdf`) : []),
        warnings: []
      };

      if (Array.isArray(pdfResult?.warnings)) result.warnings.push(...pdfResult.warnings);
      if (Array.isArray(assetResult?.warnings)) result.warnings.push(...assetResult.warnings);

      if (quotaManager?.consumeExportFormats) {
        await quotaManager.consumeExportFormats(result.saved || []);
      }
      window.ChatGPTSaver?.UI?.refreshFeatureQuotaIndicators?.();

      const savedText = (result.saved || []).join(', ').toUpperCase();
      this.log(`✅ 保存成功! 格式: ${savedText}`);
      if (result.savedAssets.length) this.log(`📎 已同步保存 ${result.savedAssets.length} 个资产文件`);
      if (result.splitPdfParts.length) this.log(`📄 PDF 已拆分为 ${result.splitPdfParts.length} 份`);
      if (logger) logger.complete('保存成功', `「${result.title}」已保存${savedText ? ` (${savedText})` : ''}`);
      return result;
    } catch (error) {
      this.log(`❌ 导出失败: ${error.message}`);
      console.error('[Exporter] 错误堆栈:', error.stack);
      if (logger) logger.fail(error.message);
      return { success: false, error: error.message, folderState: ready.folderState || null };
    }
  },

  async generateExports(formats = { html: true, md: true, pdf: true }) {
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    const result = { title: conversation.title, html: null, md: null, pdf: null };
    if (formats.html) result.html = window.ChatGPTSaver.HTMLExporter.exportWithFullStyles();
    if (formats.md) result.md = window.ChatGPTSaver.MarkdownExporter.export();
    if (formats.pdf) {
      const pdfPackage = await window.ChatGPTSaver.PDFExporter.exportPackage({ mode: 'structured_auto', conversation });
      result.pdf = pdfPackage?.blob || null;
    }
    return result;
  },

  previewHTML() {
    const html = window.ChatGPTSaver.HTMLExporter.exportWithFullStyles();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  },

  canExport() {
    return window.ChatGPTSaver.Parser.getMessageElements().length > 0;
  },

  async exportSelectedMessages(conversation, formats = { html: true, md: true, json: true }) {
    const ready = await this._ensureFolderReady();
    if (!ready.ready) return { success: false, error: ready.error || '检测到未设置或已失效的保存文件夹', folderState: ready.folderState || null };

    const fileSystem = window.ChatGPTSaver.FileSystem;
    const logger = window.ChatGPTSaver?.Logger;
    const quotaManager = window.ChatGPTSaver?.FeatureQuotaManager;
    if (logger && !logger.panelVisible) {
      logger.clear();
      logger.showPanel();
    }

    let effectiveFormats = {
      html: formats?.html !== false,
      md: formats?.md !== false,
      pdf: false,
      json: formats?.json !== false
    };
    if (quotaManager?.applyExportFormats) {
      const applied = await quotaManager.applyExportFormats(effectiveFormats);
      effectiveFormats = applied.formats;
    }

    try {
      let htmlContent = null;
      let mdContent = null;
      let jsonContent = null;
      if (effectiveFormats.json && window.ChatGPTSaver.JSONExporter) {
        const data = window.ChatGPTSaver.JSONExporter.exportFromConversation({
          title: conversation.title,
          workspace: window.ChatGPTSaver.Parser.getWorkspaceName(),
          url: location.href,
          messages: conversation.messages
        });
        if (data) jsonContent = window.ChatGPTSaver.JSONExporter.serialize(data);
      }
      if (effectiveFormats.html && window.ChatGPTSaver.HTMLExporter) {
        htmlContent = window.ChatGPTSaver.HTMLExporter.exportFromMessages(conversation.messages, conversation.title);
      }
      if (effectiveFormats.md && window.ChatGPTSaver.MarkdownExporter) {
        mdContent = window.ChatGPTSaver.MarkdownExporter.exportFromMessages(conversation.messages, conversation.title);
      }

      const result = await fileSystem.saveConversation(
        conversation.title,
        htmlContent,
        mdContent,
        null,
        effectiveFormats,
        window.ChatGPTSaver.Parser.getWorkspaceName(),
        jsonContent
      );
      if (result.success && quotaManager?.consumeExportFormats) {
        await quotaManager.consumeExportFormats(result.saved || []);
      }
      window.ChatGPTSaver?.UI?.refreshFeatureQuotaIndicators?.();
      if (result.success && logger) logger.complete('保存成功', `「${result.title}」已保存`);
      return { ...result, folderState: ready.folderState || null };
    } catch (error) {
      if (logger) logger.fail(error.message);
      return { success: false, error: error.message, folderState: ready.folderState || null };
    }
  }
};

window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.Exporter = Exporter;
