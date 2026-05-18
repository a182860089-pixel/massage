/**
 * DOM 监听器 - 使用 MutationObserver 监听 GPT 回复完成
 */

const ConversationObserver = {
  observer: null,
  debounceTimer: null,
  containerCheckTimer: null,
  containerCheckExpireTimer: null,
  previousHash: null,
  isWatching: false,
  debounceDelay: 3000, // 防抖延迟 3 秒，确保回复完成
  typingCheckDelay: 1000, // 检查打字状态的间隔
  onCompleteCallback: null,
  lastMessageCount: 0,
  
  /**
   * 开始监听
   */
  start(onComplete) {
    // 如果已经在监听，先停止
    if (this.isWatching) {
      console.log('重置现有监听器...');
      this.stop();
    }
    
    this.onCompleteCallback = onComplete;
    this.previousHash = null; // 重置 hash
    this.lastMessageCount = 0; // 重置消息计数
    
    // 获取对话容器
    const container = window.ChatGPTSaver.Parser.getConversationContainer();
    if (!container) {
      console.warn('未找到对话容器，等待页面加载...');
      this.waitForContainer();
      return;
    }
    
    this.setupObserver(container);
  },
  
  /**
   * 等待容器加载
   */
  waitForContainer() {
    // 先清掉可能残留的旧 polling，保证幂等
    if (this.containerCheckTimer) {
      clearInterval(this.containerCheckTimer);
      this.containerCheckTimer = null;
    }
    if (this.containerCheckExpireTimer) {
      clearTimeout(this.containerCheckExpireTimer);
      this.containerCheckExpireTimer = null;
    }

    this.containerCheckTimer = setInterval(() => {
      const container = window.ChatGPTSaver.Parser.getConversationContainer();
      if (container) {
        clearInterval(this.containerCheckTimer);
        this.containerCheckTimer = null;
        if (this.containerCheckExpireTimer) {
          clearTimeout(this.containerCheckExpireTimer);
          this.containerCheckExpireTimer = null;
        }
        this.setupObserver(container);
      }
    }, 500);

    // 30 秒后停止检查
    this.containerCheckExpireTimer = setTimeout(() => {
      if (this.containerCheckTimer) {
        clearInterval(this.containerCheckTimer);
        this.containerCheckTimer = null;
      }
      this.containerCheckExpireTimer = null;
    }, 30000);
  },
  
  /**
   * 设置 MutationObserver
   */
  setupObserver(container) {
    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });
    
    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    this.isWatching = true;
    console.log('ChatGPT 对话监听已启动');
    
    // 切换对话时，立即检查并保存已有内容
    this.performInitialSave();
  },
  
  /**
   * 执行初始保存（切换对话时保存已有内容）
   */
  performInitialSave() {
    // 稍微延迟，确保页面完全加载
    setTimeout(() => {
      // 检查是否有内容
      const messages = window.ChatGPTSaver.Parser.getMessageElements();
      if (messages.length < 2) {
        console.log('初始保存: 消息数量不足，跳过');
        return;
      }
      
      // 检查 GPT 是否正在输入
      if (window.ChatGPTSaver.Parser.isGPTTyping()) {
        console.log('初始保存: GPT 正在输入，等待完成后再保存');
        return;
      }
      
      const currentHash = window.ChatGPTSaver.Parser.getContentHash();
      const currentMessageCount = messages.length;
      
      // 记录当前状态
      this.previousHash = currentHash;
      this.lastMessageCount = currentMessageCount;
      
      console.log(`初始保存: 检测到 ${currentMessageCount} 条消息，触发保存...`);
      
      // 触发保存回调
      if (this.onCompleteCallback) {
        this.onCompleteCallback();
      }
    }, 1000);
  },
  
  /**
   * 处理 DOM 变化
   */
  handleMutations(mutations) {
    // 检查是否有实际内容变化
    const hasContentChange = mutations.some(mutation => {
      return mutation.type === 'childList' && mutation.addedNodes.length > 0;
    });
    
    if (!hasContentChange) {
      return;
    }
    
    // 清除之前的防抖定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // 检查 GPT 是否正在输入
    if (window.ChatGPTSaver.Parser.isGPTTyping()) {
      // 如果正在输入，设置一个较短的定时器继续检查
      this.debounceTimer = setTimeout(() => {
        this.checkForCompletion();
      }, 500);
      return;
    }
    
    // GPT 不在输入，使用正常的防抖延迟
    this.debounceTimer = setTimeout(() => {
      this.checkForCompletion();
    }, this.debounceDelay);
  },
  
  /**
   * 检查回复是否完成
   */
  checkForCompletion() {
    // 如果还在输入，继续等待
    if (window.ChatGPTSaver.Parser.isGPTTyping()) {
      console.log('GPT 正在输入，等待...');
      this.debounceTimer = setTimeout(() => {
        this.checkForCompletion();
      }, this.typingCheckDelay);
      return;
    }
    
    // 再等待一下确保真的完成了
    setTimeout(() => {
      // 再次检查是否真的停止了
      if (window.ChatGPTSaver.Parser.isGPTTyping()) {
        this.debounceTimer = setTimeout(() => {
          this.checkForCompletion();
        }, this.typingCheckDelay);
        return;
      }
      
      // 获取当前消息数量
      const currentMessageCount = window.ChatGPTSaver.Parser.getMessageElements().length;
      
      // 检查内容是否有变化
      const currentHash = window.ChatGPTSaver.Parser.getContentHash();
      
      // 只有当消息数量增加或内容变化时才保存
      if (currentHash === this.previousHash && currentMessageCount === this.lastMessageCount) {
        console.log('内容未变化，跳过保存');
        return;
      }
      
      this.previousHash = currentHash;
      this.lastMessageCount = currentMessageCount;
      
      // 确保有足够的内容
      const messages = window.ChatGPTSaver.Parser.getMessageElements();
      if (messages.length < 2) {
        console.log('消息数量不足，跳过保存');
        return;
      }
      
      // 触发回调
      if (this.onCompleteCallback) {
        console.log(`检测到回复完成，共 ${currentMessageCount} 条消息，触发保存...`);
        this.onCompleteCallback();
      }
    }, 2000); // 再等 2 秒确保完全完成
  },
  
  /**
   * 停止监听
   */
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 确保 waitForContainer 的 polling/expiry 不会在 stop 之后再触发 setupObserver
    if (this.containerCheckTimer) {
      clearInterval(this.containerCheckTimer);
      this.containerCheckTimer = null;
    }
    if (this.containerCheckExpireTimer) {
      clearTimeout(this.containerCheckExpireTimer);
      this.containerCheckExpireTimer = null;
    }
    
    this.isWatching = false;
    this.previousHash = null;
    this.lastMessageCount = 0;
    console.log('ChatGPT 对话监听已停止');
  },
  
  /**
   * 重置状态（用于切换对话时）
   */
  reset() {
    this.previousHash = null;
    this.lastMessageCount = 0;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  },
  
  /**
   * 检查是否正在监听
   */
  isActive() {
    return this.isWatching;
  }
};

// URL 变化监听（用于检测对话切换）
const URLObserver = {
  lastURL: null,
  onChangeCallback: null,
  _started: false,
  _popstateListener: null,
  _mutationObserver: null,
  _pollTimer: null,

  /**
   * 开始监听 URL 变化
   *
   * 幂等：第二次调用时会先 stop 掉之前注册的所有副作用，
   * 避免在 SPA 重入场景下叠加 popstate listener / MutationObserver / setInterval。
   */
  start(onChange) {
    if (this._started) {
      this.stop();
    }
    this.lastURL = window.location.href;
    this.onChangeCallback = onChange;

    this._popstateListener = () => this.checkURLChange();
    window.addEventListener('popstate', this._popstateListener);

    this._mutationObserver = new MutationObserver(() => this.checkURLChange());
    this._mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    this._pollTimer = setInterval(() => this.checkURLChange(), 1000);
    this._started = true;
  },

  /**
   * 停止监听并释放所有资源
   */
  stop() {
    if (this._popstateListener) {
      try { window.removeEventListener('popstate', this._popstateListener); } catch {}
      this._popstateListener = null;
    }
    if (this._mutationObserver) {
      try { this._mutationObserver.disconnect(); } catch {}
      this._mutationObserver = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._started = false;
  },

  /**
   * 检查 URL 是否变化
   */
  checkURLChange() {
    if (typeof window === 'undefined' || !window.location) return;
    const currentURL = window.location.href;
    if (currentURL !== this.lastURL) {
      this.lastURL = currentURL;
      if (this.onChangeCallback) {
        this.onChangeCallback(currentURL);
      }
    }
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.Observer = ConversationObserver;
window.ChatGPTSaver.URLObserver = URLObserver;
