
console.log("Background script loaded");
importScripts(chrome.runtime.getURL('sources/api/salem.js'))
chrome.runtime.onInstalled.addListener(registerContextualMenu)
chrome.action.onClicked.addListener(createPopup)

let viewerId = null

async function createPopup(tab) {
    let storage = await Salem.core.mem.get()
    if (!tab) return;
    let params = {
        url: chrome.runtime.getURL(`sources/popup/index/index.html?tabId=${tab.id}`),
        type: "panel",
        height: 800,
        width: 900,
        left: (storage && storage.login && storage.login.config) ? (storage.login.config.positionX ? parseInt(storage.login.config.positionX) : null) : null,
        top: (storage && storage.login && storage.login.config) ? (storage.login.config.positionY ? parseInt(storage.login.config.positionY) : null) : null
    }

    let allTabs = await chrome.tabs.query({})
    let thisUrl = chrome.runtime.getURL('');
    for (let thisTab of allTabs) {
        if (thisTab.url.includes(thisUrl)) {            
            // Verificar si cambió la tab padre
            if (!thisTab.url.includes(tab.id)) chrome.tabs.update(thisTab.id, { url: params.url });
            chrome.windows.update(thisTab.windowId, { focused: true });
            return
        }
    }

    function openInDefaultPosition() {
        params.left = undefined;
        params.top = undefined;
        chrome.windows.create(params);
    }

    try {
        chrome.windows.create(params, function (window) {
            if (typeof window == 'undefined') {
                openInDefaultPosition()
            }
        });
    } catch (error) {
        openInDefaultPosition()
    }
}

function registerContextualMenu() {
    chrome.contextMenus.create({
        id: "ver_ticket",
        title: "Ver ticket",
        contexts: ["selection" , "page" , "link"]
    })
}

// Escuchar por click realizados en menú contextual
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId) {
        if (info.menuItemId == 'ver_ticket') {
            let windowId = null
            let allWindows = await chrome.windows.getAll()
            if (allWindows.length >= 2) {
                let toOpenIn = allWindows.find(u => u.focused == false) 
                windowId = toOpenIn.id
            }
            chrome.tabs.create({ url: `${Salem.rules.routes.otrs}?Action=AgentTicketZoom;TicketNumber=${info.selectionText}`, windowId: windowId })
        }
    }
})

function emit(config) {
    return new Promise(async resolve => {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        let res = await chrome.tabs.sendMessage(tab.id, config)
        resolve(res)
    })
}