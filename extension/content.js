// Content script injected into WhatsApp Web
// Handles ALL send logic via WhatsApp Web's own UI — NO page reloads.
// Opens chats using an internal link click, types messages, attaches files.

(function () {
  "use strict";

  // Prevent duplicate listeners if script is injected multiple times
  if (window.__bulkWASenderLoaded) return;
  window.__bulkWASenderLoaded = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
      await sleep(800);

      // Type caption
      if (message) {
        await typeCaption(message);
        await sleep(500);
      }

      // Send
      try {
        await clickSendButton();
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

  // ── Send file via the attachment button + hidden input ───────
  async function sendFileViaAttachButton(attachment) {
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], attachment.name, { type: attachment.type });

    // Try Method 1: Attachment button → hidden file input
    const sent = await tryAttachButtonMethod(file);
    if (sent) return;

    // Try Method 2: Clipboard paste
    await tryClipboardPaste(file);
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
    await sleep(800);

    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) return false;

    let targetInput = null;
    const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");

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
    await sleep(1000);
    return true;
  }

  async function tryClipboardPaste(file) {
    const target =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector("#main") ||
      document.querySelector("#app");

    if (!target) {
      throw new Error("Could not find chat area for file paste");
    }

    const dt = new DataTransfer();
    dt.items.add(file);

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });

    target.dispatchEvent(pasteEvent);
    await sleep(1500);
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
    await sleep(500);

    const captionInput =
      document.querySelector('[data-testid="media-caption-input-container"] div[contenteditable="true"]') ||
      document.querySelector('[data-testid="media-caption-text-input"]') ||
      findCaptionContentEditable();

    if (captionInput) {
      captionInput.focus();
      await sleep(200);
      document.execCommand("insertText", false, text);
      captionInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
    }
  }

  function findCaptionContentEditable() {
    const allEditable = document.querySelectorAll('div[contenteditable="true"]');
    const mainCompose = document.querySelector('div[contenteditable="true"][data-tab="10"]');

    for (const el of allEditable) {
      if (el !== mainCompose && el.closest('[data-testid="media-editor"]')) {
        return el;
      }
    }
    for (let i = allEditable.length - 1; i >= 0; i--) {
      if (allEditable[i] !== mainCompose) return allEditable[i];
    }
    return null;
  }

  // ── Click send button ────────────────────────────────────────
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
