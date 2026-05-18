// Background Worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('ChatGPT Saver Extension Installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sendResponse);
    return true;
});

async function handleMessage(request, sendResponse) {
    try {
        switch (request.action) {
            case 'pluginActivateCardKey':
                await handlePluginCardKeyRequest('/api/plugin/card-keys/activate', request, sendResponse);
                break;
            case 'pluginCheckCardKeyStatus':
                await handlePluginCardKeyRequest('/api/plugin/card-keys/status', request, sendResponse);
                break;
            case 'pluginRebindCardKey':
                await handlePluginCardKeyRequest('/api/plugin/card-keys/rebind', request, sendResponse);
                break;
            default:
                sendResponse({ success: false, message: '未知操作', data: { authorized: false } });
        }
    } catch (error) {
        sendResponse({ success: false, message: error.message, data: { authorized: false } });
    }
}

async function handlePluginCardKeyRequest(path, request, sendResponse) {
    try {
        const resp = await fetch('https://seat.20050225.xyz' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                card_key: request.card_key,
                email: request.email,
                client_id: request.client_id
            })
        });
        const json = await resp.json();
        sendResponse(json);
    } catch (e) {
        sendResponse({
            success: false,
            message: '网络错误: ' + e.message,
            data: { authorized: false }
        });
    }
}
