// Background service worker — orchestrates message sending
// Navigation happens here; content script only does DOM work.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Bulk WhatsApp Sender extension installed");
});

// ── Message handler from popup ─────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendMessage") {
    orchestrateSend(request)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async
  }
});

async function orchestrateSend({ phone, message, attachment }) {
  // Find the WhatsApp Web tab
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs.length === 0) {
    throw new Error("WhatsApp Web tab not found. Open it first.");
  }
  const tabId = tabs[0].id;

  // Build the URL — include &text= only for text-only messages
  let chatUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
  if (message && !attachment) {
    chatUrl += `&text=${encodeURIComponent(message)}`;
  }

  // Navigate the tab (this triggers a page load + fresh content script injection)
  await chrome.tabs.update(tabId, { url: chatUrl, active: true });

  // Wait for the tab to finish loading
  await waitForTabComplete(tabId);

  // Extra time for WhatsApp Web's JS to initialize and render the chat
  await sleep(4000);

  // Build the action for the content script
  const contentPayload = attachment
    ? { action: "performSend", hasAttachment: true, attachment, caption: message || "" }
    : { action: "performSend", hasAttachment: false };

  // Send to the content script with retries (it may not be ready immediately)
  const result = await sendToContentWithRetry(tabId, contentPayload, 8);
  return result;
}

// ── Wait for tab status === "complete" ─────────────────────────
function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timeout waiting for WhatsApp Web to load"));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Retry sending message to content script ────────────────────
async function sendToContentWithRetry(tabId, payload, maxRetries) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, payload);
      if (response && response.success) return response;
      if (response && response.error) throw new Error(response.error);
      throw new Error("No response from content script");
    } catch (err) {
      if (i < maxRetries - 1) {
        await sleep(2000);
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
