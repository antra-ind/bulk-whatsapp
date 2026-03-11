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
  // Validate phone number format
  const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, "");
  if (!cleanPhone || !/^\d{7,15}$/.test(cleanPhone)) {
    throw new Error(
      `INVALID_PHONE: "${phone}" is not a valid phone number. ` +
      `Use country code + number (e.g. 919876543210).`
    );
  }

  // Find the WhatsApp Web tab
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs.length === 0) {
    throw new Error(
      "NO_WHATSAPP_TAB: WhatsApp Web is not open. " +
      "Open web.whatsapp.com in a tab and scan the QR code first."
    );
  }
  const tabId = tabs[0].id;

  // Check if WhatsApp Web is actually logged in (tab title check)
  try {
    const tab = tabs[0];
    if (tab.title && tab.title.toLowerCase().includes("qr")) {
      throw new Error(
        "NOT_LOGGED_IN: WhatsApp Web shows QR code. " +
        "Scan the QR code with your phone first."
      );
    }
  } catch (e) {
    if (e.message.startsWith("NOT_LOGGED_IN")) throw e;
  }

  // Build the URL — include &text= only for text-only messages
  let chatUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(cleanPhone)}`;
  if (message && !attachment) {
    chatUrl += `&text=${encodeURIComponent(message)}`;
  }

  // Navigate the tab
  try {
    await chrome.tabs.update(tabId, { url: chatUrl, active: true });
  } catch (navErr) {
    throw new Error(
      "NAVIGATION_FAILED: Could not open chat. " +
      `Tab may have been closed. (${navErr.message})`
    );
  }

  // Wait for the tab to finish loading
  try {
    await waitForTabComplete(tabId);
  } catch (loadErr) {
    throw new Error(
      "PAGE_LOAD_TIMEOUT: WhatsApp Web took too long to load. " +
      "Check your internet connection and try again."
    );
  }

  // Extra time for WhatsApp Web's JS to initialize and render the chat
  await sleep(4000);

  // Ensure content script is injected (Edge sometimes doesn't auto-inject after navigation)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (injectErr) {
    // Content script may already be injected via manifest — that's OK
    console.log("Content script inject note:", injectErr.message);
  }

  await sleep(1000);

  // Build the action for the content script
  const contentPayload = attachment
    ? { action: "performSend", hasAttachment: true, attachment, caption: message || "" }
    : { action: "performSend", hasAttachment: false };

  // Send to the content script with retries
  try {
    const result = await sendToContentWithRetry(tabId, contentPayload, 8);
    return result;
  } catch (sendErr) {
    const msg = sendErr.message || "";
    if (msg.includes("Receiving end does not exist") || msg.includes("No response")) {
      throw new Error(
        "CONTENT_SCRIPT_FAILED: Extension could not communicate with WhatsApp Web. " +
        "Try refreshing WhatsApp Web (Ctrl+R / Cmd+R) and send again."
      );
    }
    throw new Error(`SEND_FAILED: ${msg}`);
  }
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
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, payload);
      if (response && response.success) return response;
      if (response && response.error) throw new Error(response.error);
      throw new Error("No response from content script");
    } catch (err) {
      lastError = err;
      console.log(`Content script attempt ${i + 1}/${maxRetries} failed:`, err.message);
      if (i < maxRetries - 1) {
        await sleep(2000);
      }
    }
  }
  throw lastError || new Error("No response from content script after all retries");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
