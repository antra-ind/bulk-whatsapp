// Content script injected into WhatsApp Web
// Handles ALL send logic via WhatsApp Web's own UI — NO page reloads.
// Opens chats using an internal link click, types messages, attaches files.

(function () {
  "use strict";

  // Prevent duplicate listeners if script is injected multiple times
  if (window.__bulkWASenderLoaded) return;
  window.__bulkWASenderLoaded = true;

  // ── Wake Lock to prevent browser/tab sleep ─────────────────
  let wakeLock = null;

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
        console.log("[BulkWA] Wake lock acquired — browser will stay awake");
      }
    } catch (e) {
      console.warn("[BulkWA] Wake lock failed:", e.message);
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
      console.log("[BulkWA] Wake lock released");
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
      // Step 2a: Attach file
      try {
        await sendFileViaAttachButton(attachment);
      } catch (err) {
        throw new Error(
          `ATTACHMENT_FAILED: Could not attach file "${attachment.name}". ` +
          `${err.message}. Try a smaller file or different format.`
        );
      }

      // Wait for preview
      await waitForAttachmentPreview();
      await sleep(1000);

      // Type caption
      if (message) {
        await typeCaption(message);
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

  // ── Send file via clipboard paste or attachment button ───────
  async function sendFileViaAttachButton(attachment) {
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], attachment.name, { type: attachment.type });

    const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");

    if (isMedia) {
      // For images/videos: clipboard paste works reliably
      console.log("[BulkWA] Using clipboard paste for media:", file.type);
      await pasteFileToChat(file);
    } else {
      // For documents: use attachment button + file input
      console.log("[BulkWA] Using attach button for document:", file.type);
      const sent = await tryAttachButtonMethod(file);
      if (!sent) {
        // Fallback to clipboard paste even for docs
        console.log("[BulkWA] Attach button failed, trying clipboard paste");
        await pasteFileToChat(file);
      }
    }
  }

  async function pasteFileToChat(file) {
    // Focus the compose box first so WhatsApp receives the paste
    const composeBox =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('footer div[contenteditable="true"]');

    if (composeBox) {
      composeBox.focus();
      await sleep(300);
    }

    const dt = new DataTransfer();
    dt.items.add(file);

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });

    // Dispatch on the focused element or compose box
    const target = composeBox || document.querySelector("#main") || document.querySelector("#app");
    target.dispatchEvent(pasteEvent);
    console.log("[BulkWA] Clipboard paste dispatched for:", file.name);
    await sleep(2000);
  }

  async function tryAttachButtonMethod(file) {
    const attachBtn =
      document.querySelector('[data-testid="attach-menu-plus"]') ||
      document.querySelector('span[data-icon="plus"]')?.closest("button") ||
      document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('div[role="button"]') ||
      document.querySelector('span[data-icon="plus"]')?.closest('div[role="button"]') ||
      document.querySelector('[title="Attach"]') ||
      document.querySelector('[aria-label="Attach"]');

    if (!attachBtn) return false;

    attachBtn.click();
    await sleep(1000);

    // WhatsApp may show a sub-menu. Click the right option.
    const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");

    const menuItem = isMedia
      ? (document.querySelector('[data-testid="attach-image"]') ||
         document.querySelector('[data-testid="attach-photo+video"]') ||
         document.querySelector('span[data-icon="attach-image"]')?.closest('button') ||
         document.querySelector('span[data-icon="attach-image"]')?.closest('div[role="button"]') ||
         document.querySelector('li[data-testid="mi-attach-media"]'))
      : (document.querySelector('[data-testid="attach-document"]') ||
         document.querySelector('span[data-icon="attach-document"]')?.closest('button') ||
         document.querySelector('span[data-icon="attach-document"]')?.closest('div[role="button"]') ||
         document.querySelector('li[data-testid="mi-attach-document"]'));

    if (menuItem) {
      menuItem.click();
      await sleep(800);
    }

    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) return false;

    let targetInput = null;

    for (const input of fileInputs) {
      const accept = input.getAttribute("accept") || "";
      if (isMedia && (accept.includes("image") || accept.includes("video"))) {
        targetInput = input;
        break;
      }
      if (!isMedia && (accept.includes("*") || accept === "")) {
        targetInput = input;
        break;
      }
    }

    if (!targetInput) {
      targetInput = fileInputs[fileInputs.length - 1];
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    targetInput.files = dt.files;
    targetInput.dispatchEvent(new Event("change", { bubbles: true }));
    console.log("[BulkWA] File set on input, accept:", targetInput.getAttribute("accept"));
    await sleep(1500);
    return true;
  }
  }

  // ── Wait for attachment preview ──────────────────────────────
  function waitForAttachmentPreview() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 20;

      const check = setInterval(() => {
        attempts++;

        const preview =
          document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-canvas"]') ||
          document.querySelector('[data-testid="image-preview"]') ||
          document.querySelector('[data-testid="media-editor-container"]') ||
          document.querySelector(".draw-container");

        const sendInPreview =
          document.querySelector('[data-testid="send"]') ||
          document.querySelector('span[data-icon="send"]');

        if (preview || (sendInPreview && attempts > 3)) {
          clearInterval(check);
          resolve();
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(check);
          resolve();
        }
      }, 500);
    });
  }

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
    }
  }

  function waitForCaptionInput() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds

      const check = setInterval(() => {
        attempts++;

        // IMPORTANT: We must find the contenteditable INSIDE the media editor,
        // NOT the main chat compose box and NOT the search bar.
        // The media editor appears as an overlay when attaching files.

        // Method 1: Look inside the media editor container
        const mediaEditor = document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-editor-container"]');

        if (mediaEditor) {
          const editable = mediaEditor.querySelector('div[contenteditable="true"]');
          if (editable) {
            clearInterval(check);
            resolve(editable);
            return;
          }
        }

        // Method 2: Caption input container
        const captionContainer = document.querySelector('[data-testid="media-caption-input-container"]');
        if (captionContainer) {
          const editable = captionContainer.querySelector('div[contenteditable="true"]');
          if (editable) {
            clearInterval(check);
            resolve(editable);
            return;
          }
        }

        // Method 3: Find contenteditable that is NOT the main compose box 
        // and NOT inside the search/side panel
        if (attempts > 5) {
          const allEditable = document.querySelectorAll('div[contenteditable="true"]');
          const mainCompose = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="10"]');
          const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="3"]');

          for (const el of allEditable) {
            if (el !== mainCompose && el !== searchBox &&
                !el.closest('[data-testid="side"]') &&
                !el.closest('header')) {
              // Found a contenteditable that's not compose or search
              clearInterval(check);
              resolve(el);
              return;
            }
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
  function clickMediaSendButton() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20;

      const tryClick = setInterval(() => {
        attempts++;

        // Priority 1: Send button inside the media editor overlay
        const mediaEditor = document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-editor-container"]');

        if (mediaEditor) {
          const mediaSend =
            mediaEditor.querySelector('[data-testid="send"]') ||
            mediaEditor.querySelector('span[data-icon="send"]')?.closest('button') ||
            mediaEditor.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
            mediaEditor.querySelector('span[data-icon="send"]')?.parentElement;

          if (mediaSend) {
            clearInterval(tryClick);
            mediaSend.click();
            console.log("[BulkWA] Clicked send inside media editor");
            resolve();
            return;
          }
        }

        // Priority 2: Any send button visible on page (media editor may not have data-testid)
        const sendBtn =
          document.querySelector('[data-testid="send"]') ||
          document.querySelector('span[data-icon="send"]')?.closest('button') ||
          document.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
          document.querySelector('button[aria-label="Send"]') ||
          document.querySelector('span[data-icon="send"]')?.parentElement;

        if (sendBtn) {
          clearInterval(tryClick);
          sendBtn.click();
          console.log("[BulkWA] Clicked send button (global)");
          resolve();
          return;
        }

        // Priority 3: Press Enter on caption/compose input
        if (attempts >= 8) {
          // Try caption input first (inside media editor)
          const captionBox = mediaEditor?.querySelector('div[contenteditable="true"]');
          const targetBox = captionBox ||
            document.querySelector('[data-testid="conversation-compose-box-input"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="10"]');

          if (targetBox) {
            clearInterval(tryClick);
            targetBox.focus();
            targetBox.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
              })
            );
            console.log("[BulkWA] Pressed Enter as send fallback");
            resolve();
            return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(tryClick);
          reject(new Error("Could not find send button in media editor"));
        }
      }, 500);
    });
  }

  // ── Click send button (for regular text messages) ────────────
  function clickSendButton() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 15;

      const tryClick = setInterval(() => {
        attempts++;

        const sendBtn =
          document.querySelector('[data-testid="send"]') ||
          document.querySelector('span[data-icon="send"]')?.closest("button") ||
          document.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
          document.querySelector('button[aria-label="Send"]') ||
          document.querySelector('span[data-icon="send"]')?.parentElement;

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
