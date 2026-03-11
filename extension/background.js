// Background service worker — forwards send requests to content script.
// NO page navigation — content script handles everything via WhatsApp Web UI.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Bulk WhatsApp Sender extension installed");
});

// ── Message handler from popup ─────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendMessage") {
    forwardToContent(request)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  if (request.action === "keepAwake") {
    const { tabId, enable } = request;
    chrome.tabs.sendMessage(tabId, { action: "keepAwake", enable }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
});

async function forwardToContent({ phone, message, attachment }) {
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
  const tab = tabs[0];
  if (tab.title && tab.title.toLowerCase().includes("qr")) {
    throw new Error(
      "NOT_LOGGED_IN: WhatsApp Web shows QR code. " +
      "Scan the QR code with your phone first."
    );
  }

  // Ensure content script is injected (Edge sometimes needs this)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (e) {
    // Already injected via manifest — that's fine
  }

  // Build payload for content script
  const payload = {
    action: "performSend",
    phone: cleanPhone,
    message: message || "",
    attachment: attachment || null,
  };

  // Send to content script with retries
  try {
    const result = await sendToContentWithRetry(tabId, payload, 5);
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
      if (i < maxRetries - 1) {
        await sleep(1500);
      }
    }
  }
  throw lastError || new Error("No response from content script after all retries");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
