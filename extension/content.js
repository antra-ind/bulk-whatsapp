// Content script injected into WhatsApp Web
// Handles ALL send logic via WhatsApp Web's own UI — NO page reloads.
// Opens chats using an internal link click, types messages, attaches files.

(function () {
  "use strict";

  // Prevent duplicate listeners if script is injected multiple times
  if (window.__bulkWASenderLoaded) return;
  window.__bulkWASenderLoaded = true;

  // ── DEBUG: Log DOM events when manually sending images ─────
  // Run  window.__bulkWADebug()  in the browser console to start logging.
  // It monitors: file inputs, paste events, send button clicks, media editor changes.
  window.__bulkWADebug = function () {
    console.log("[BulkWA DEBUG] Starting event monitor...");

    // Log all file input changes
    document.addEventListener("change", (e) => {
      if (e.target.tagName === "INPUT" && e.target.type === "file") {
        console.log("[BulkWA DEBUG] FILE INPUT changed:", {
          accept: e.target.getAttribute("accept"),
          files: e.target.files.length,
          fileName: e.target.files[0]?.name,
          fileType: e.target.files[0]?.type,
          parentTestId: e.target.closest("[data-testid]")?.getAttribute("data-testid"),
          inputHTML: e.target.outerHTML.slice(0, 200),
        });
      }
    }, true);

    // Log all paste events
    document.addEventListener("paste", (e) => {
      console.log("[BulkWA DEBUG] PASTE event:", {
        target: e.target.tagName,
        targetTestId: e.target.closest("[data-testid]")?.getAttribute("data-testid"),
        hasClipboardData: !!e.clipboardData,
        types: e.clipboardData?.types,
        fileCount: e.clipboardData?.files?.length,
      });
    }, true);

    // Log all click events on buttons / send-like elements
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-testid], [data-icon], button, [role='button']");
      if (el) {
        console.log("[BulkWA DEBUG] CLICK:", {
          testId: el.getAttribute("data-testid"),
          icon: el.getAttribute("data-icon") || el.querySelector("[data-icon]")?.getAttribute("data-icon"),
          role: el.getAttribute("role"),
          tag: el.tagName,
          ariaLabel: el.getAttribute("aria-label"),
          classes: el.className?.toString().slice(0, 100),
        });
      }
    }, true);

    // Watch for media editor appearing
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            const editor = node.querySelector?.("[data-testid='media-editor']") ||
              (node.getAttribute?.("data-testid") === "media-editor" ? node : null);
            if (editor) {
              console.log("[BulkWA DEBUG] MEDIA EDITOR appeared:", {
                html: editor.outerHTML.slice(0, 300),
                editables: editor.querySelectorAll("div[contenteditable='true']").length,
                sendBtns: editor.querySelectorAll("[data-testid='send']").length,
                sendIcons: editor.querySelectorAll("span[data-icon='send']").length,
              });
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log("[BulkWA DEBUG] Monitoring active. Now manually attach & send an image.");
    console.log("[BulkWA DEBUG] Then share the logs with me.");
  };

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
      // For images/videos: clipboard paste is most reliable
      console.log("[BulkWA] Trying clipboard paste for media:", file.type);
      await pasteFileToChat(file);

      // Check if media editor appeared — if not, fall back to attach button
      const editorAppeared = await checkForMediaEditor(3000);
      if (!editorAppeared) {
        console.log("[BulkWA] Paste didn't trigger media editor, trying attach button");
        const sent = await tryAttachButtonMethod(file);
        if (!sent) {
          throw new Error("Could not attach image — both paste and attach button failed");
        }
      }
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

  async function pasteFileToChat(file) {
    // Focus the compose box first
    const composeBox =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('footer div[contenteditable="true"]');

    if (composeBox) {
      composeBox.focus();
      await sleep(500);
    }

    // Convert file to data URL so we can pass it across worlds via CustomEvent
    const dataUrl = await fileToDataUrl(file);

    const result = await callInject(
      "__bulkWA_attachFile",
      { fileData: dataUrl, fileName: file.name, fileType: file.type, method: "paste" },
      "__bulkWA_attachResult"
    );

    console.log("[BulkWA] Paste via inject.js result:", result);
    await sleep(2000);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
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

    // Delegate file-input setting to inject.js (main world) for React compatibility
    const dataUrl = await fileToDataUrl(file);
    const result = await callInject(
      "__bulkWA_attachFile",
      { fileData: dataUrl, fileName: file.name, fileType: file.type, method: "input" },
      "__bulkWA_attachResult"
    );

    console.log("[BulkWA] File input via inject.js result:", result);
    await sleep(1500);
    return result.success;
  }

  // ── Quick check if media editor appeared ─────────────────────
  function checkForMediaEditor(timeoutMs) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const interval = 300;
      const check = setInterval(() => {
        elapsed += interval;
        const editor =
          document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-canvas"]') ||
          document.querySelector('[data-testid="media-editor-container"]');
        if (editor) {
          clearInterval(check);
          console.log("[BulkWA] Media editor detected");
          resolve(true);
          return;
        }
        if (elapsed >= timeoutMs) {
          clearInterval(check);
          console.log("[BulkWA] Media editor NOT detected after", timeoutMs, "ms");
          resolve(false);
        }
      }, interval);
    });
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
  async function clickMediaSendButton() {
    for (let attempts = 0; attempts < 20; attempts++) {
      // Try via inject.js (main world) first — more reliable for React
      const result = await callInject(
        "__bulkWA_clickSend",
        {},
        "__bulkWA_clickSendResult",
        2000
      );

      if (result.success) {
        console.log("[BulkWA] Send clicked via inject.js");
        return;
      }

      // Fallback: try clicking directly from content script (shared DOM)
      const sendBtn =
        document.querySelector('[data-testid="send"]') ||
        document.querySelector('span[data-icon="send"]')?.closest("button") ||
        document.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
        document.querySelector('button[aria-label="Send"]') ||
        document.querySelector('span[data-icon="send"]')?.parentElement;

      if (sendBtn) {
        sendBtn.click();
        console.log("[BulkWA] Clicked send button (content script fallback)");
        return;
      }

      // Last resort: press Enter via inject.js
      if (attempts >= 10) {
        const enterResult = await callInject(
          "__bulkWA_pressEnter",
          {},
          "__bulkWA_pressEnterResult",
          2000
        );
        console.log("[BulkWA] Enter key fallback via inject.js:", enterResult);
        return;
      }

      await sleep(500);
    }

    throw new Error("Could not find send button in media editor");
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
