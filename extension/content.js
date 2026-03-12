// Content script injected into WhatsApp Web
// Handles ALL send logic via WhatsApp Web's own UI — NO page reloads.
// Opens chats using an internal link click, types messages, attaches files.

(function () {
  "use strict";

  // Version must match manifest — allows re-injection after extension update
  const SCRIPT_VERSION = "1.2.3";

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
      const msg = err.message || "";
      if (msg.startsWith("NOT_ON_WHATSAPP:")) {
        throw err; // Pass through — popup.js handles skip logic
      }
      throw new Error(
        `CHAT_NOT_READY: ${msg}. ` +
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

      await sleep(2000);

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

        // Look for the compose box FIRST (chat is ready — most common path)
        const composeBox =
          document.querySelector('[data-testid="conversation-compose-box-input"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
          document.querySelector('footer div[contenteditable="true"]');

        if (composeBox) {
          clearInterval(check);
          resolve();
          return;
        }

        // Check for error popups (invalid number, not on WhatsApp)
        const okBtn = document.querySelector('[data-testid="popup-controls-ok"]');
        const popupContents = document.querySelector('[data-testid="popup-contents"]');
        if (okBtn) {
          const errorText = popupContents ? popupContents.textContent : "";
          clearInterval(check);
          okBtn.click();
          reject(new Error(classifyWhatsAppError(errorText)));
          return;
        }

        // Check for "Continue to chat" button — shown for numbers not in contacts
        // but still on WhatsApp. Click it to proceed.
        const continueBtn = document.querySelector('a[title="Continue to chat"], [data-testid="continue-to-chat"]');
        if (continueBtn) {
          continueBtn.click();
        }

        if (attempts >= maxAttempts) {
          clearInterval(check);
          reject(new Error("NOT_ON_WHATSAPP: Chat did not open — number may not be on WhatsApp"));
        }
      }, 500);
    });
  }

  // Classify WhatsApp error popup text into a clear error message
  function classifyWhatsAppError(text) {
    const t = (text || "").toLowerCase();
    if (t.includes("invalid")) return "NOT_ON_WHATSAPP: Invalid phone number format";
    if (t.includes("not") || t.includes("doesn't") || t.includes("no account"))
      return "NOT_ON_WHATSAPP: This number is not registered on WhatsApp";
    return `NOT_ON_WHATSAPP: ${text || "Unknown WhatsApp error"}`;
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

  // ── Send file via attach menu (primary) or fallbacks ──────────
  // Scan confirmed: ONLY the menu flow works (Attach → Photos & Videos → set file).
  // Paste, drop, and direct file input all fail on WhatsApp Web.
  async function sendFileViaAttachButton(attachment) {
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], attachment.name, { type: attachment.type });
    const dataUrl = await fileToDataUrl(file);

    // Method 1 (Primary): Attach → Photos & Videos menu → intercept file dialog → set file
    // This runs entirely in inject.js (MAIN world) for React compatibility
    const result = await callInject(
      "__bulkWA_attachViaMenu",
      { fileData: dataUrl, fileName: file.name, fileType: file.type },
      "__bulkWA_attachViaMenuResult",
      15000
    );

    if (result.success) {
      await sleep(2000);
      if (await waitForPreviewOverlay(8000)) return;
    }

    // Method 2 (Fallback): Try the old attach + menu click + file input from content script
    const attached = await tryAttachButtonMethod(file);
    if (attached && await waitForPreviewOverlay(5000)) return;

    // Method 3 (Fallback): Clipboard paste
    const composeBox =
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

    throw new Error("Could not attach file — all methods failed");
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
    // Fallback: this runs from content script (ISOLATED world).
    // The primary attachViaMenu in inject.js (MAIN world) is preferred.
    const attachBtn =
      document.querySelector('button[aria-label="Attach"]') ||
      document.querySelector('span[data-icon="plus-rounded"]')?.closest("button") ||
      document.querySelector('[data-testid="attach-menu-plus"]') ||
      document.querySelector('span[data-icon="plus"]')?.closest("button") ||
      document.querySelector('[title="Attach"]');

    if (!attachBtn) return false;

    attachBtn.click();
    await sleep(1500);

    // Find file inputs BEFORE clicking menu — add listener to block native dialog
    const existingInputs = document.querySelectorAll('input[type="file"]');
    for (const inp of existingInputs) {
      inp.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
    }

    // Click Photos & Videos menu item
    const photoMenuItem = await findPhotoMenuItem();
    if (photoMenuItem) {
      photoMenuItem.click();
      await sleep(1000);
    }

    // Also block any NEW file inputs that appeared
    const newInputs = document.querySelectorAll('input[type="file"]');
    for (const inp of newInputs) {
      inp.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
    }

    // Find the target file input
    let targetInput = document.querySelector('input[type="file"][accept*="image"]') ||
      document.querySelector('input[type="file"]');
    if (!targetInput) return false;

    // Set file via inject.js (MAIN world) for React compatibility
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
  // Scan confirmed: preview does NOT add new editables. It reuses the compose box.
  // Detect preview by: new icons (x-alt = remove attachment), or send button
  // with role="button" and aria-label="Send", or wds-ic-send-filled visible.
  function waitForPreviewOverlay(timeoutMs) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const interval = 300;
      const check = setInterval(() => {
        elapsed += interval;

        // Check 1: "Remove attachment" button (x-alt icon) — unique to preview
        const removeBtn = document.querySelector('span[data-icon="x-alt"]');
        if (removeBtn) {
          clearInterval(check);
          resolve(true);
          return;
        }

        // Check 2: Send button with aria-label="Send" as div[role="button"]
        // (only appears in preview — regular chat send is different)
        const sendDiv = document.querySelector('div[role="button"][aria-label="Send"]');
        if (sendDiv && sendDiv.querySelector('span[data-icon="wds-ic-send-filled"]')) {
          clearInterval(check);
          resolve(true);
          return;
        }

        // Check 3: scissors icon (crop) — only in image preview
        const scissors = document.querySelector('span[data-icon="scissors"]');
        if (scissors) {
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
  // Caption scan confirmed: preview creates a NEW editable with:
  //   data-lexical-editor="true", aria-label="Type a message", data-tab="undefined"
  // This is DIFFERENT from the regular compose box (data-tab="10", aria-label="Type to [name]").
  async function typeCaption(text) {
    // The caption field has data-lexical-editor="true" — unique to the preview
    let captionInput = document.querySelector(
      'div[contenteditable="true"][data-lexical-editor="true"]'
    );

    if (!captionInput) {
      // Wait and retry — the preview Lexical editor may still be initializing
      await sleep(2000);
      captionInput = document.querySelector(
        'div[contenteditable="true"][data-lexical-editor="true"]'
      );
    }

    if (!captionInput) return false;

    // Click the element to activate Lexical's internal focus handler
    captionInput.click();
    await sleep(300);
    captionInput.focus();
    await sleep(300);

    // Clear any existing content first
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    await sleep(100);

    // Type the caption text
    document.execCommand("insertText", false, text);
    captionInput.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(500);

    // Verify the text was actually typed (Lexical may have ignored execCommand)
    if (captionInput.textContent.trim().length > 0) {
      return true;
    }

    // Fallback: use inject.js (MAIN world) which dispatches proper InputEvents
    const result = await callInject(
      "__bulkWA_typeText",
      { text, selector: 'div[contenteditable="true"][data-lexical-editor="true"]' },
      "__bulkWA_typeTextResult",
      5000
    );

    if (result.success) return true;

    // Last resort: set textContent directly and fire events
    captionInput.textContent = text;
    captionInput.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: text,
      bubbles: true,
    }));
    await sleep(300);
    return captionInput.textContent.trim().length > 0;
  }

  // ── Click send button (for media/attachment context) ─────────
  // Scan confirmed: preview send = div[role="button"][aria-label="Send"] with wds-ic-send-filled
  async function clickMediaSendButton() {
    for (let attempts = 0; attempts < 20; attempts++) {
      // Priority 1: div[role="button"][aria-label="Send"] — the preview send button
      const sendDiv = document.querySelector('div[role="button"][aria-label="Send"]');
      if (sendDiv) {
        sendDiv.click();
        return;
      }

      // Priority 2: wds-ic-send-filled icon — click its parent
      const wdsSend = document.querySelector('span[data-icon="wds-ic-send-filled"]');
      if (wdsSend) {
        const btn = wdsSend.closest('div[role="button"]') || wdsSend.closest("button") || wdsSend;
        btn.click();
        return;
      }

      // Priority 3: Try via inject.js (main world) for React compatibility
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
