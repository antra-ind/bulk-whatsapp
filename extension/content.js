// Content script injected into WhatsApp Web
// Handles ALL send logic via WhatsApp Web's own UI — NO page reloads.
// Opens chats using an internal link click, types messages, attaches files.

(function () {
  "use strict";

  // Version must match manifest — allows re-injection after extension update
  const SCRIPT_VERSION = "1.1.2";

  // If same version already running, skip. If older version, let it re-register.
  if (window.__bulkWASenderVersion === SCRIPT_VERSION) return;
  window.__bulkWASenderVersion = SCRIPT_VERSION;

  // ── Wake Lock to prevent browser/tab sleep ─────────────────
  let wakeLock = null;

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) {
      console.warn("[BulkWA] Wake lock failed:", e.message);
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  }

  // Re-acquire wake lock if tab becomes visible again (Chrome releases it on tab hide)
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && wakeLock === null && window.__bulkWAKeepAwake) {
      await acquireWakeLock();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "keepAwake") {
      if (request.enable) {
        window.__bulkWAKeepAwake = true;
        acquireWakeLock();
      } else {
        window.__bulkWAKeepAwake = false;
        releaseWakeLock();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (request.action === "performSend") {
      performSend(request)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }
  });

  async function performSend({ phone, message, attachment }) {
    // Step 1: Open the chat for this phone number WITHOUT reloading the page.
    // We create a temporary <a> link with the /send?phone= URL and click it.
    // WhatsApp Web intercepts this internally (SPA routing) — no reload.
    try {
      await openChatForPhone(phone);
    } catch (err) {
      throw new Error(
        `CHAT_NOT_READY: ${err.message}. ` +
        "Make sure WhatsApp Web is logged in and the phone number exists on WhatsApp."
      );
    }

    await sleep(1500);

    if (attachment) {
      // Step 2a: Attach file — this waits for the preview overlay to appear
      try {
        await sendFileViaAttachButton(attachment);
      } catch (err) {
        throw new Error(
          `ATTACHMENT_FAILED: Could not attach file "${attachment.name}". ` +
          `${err.message}. Try a smaller file or different format.`
        );
      }

      await sleep(1000);

      // Type caption — the preview overlay should be visible now with a caption field
      let captionTyped = false;
      if (message) {
        captionTyped = await typeCaption(message);
        await sleep(800);
      }

      // Send — use media-specific send
      try {
        await clickMediaSendButton();
      } catch (err) {
        throw new Error(
          "SEND_BUTTON_NOT_FOUND: Could not find the send button after attaching file. " +
          "WhatsApp Web UI may have changed. Try refreshing the page."
        );
      }
      await sleep(2000);

      // If caption wasn't typed, send text as a separate message
      if (message && !captionTyped) {
        try {
          await typeAndSendMessage(message);
        } catch (e) {
          // Image was sent at least — don't fail the whole operation
        }
        await sleep(1500);
      }
    } else {
      // Step 2b: Type text message and send
      try {
        await typeAndSendMessage(message);
      } catch (err) {
        throw new Error(
          `SEND_FAILED: ${err.message}. ` +
          "Make sure the chat loaded. Try refreshing WhatsApp Web."
        );
      }
      await sleep(1500);
    }

    return { success: true };
  }

  // ── Open chat via internal link click (no page reload) ───────
  async function openChatForPhone(phone) {
    const url = `https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`;

    // Create a hidden link and click it — WhatsApp Web handles it as SPA route
    const a = document.createElement("a");
    a.href = url;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Wait for the chat compose box to appear
    await waitForChatReady();
  }

  // ── Wait for chat to be ready ────────────────────────────────
  function waitForChatReady() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 40; // 20 seconds

      const check = setInterval(() => {
        attempts++;

        // Check for error popups (invalid number, not on WhatsApp)
        const okBtn = document.querySelector('[data-testid="popup-controls-ok"]');
        const popupContents = document.querySelector('[data-testid="popup-contents"]');
        if (okBtn) {
          const errorText = popupContents ? popupContents.textContent : "";
          clearInterval(check);
          okBtn.click();
          if (errorText.toLowerCase().includes("invalid")) {
            reject(new Error("Invalid phone number format"));
          } else if (errorText.toLowerCase().includes("not")) {
            reject(new Error("This number is not registered on WhatsApp"));
          } else {
            reject(new Error(`WhatsApp error: ${errorText || "Unknown popup error"}`));
          }
          return;
        }

        // Look for the compose box (chat is ready)
        const composeBox =
          document.querySelector('[data-testid="conversation-compose-box-input"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
          document.querySelector('footer div[contenteditable="true"]');

        if (composeBox) {
          clearInterval(check);
          resolve();
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(check);
          reject(new Error("Timeout waiting for chat to load"));
        }
      }, 500);
    });
  }

  // ── Type message into compose box and press Enter ────────────
  async function typeAndSendMessage(text) {
    const composeBox =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('footer div[contenteditable="true"]');

    if (!composeBox) {
      throw new Error("Could not find message input box");
    }

    // Focus and clear any existing content
    composeBox.focus();
    await sleep(200);

    // Type the message using execCommand (works with WhatsApp's React input)
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    composeBox.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(300);

    // Click the send button or press Enter
    await clickSendButton();
  }

  // ── Send file via paste (primary) or fallbacks ───────────────
  async function sendFileViaAttachButton(attachment) {
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], attachment.name, { type: attachment.type });
    const dataUrl = await fileToDataUrl(file);

    // Method 1 (Primary): Clipboard paste into compose box
    // This triggers WhatsApp's preview overlay with caption field — same as Ctrl+V
    const composeBox =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('footer div[contenteditable="true"]');
    if (composeBox) composeBox.focus();
    await sleep(500);

    await callInject(
      "__bulkWA_attachFile",
      { fileData: dataUrl, fileName: file.name, fileType: file.type, method: "paste" },
      "__bulkWA_attachResult"
    );
    await sleep(2000);
    if (await waitForPreviewOverlay(5000)) return;

    // Method 2 (Fallback): Drag and drop
    await callInject(
      "__bulkWA_attachFile",
      { fileData: dataUrl, fileName: file.name, fileType: file.type, method: "drop" },
      "__bulkWA_attachResult"
    );
    await sleep(2000);
    if (await waitForPreviewOverlay(5000)) return;

    // Method 3 (Fallback): Attach button + file input
    const attached = await tryAttachButtonMethod(file);
    if (attached && await waitForPreviewOverlay(5000)) return;

    throw new Error("Could not attach file — all methods failed (paste, drop, attach button)");
  }

  // ── Bridge: send command to inject.js (main world) and wait for result ──
  function callInject(eventName, detail, resultEvent, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const handler = (e) => {
        document.removeEventListener(resultEvent, handler);
        resolve(e.detail);
      };
      document.addEventListener(resultEvent, handler);
      document.dispatchEvent(new CustomEvent(eventName, { detail }));

      // Timeout fallback
      setTimeout(() => {
        document.removeEventListener(resultEvent, handler);
        resolve({ success: false, error: "timeout" });
      }, timeoutMs);
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function tryAttachButtonMethod(file) {
    // Find the attach button — WhatsApp Web uses data-icon="plus-rounded" on a BUTTON
    const attachBtn =
      document.querySelector('button[aria-label="Attach"]') ||
      document.querySelector('span[data-icon="plus-rounded"]')?.closest("button") ||
      document.querySelector('[data-testid="attach-menu-plus"]') ||
      document.querySelector('span[data-icon="plus"]')?.closest("button") ||
      document.querySelector('[title="Attach"]');

    if (!attachBtn) return false;

    attachBtn.click();
    await sleep(1500);

    // WhatsApp shows a menu: Photos & Videos, Document, Camera, Contact, etc.
    // We need to click the "Photos & Videos" (image) menu item first.
    const photoMenuItem = await findPhotoMenuItem();
    if (photoMenuItem) {
      photoMenuItem.click();
      await sleep(1000);
    }

    // Wait for file input to appear
    let fileInputReady = false;
    for (let i = 0; i < 15; i++) {
      if (document.querySelectorAll('input[type="file"]').length > 0) {
        fileInputReady = true;
        break;
      }
      await sleep(300);
    }
    if (!fileInputReady) return false;

    // Delegate file-input setting to inject.js (main world) for React compatibility
    const dataUrl = await fileToDataUrl(file);
    const result = await callInject(
      "__bulkWA_attachFile",
      { fileData: dataUrl, fileName: file.name, fileType: file.type, method: "input" },
      "__bulkWA_attachResult"
    );

    await sleep(1500);
    return result.success;
  }

  // ── Find the "Photos & Videos" item in the attachment menu ───
  function findPhotoMenuItem() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 10;
      const check = setInterval(() => {
        attempts++;

        // Strategy 1: data-testid containing image/photo/media
        let el = document.querySelector('[data-testid*="image"], [data-testid*="photo"], [data-testid*="media"]');
        if (el) { clearInterval(check); resolve(el); return; }

        // Strategy 2: aria-label containing Photos/Image
        el = document.querySelector('[aria-label*="photo" i], [aria-label*="image" i], [aria-label*="Photos" i]');
        if (el) { clearInterval(check); resolve(el); return; }

        // Strategy 3: icon with image/photo/gallery/camera-roll name
        const icons = document.querySelectorAll('[data-icon]');
        for (const ic of icons) {
          if (/image|photo|gallery|camera-roll|media|picture/i.test(ic.dataset.icon)) {
            el = ic.closest('button') || ic.closest('[role="button"]') || ic.closest('li') || ic.parentElement;
            if (el) { clearInterval(check); resolve(el); return; }
          }
        }

        // Strategy 4: File input with accept=image/* (click its container)
        const inp = document.querySelector('input[type="file"][accept*="image"]');
        if (inp) {
          el = inp.closest('button') || inp.closest('[role="button"]') || inp.closest('li') || inp.parentElement;
          if (el) { clearInterval(check); resolve(el); return; }
        }

        // Strategy 5: Menu item containing "Photos" or "Image" text
        const all = document.querySelectorAll('button, [role="button"], li, [data-animate-dropdown-item]');
        for (const item of all) {
          if (/photos|image|photo/i.test(item.textContent?.trim() || '')) {
            clearInterval(check); resolve(item); return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(check);
          resolve(null); // Menu item not found — proceed without it
        }
      }, 300);
    });
  }

  // ── Wait for image preview overlay to appear ──────────────────
  // When an image is pasted/dropped, WhatsApp shows a preview with a caption field.
  // We detect this by looking for a NEW contenteditable that wasn't there before.
  function waitForPreviewOverlay(timeoutMs) {
    return new Promise((resolve) => {
      // Snapshot current editables so we can detect the new caption field
      const existingEditables = new Set(
        document.querySelectorAll('div[contenteditable="true"]')
      );
      let elapsed = 0;
      const interval = 300;
      const check = setInterval(() => {
        elapsed += interval;

        // Look for a NEW contenteditable (the caption input)
        const allEditable = document.querySelectorAll('div[contenteditable="true"]');
        for (const el of allEditable) {
          if (!existingEditables.has(el)) {
            clearInterval(check);
            resolve(true);
            return;
          }
        }

        // Also check if the number of editables increased
        if (allEditable.length > existingEditables.size) {
          clearInterval(check);
          resolve(true);
          return;
        }

        if (elapsed >= timeoutMs) {
          clearInterval(check);
          resolve(false);
        }
      }, interval);
    });
  }

  // ── (removed — waitForAttachmentPreview is now handled by sendFileViaAttachButton) ──

  // ── Type caption in the attachment preview ───────────────────
  async function typeCaption(text) {
    // Wait for the caption input to appear in the media editor
    const captionInput = await waitForCaptionInput();

    if (captionInput) {
      captionInput.focus();
      await sleep(300);

      // Clear any existing content first
      captionInput.textContent = "";
      captionInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(100);

      // Type the caption text
      document.execCommand("insertText", false, text);
      captionInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
      return true;
    }
    return false;
  }

  // ── Find the caption input in the preview overlay ───────────
  function waitForCaptionInput() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 15; // 7.5 seconds

      // The preview overlay is already visible at this point.
      // The caption input is a contenteditable that is NOT the main compose box or search.
      const mainCompose = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="10"]');
      const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="3"]');

      const check = setInterval(() => {
        attempts++;

        const allEditable = document.querySelectorAll('div[contenteditable="true"]');

        for (const el of allEditable) {
          if (el !== mainCompose && el !== searchBox &&
              !el.closest('[data-testid="side"]') &&
              !el.closest('header')) {
            // This is the caption input
            clearInterval(check);
            resolve(el);
            return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(check);
          resolve(null);
        }
      }, 500);
    });
  }

  // ── Click send button (for media/attachment context) ─────────
  async function clickMediaSendButton() {
    for (let attempts = 0; attempts < 20; attempts++) {
      // Priority 1: WhatsApp's current send icon (wds-ic-send-filled)
      const wdsSend = document.querySelector('span[data-icon="wds-ic-send-filled"]');
      if (wdsSend) {
        const btn = wdsSend.closest("button") || wdsSend.closest('div[role="button"]') || wdsSend;
        btn.click();
        return;
      }

      // Priority 2: Try via inject.js (main world) for React compatibility
      const result = await callInject(
        "__bulkWA_clickSend",
        {},
        "__bulkWA_clickSendResult",
        2000
      );

      if (result.success) {
        return;
      }

      // Priority 3: Legacy send selectors from content script
      const sendBtn =
        document.querySelector('[data-testid="send"]') ||
        document.querySelector('span[data-icon="send"]')?.closest("button") ||
        document.querySelector('button[aria-label="Send"]');

      if (sendBtn) {
        sendBtn.click();
        return;
      }

      // Last resort: press Enter via inject.js
      if (attempts >= 10) {
        await callInject(
          "__bulkWA_pressEnter",
          {},
          "__bulkWA_pressEnterResult",
          2000
        );
        return;
      }

      await sleep(500);
    }

    throw new Error("Could not find send button after attaching file");
  }

  // ── Click send button (for regular text messages) ────────────
  function clickSendButton() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 15;

      const tryClick = setInterval(() => {
        attempts++;

        // WhatsApp's current send icon
        const wdsSend = document.querySelector('span[data-icon="wds-ic-send-filled"]');
        if (wdsSend) {
          const btn = wdsSend.closest("button") || wdsSend.closest('div[role="button"]') || wdsSend;
          clearInterval(tryClick);
          btn.click();
          resolve();
          return;
        }

        // Legacy send selectors
        const sendBtn =
          document.querySelector('[data-testid="send"]') ||
          document.querySelector('span[data-icon="send"]')?.closest("button") ||
          document.querySelector('button[aria-label="Send"]');

        if (sendBtn) {
          clearInterval(tryClick);
          sendBtn.click();
          resolve();
          return;
        }

        // Fallback: press Enter
        if (attempts >= 5) {
          const composeBox =
            document.querySelector('[data-testid="conversation-compose-box-input"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
            document.querySelector('footer div[contenteditable="true"]');
          if (composeBox) {
            clearInterval(tryClick);
            composeBox.focus();
            composeBox.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
              })
            );
            resolve();
            return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(tryClick);
          reject(new Error("Could not find send button"));
        }
      }, 500);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
