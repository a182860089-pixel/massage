// ==UserScript==
// @name         ChatGPT 沙盒文件直链修复器 (终极版)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  利用 React 内部状态树，彻底解决任意格式的无名沙盒附件提取
// @author       ChatGPT Assistant
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let accessToken = '';
    const MAX_RETRY_COUNT = 3;
    const RETRY_DELAY_MS = 800;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 取 Token
    async function fetchToken() {
        if (accessToken) return accessToken;
        try {
            const res = await fetch('/api/auth/session');
            const data = await res.json();
            accessToken = data.accessToken;
            return accessToken;
        } catch (e) { }
    }

    // 取会话 ID (兼容 /c/xxxx 甚至纯 UUID)
    function getConversationId() {
        const match = window.location.pathname.match(/\/(?:c|g|conversation)\/([a-zA-Z0-9\-]+)/);
        if (match) return match[1];
        // 如果上面没匹配到，尝试在全文找 UUID (通常是 36 位的 uuid v4)
        const uuidMatch = window.location.pathname.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
        return uuidMatch ? uuidMatch[0] : null;
    }

    // 取真实下载直链
    async function reqRealUrl(messageId, sandboxPath) {
        const token = await fetchToken();
        const convId = getConversationId();
        if (!convId) return null;

        const path = encodeURIComponent(sandboxPath);
        const url = `/backend-api/conversation/${convId}/interpreter/download?message_id=${messageId}&sandbox_path=${path}`;

        try {
            const res = await fetch(url, { headers: { "authorization": `Bearer ${token}` } });
            const data = await res.json();
            if (data && data.status === "success") return data.download_url;
        } catch (e) { }
        return null;
    }

    function findMessageId(domNode) {
        let msgNode = domNode;
        while (msgNode && msgNode !== document.body) {
            if (msgNode.hasAttribute('data-message-id')) {
                return msgNode.getAttribute('data-message-id');
            }
            msgNode = msgNode.parentElement;
        }
        return null;
    }

    async function findMessageIdWithRetry(domNode, maxRetries = MAX_RETRY_COUNT) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const messageId = findMessageId(domNode);
            if (messageId) return messageId;
            if (attempt < maxRetries) {
                await sleep(RETRY_DELAY_MS);
            }
        }
        return null;
    }

    // 核心黑科技：通过随便一个 DOM 节点往上找 React Fiber 的底层 props，从而拿到这段话的真实 Markdown 原文
    function findSandboxPathFromReact(domNode) {
        try {
            // 找到元素绑定的 react fiber key (例如 __reactFiber$a1b2c3d)
            const fiberKey = Object.keys(domNode).find(key => key.startsWith('__reactFiber$'));
            if (!fiberKey) return null;

            let curr = domNode[fiberKey];
            // 向上遍历 Fiber 树，最多找 20 层，寻找带有 children (作为 markdown 字符串) 的节点
            let depth = 0;
            while (curr && depth < 20) {
                if (curr.memoizedProps) {
                    // 很多时候 Markdown 的原始文本就存在这个节点或者某层父节点的孩子属性里
                    const props = curr.memoizedProps;
                    // 如果存在原始 markdown 文本
                    if (typeof props.children === 'string' && props.children.includes('sandbox:/mnt/data')) {
                        // 取出类似 [文本](sandbox:/mnt/data/真实名字.md)
                        const match = props.children.match(/sandbox:(\/mnt\/data\/[a-zA-Z0-9_\-\.\u4e00-\u9fa5\s]+)/);
                        if (match) return match[1];
                    }
                    if (props.node && props.node.value && typeof props.node.value === 'string' && props.node.value.includes('sandbox:/mnt/data')) {
                        const match = props.node.value.match(/sandbox:(\/mnt\/data\/[a-zA-Z0-9_\-\.\u4e00-\u9fa5\s]+)/);
                        if (match) return match[1];
                    }
                }
                curr = curr.return;
                depth++;
            }
        } catch (e) {
            console.error("React树探测失败", e);
        }
        return null;
    }

    function resolveSandboxPath(btn, textContent) {
        const parentNode = btn.parentNode;
        const grandParentNode = parentNode ? parentNode.parentNode : null;

        let sandboxPath = findSandboxPathFromReact(btn) ||
            (parentNode ? findSandboxPathFromReact(parentNode) : null) ||
            (grandParentNode ? findSandboxPathFromReact(grandParentNode) : null);

        if (sandboxPath) {
            try {
                sandboxPath = decodeURIComponent(sandboxPath);
            } catch (e) { }
            return sandboxPath;
        }

        const backupExtMatch = textContent.match(/(MD|TXT|CSV|PDF|Word|Excel|XLSX|DOCX|ZIP)/i);
        let ext = "txt";
        if (backupExtMatch) {
            ext = backupExtMatch[1].toLowerCase();
            if (ext === "word") ext = "docx";
            if (ext === "excel") ext = "xlsx";
        }
        return `/mnt/data/output.${ext}`;
    }

    // 查找并处理按钮
    function processButtons() {
        const buttons = document.querySelectorAll([
            '.markdown button.behavior-btn:not([data-link-extracted])',
            'span[data-state] button.behavior-btn:not([data-link-extracted])'
        ].join(', '));

        buttons.forEach(async (btn) => {
            const textContent = (btn.dataset.originalText || btn.innerText || '').trim();
            btn.dataset.originalText = textContent;
            // 扩大识别范围：即使没有直接说"下载"，只要带下列文件关键词的独立小按钮也全部捕获
            const isDownloadBtn = textContent.includes("下载") ||
                textContent.includes("Download") ||
                textContent.includes("download") ||
                /文件|文档|Document|File|Word|Excel|CSV|PDF|MD|TXT|DOCX|XLSX|ZIP/i.test(textContent) ||
                /\.(docx?|xlsx?|csv|pdf|md|txt|zip)$/i.test(textContent);

            if (isDownloadBtn) {
                btn.setAttribute('data-link-extracted', 'true');
                btn.style.opacity = '0.5';
                btn.innerText = `${textContent} (准备中...)`;

                const messageId = await findMessageIdWithRetry(btn);
                if (!messageId) {
                    btn.style.opacity = '1';
                    btn.innerText = `${textContent} [已重试3次，消息ID仍未就绪]`;
                    btn.style.color = "#ef4444";
                    console.error("未能在此按钮的祖级元素中找到 message_id 属性", btn);
                    return;
                }

                let realUrl = null;
                for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
                    btn.innerText = attempt === 1
                        ? `${textContent} (破解路径中...)`
                        : `${textContent} (第${attempt}次重试中...)`;

                    const sandboxPath = resolveSandboxPath(btn, textContent);
                    realUrl = await reqRealUrl(messageId, sandboxPath);
                    if (realUrl) break;

                    if (attempt < MAX_RETRY_COUNT) {
                        await sleep(RETRY_DELAY_MS);
                    }
                }

                if (realUrl) {
                    const aTag = document.createElement('a');
                    aTag.href = realUrl;
                    aTag.target = "_blank";
                    aTag.className = btn.className;
                    aTag.innerText = textContent;
                    aTag.style.color = "#10a37f"; // 绿色激活态
                    aTag.style.textDecoration = 'underline';
                    aTag.setAttribute('download', '');
                    btn.parentNode.replaceChild(aTag, btn);
                } else {
                    btn.style.opacity = '1';
                    btn.innerText = `${textContent} [已重试3次，路径或权限错误]`;
                    btn.style.color = "#ef4444";
                }
            }
        });
    }

    // 监听 DOM 变化
    const observer = new MutationObserver(() => {
        processButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
