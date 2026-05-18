/**
 * CoreExporter：以 ConversationModel 为唯一真相源的导出编排。
 *
 * 与 src/utils/exporter.js 的 Exporter（platform 强耦合的旧入口）共存：
 *  - 旧 Exporter 仍服务于 popup -> exportNow -> ChatGPT 路径，保持向后兼容
 *  - CoreExporter 提供「从规范模型导出」的入口，给批量导出 / Gemini 后续 adapter 复用
 *
 * 注意：本模块不直接写文件系统，写盘仍走 window.ChatGPTSaver.FileSystem.saveConversation。
 */

const CoreExporter = {
  /**
   * 把一份规范 ConversationModel 导成 {html, md, json, pdf?}。
   * 不写盘，仅产出字符串/blob。
   *
   * @param {Object} model
   * @param {{html?:boolean, md?:boolean, pdf?:boolean, json?:boolean}} formats
   * @param {{pdfMode?:'auto'|'visual'|'structured'}} options
   */
  async exportToBlobs(model, formats = {}, options = {}) {
    if (!model || !Array.isArray(model.messages) || !model.messages.length) {
      return { success: false, error: 'empty_model' };
    }
    const Model = window.ChatGPTSaver?.ConversationModel;
    const legacy = Model?.modelToLegacyConversation ? Model.modelToLegacyConversation(model) : null;
    if (!legacy) return { success: false, error: 'normalize_failed' };

    const out = {};
    try {
      if (formats.html !== false) {
        const HTMLExporter = window.ChatGPTSaver?.HTMLExporter;
        if (HTMLExporter?.exportConversation) {
          out.html = HTMLExporter.exportConversation(legacy);
        }
      }
      if (formats.md !== false) {
        const MdExporter = window.ChatGPTSaver?.MarkdownExporter;
        if (MdExporter?.exportFromConversation) {
          out.md = MdExporter.exportFromConversation(legacy);
        } else if (MdExporter?.export) {
          out.md = MdExporter.export();
        }
      }
      if (formats.json !== false) {
        const JSONExporter = window.ChatGPTSaver?.JSONExporter;
        if (JSONExporter?.exportFromConversation) {
          const obj = JSONExporter.exportFromConversation(legacy);
          out.json = obj ? (JSONExporter.serialize ? JSONExporter.serialize(obj) : JSON.stringify(obj, null, 2)) : null;
        }
      }
      if (formats.pdf !== false) {
        const PDFExporter = window.ChatGPTSaver?.PDFExporter;
        if (PDFExporter?.exportPackage) {
          out.pdf = await PDFExporter.exportPackage({
            mode: options.pdfMode || 'auto',
            conversation: legacy,
            workspaceName: model.workspaceName || ''
          });
        }
      }
      return { success: true, blobs: out };
    } catch (e) {
      return { success: false, error: e?.message || 'export_failed' };
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CoreExporter };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.CoreExporter = CoreExporter;
}
