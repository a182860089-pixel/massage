/**
 * 文件系统工具 - 使用 File System Access API
 */

const FileSystemManager = {
  // 存储目录句柄
  rootHandle: null,
  backupFolderName: 'ChatGPT-Backup',
  dbName: 'ChatGPTSaverDB',
  storeName: 'fileHandles',
  
  /**
   * 检查浏览器是否支持 File System Access API
   */
  isFileSystemAccessSupported() {
    return typeof window.showDirectoryPicker === 'function';
  },
  
  /**
   * 获取不支持的原因（用于显示给用户）
   */
  getUnsupportedReason() {
    if (!window.isSecureContext) {
      return '当前页面不是安全上下文(HTTPS)，无法使用文件系统API';
    }
    if (typeof window.showDirectoryPicker !== 'function') {
      return '当前浏览器不支持文件系统API，请使用最新版Chrome/Edge浏览器';
    }
    return null;
  },
  
  /**
   * 请求文件夹访问权限
   */
  async requestFolderAccess() {
    // 先检查 API 支持
    if (!this.isFileSystemAccessSupported()) {
      const reason = this.getUnsupportedReason();
      console.warn('File System Access API 不支持:', reason);
      return { success: false, error: reason, unsupported: true };
    }
    try {
      // 请求用户选择文件夹
      this.rootHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents'
      });
      
      // 创建备份根目录
      await this.getOrCreateFolder(this.rootHandle, this.backupFolderName);
      
      // 保存句柄到 IndexedDB（用于持久化）
      await this.saveHandleToIndexedDB(this.rootHandle);
      
      return {
        success: true,
        folderName: this.rootHandle.name
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: '用户取消了选择' };
      }
      console.error('文件夹访问请求失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * 保存句柄到 IndexedDB
   */
  async saveHandleToIndexedDB(handle) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => reject(request.error);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put(handle, 'rootHandle');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  },
  
  /**
   * 从 IndexedDB 恢复句柄
   */
  async restoreHandleFromIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => resolve(null);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const getRequest = store.get('rootHandle');
        
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => resolve(null);
      };
    });
  },
  
  /**
   * 尝试恢复授权
   */
  async tryRestoreAccess() {
    // 先检查 API 支持
    if (!this.isFileSystemAccessSupported()) {
      console.log('File System Access API 不支持，跳过权限恢复');
      return false;
    }
    
    try {
      const handle = await this.restoreHandleFromIndexedDB();
      if (!handle) {
        console.log('未找到已保存的文件夹授权');
        return false;
      }
      
      // 验证权限 - 使用 try-catch 防止 handle 无效
      let permission;
      try {
        permission = await handle.queryPermission({ mode: 'readwrite' });
      } catch (permError) {
        console.log('文件夹句柄已失效，需要重新授权');
        // 清除失效的句柄
        await this.clearSavedHandle();
        return false;
      }
      
      if (permission === 'granted') {
        // 进一步验证句柄是否真的可用
        try {
          await handle.getDirectoryHandle(this.backupFolderName, { create: true });
          this.rootHandle = handle;
          console.log('✅ 已恢复文件夹访问权限');
          return true;
        } catch (accessError) {
          console.log('文件夹访问失败，可能已被删除或移动，需要重新授权');
          await this.clearSavedHandle();
          return false;
        }
      }
      
      // 权限不是 granted，需要用户交互才能重新获取
      console.log('文件夹权限已过期，需要重新授权');
      return false;
    } catch (error) {
      // 静默失败，不要在控制台输出红色错误
      console.log('文件夹权限恢复失败，需要重新授权:', error.message);
      return false;
    }
  },
  
  /**
   * 清除已保存的句柄（当句柄失效时调用）
   */
  async clearSavedHandle() {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => resolve();
      request.onsuccess = (event) => {
        try {
          const db = event.target.result;
          const tx = db.transaction(this.storeName, 'readwrite');
          const store = tx.objectStore(this.storeName);
          store.delete('rootHandle');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch (e) {
          resolve();
        }
      };
    });
  },
  
  /**
   * 检查是否已授权
   */
  isAuthorized() {
    return this.rootHandle !== null;
  },

  /**
   * 获取备份根目录句柄
   */
  async getBackupRootHandle() {
    if (!this.rootHandle) return null;
    try {
      return await this.rootHandle.getDirectoryHandle(this.backupFolderName, { create: false });
    } catch (e) { return null; }
  },
  
  /**
   * 获取或创建文件夹
   */
  async getOrCreateFolder(parentHandle, folderName) {
    try {
      return await parentHandle.getDirectoryHandle(folderName, { create: true });
    } catch (error) {
      console.error('创建文件夹失败:', error);
      throw error;
    }
  },
  
  /**
   * 清理文件名中的非法字符
   */
  sanitizeFileName(name) {
    // Windows 非法字符: / \ : * ? " < > |
    return name
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100); // 限制长度
  },
  
  /**
   * 生成时间戳
   */
  getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}${second}`;
  },
  
  /**
   * 检查文件夹是否存在
   */
  async folderExists(parentHandle, folderName) {
    try {
      await parentHandle.getDirectoryHandle(folderName, { create: false });
      return true;
    } catch {
      return false;
    }
  },
  
  /**
   * 检查对话是否需要更新（比较消息数量）
   */
  async checkConversationNeedsUpdate(conversationTitle, workspaceName, currentMessageCount) {
    if (!this.rootHandle) return { needsUpdate: true, reason: 'no_handle', savedCount: 0 };
    try {
      const sanitizedTitle = this.sanitizeFileName(conversationTitle);
      const backupRoot = await this.rootHandle.getDirectoryHandle(this.backupFolderName, { create: false });
      let parentFolder = backupRoot;
      if (workspaceName) {
        const sanitizedWorkspace = this.sanitizeFileName(workspaceName);
        try { parentFolder = await backupRoot.getDirectoryHandle(sanitizedWorkspace, { create: false }); }
        catch (e) { return { needsUpdate: true, reason: 'new', savedCount: 0 }; }
      }
      let conversationFolder;
      try { conversationFolder = await parentFolder.getDirectoryHandle(sanitizedTitle, { create: false }); }
      catch (e) { return { needsUpdate: true, reason: 'new', savedCount: 0 }; }
      // 尝试读取已保存的 HTML 文件来获取消息数
      let savedMessageCount = 0;
      try {
        const htmlFolder = await conversationFolder.getDirectoryHandle('html', { create: false });
        const fileHandle = await htmlFolder.getFileHandle(`${sanitizedTitle}.html`, { create: false });
        const file = await fileHandle.getFile();
        const htmlContent = await file.text();
        const match = htmlContent.match(/共\s*(\d+)\s*条消息/);
        savedMessageCount = match ? parseInt(match[1], 10) : 0;
      } catch (e) {
        return { needsUpdate: true, reason: 'no_html', savedCount: 0 };
      }
      if (currentMessageCount > savedMessageCount) {
        return { needsUpdate: true, reason: 'updated', savedCount: savedMessageCount, currentCount: currentMessageCount };
      }
      const path = workspaceName ? `${this.sanitizeFileName(workspaceName)}/${sanitizedTitle}` : sanitizedTitle;
      return { needsUpdate: false, reason: 'unchanged', savedCount: savedMessageCount, currentCount: currentMessageCount, path };
    } catch (e) {
      return { needsUpdate: true, reason: 'error', savedCount: 0 };
    }
  },

  /**
   * 为对话创建保存目录结构
   * 结构: ChatGPT-Backup/工作空间/对话标题/html, md, pdf
   * 同一对话会覆盖更新，而不是创建新文件夹
   */
  async createConversationFolders(conversationTitle, workspaceName = null) {
    if (!this.rootHandle) {
      throw new Error('未授权文件夹访问');
    }
    
    const sanitizedTitle = this.sanitizeFileName(conversationTitle);
    const backupRoot = await this.getOrCreateFolder(this.rootHandle, this.backupFolderName);
    
    // 如果有工作空间名称，先创建工作空间文件夹
    let parentFolder = backupRoot;
    if (workspaceName) {
      const sanitizedWorkspace = this.sanitizeFileName(workspaceName);
      parentFolder = await this.getOrCreateFolder(backupRoot, sanitizedWorkspace);
      console.log(`使用工作空间文件夹: ${sanitizedWorkspace}`);
    }
    
    // 直接使用对话标题作为文件夹名，已存在则复用（覆盖更新）
    const folderName = sanitizedTitle;
    
    // 创建或获取对话文件夹
    const conversationFolder = await this.getOrCreateFolder(parentFolder, folderName);
    
    // 创建子文件夹
    const htmlFolder = await this.getOrCreateFolder(conversationFolder, 'html');
    const mdFolder = await this.getOrCreateFolder(conversationFolder, 'md');
    const pdfFolder = await this.getOrCreateFolder(conversationFolder, 'pdf');
    const jsonFolder = await this.getOrCreateFolder(conversationFolder, 'json');
    
    return {
      root: conversationFolder,
      html: htmlFolder,
      md: mdFolder,
      pdf: pdfFolder,
      json: jsonFolder,
      title: sanitizedTitle,
      folderName: folderName,
      workspaceName: workspaceName
    };
  },
  
  /**
   * 写入文件
   */
  async writeFile(folderHandle, fileName, content, type = 'text/plain') {
    try {
      const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      
      if (content instanceof Blob) {
        await writable.write(content);
      } else {
        await writable.write(new Blob([content], { type }));
      }
      
      await writable.close();
      return true;
    } catch (error) {
      console.error('写入文件失败:', error);
      throw error;
    }
  },
  
  /**
   * 保存对话到所有格式
   * @param {string} conversationTitle - 对话标题
   * @param {string} htmlContent - HTML 内容
   * @param {string} mdContent - Markdown 内容
   * @param {Blob} pdfBlob - PDF Blob
   * @param {Object} formats - 导出格式配置
   * @param {string} workspaceName - 工作空间名称（可选）
   */
  async saveConversation(conversationTitle, htmlContent, mdContent, pdfBlob, formats = { html: true, md: true, pdf: true }, workspaceName = null, jsonContent = null) {
    try {
      const folders = await this.createConversationFolders(conversationTitle, workspaceName);
      const fileName = folders.title;
      
      const results = {
        success: true,
        saved: []
      };
      
      // 保存 HTML
      if (formats.html && htmlContent) {
        await this.writeFile(folders.html, `${fileName}.html`, htmlContent, 'text/html');
        results.saved.push('html');
      }
      
      // 保存 Markdown
      if (formats.md && mdContent) {
        await this.writeFile(folders.md, `${fileName}.md`, mdContent, 'text/markdown');
        results.saved.push('md');
      }
      
      // 保存 PDF
      if (formats.pdf && pdfBlob) {
        await this.writeFile(folders.pdf, `${fileName}.pdf`, pdfBlob, 'application/pdf');
        results.saved.push('pdf');
      }
      
      // 保存 JSON
      if (formats.json && jsonContent) {
        await this.writeFile(folders.json, `${fileName}.json`, jsonContent, 'application/json');
        results.saved.push('json');
      }
      
      results.title = folders.title;
      results.folderName = folders.folderName;
      results.workspaceName = folders.workspaceName;
      return results;
    } catch (error) {
      console.error('保存对话失败:', error);
      return { success: false, error: error.message };
    }
  }
};

// 降级方案：使用 chrome.downloads API
const DownloadFallback = {
  /**
   * 通过下载保存文件
   */
  async saveViaDownload(fileName, content, mimeType) {
    return new Promise((resolve, reject) => {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      chrome.runtime.sendMessage({
        action: 'download',
        url: url,
        filename: fileName
      }, (response) => {
        URL.revokeObjectURL(url);
        if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || '下载失败'));
        }
      });
    });
  },
  
  /**
   * 保存对话（降级方案）
   */
  async saveConversation(conversationTitle, htmlContent, mdContent, pdfBlob, formats = { html: true, md: true, pdf: true }) {
    const sanitizedTitle = FileSystemManager.sanitizeFileName(conversationTitle);
    const timestamp = FileSystemManager.getTimestamp();
    const basePath = `ChatGPT-Backup/${sanitizedTitle}_${timestamp}`;
    
    const results = {
      success: true,
      saved: [],
      title: sanitizedTitle
    };
    
    try {
      if (formats.html && htmlContent) {
        await this.saveViaDownload(`${basePath}/html/${sanitizedTitle}.html`, htmlContent, 'text/html');
        results.saved.push('html');
      }
      
      if (formats.md && mdContent) {
        await this.saveViaDownload(`${basePath}/md/${sanitizedTitle}.md`, mdContent, 'text/markdown');
        results.saved.push('md');
      }
      
      if (formats.pdf && pdfBlob) {
        await this.saveViaDownload(`${basePath}/pdf/${sanitizedTitle}.pdf`, pdfBlob, 'application/pdf');
        results.saved.push('pdf');
      }
      
      return results;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// 导出统一接口
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.FileSystem = FileSystemManager;
window.ChatGPTSaver.DownloadFallback = DownloadFallback;
