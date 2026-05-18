(function () {
    const pendingRuntimeRequests = new Map();

    // Load config from storage
    chrome.storage.local.get(null, (items) => {
        const config = items || {};

        // Inject config
        const configScript = document.createElement('script');
        configScript.textContent = `window.__SAVER_CONFIG = ${JSON.stringify(config)};`;
        (document.head || document.documentElement).appendChild(configScript);
        configScript.remove();

        // Inject core script
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/core.js');
        script.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    });

    // Listen for config updates
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;

        if (event.data && event.data.type === 'SAVER_UPDATE_CONFIG') {
            const { key, value } = event.data;
            const update = {};
            update[key] = value;
            chrome.storage.local.set(update);
            return;
        }

        if (event.data && event.data.type === 'SAVER_RUNTIME_REQUEST') {
            const { requestId, action, payload } = event.data;
            if (!requestId || !action || pendingRuntimeRequests.has(requestId)) return;

            pendingRuntimeRequests.set(requestId, true);
            chrome.runtime.sendMessage(
                { action, ...(payload || {}) },
                (response) => {
                    pendingRuntimeRequests.delete(requestId);
                    window.postMessage(
                        {
                            type: 'SAVER_RUNTIME_RESPONSE',
                            requestId,
                            response: response || { success: false, message: '空响应', data: { authorized: false } }
                        },
                        '*'
                    );
                }
            );
        }
    });
})();
