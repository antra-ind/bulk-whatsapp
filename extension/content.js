// Content script injected into WhatsApp Web
// Handles ONLY DOM operations — no navigation.
// Navigation is done by background.js before this script is called.

(function () {
  "use strict";

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "performSend") {
      performSend(request)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }
  });

  async function performSend({ hasAttachment, attachment, caption }) {
    // Wait for the chat compose box to appear (page was just navigated here)
    try {
      await waitForChatReady();
    } catch (err) {
      throw new Error(
        `CHAT_NOT_READY: ${err.message}. ` +
        "Make sure WhatsApp Web is logged in and the phone number exists on WhatsApp."
      );
    }
    await sleep(1500);

    if (hasAttachment) {
      // Open the attachment menu and send file via the hidden file input
      try {
        await sendFileViaAttachButton(attachment);
      } catch (err) {
        throw new Error(
          `ATTACHMENT_FAILED: Could not attach file "${attachment.name}". ` +
          `${err.message}. Try a smaller file or different format.`
        );
      }

      // Wait for the attachment preview / media editor screen
      await waitForAttachmentPreview();
      await sleep(800);

      // Type caption if provided
      if (caption) {
        await typeCaption(caption);
        await sleep(500);
      }

      // Click send on the attachment preview
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
      // Text was pre-filled by the URL (?text=...), just click send
      await sleep(500);
      try {
        await clickSendButton();
      } catch (err) {
        throw new Error(
          "SEND_BUTTON_NOT_FOUND: Could not find the send button. " +
          "Make sure the chat loaded. Try refreshing WhatsApp Web."
        );
      }
      await sleep(1500);
    }

    return { success: true };
  }

  // ── Wait for chat to be ready ────────────────────────────────
  function waitForChatReady() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds

      const check = setInterval(() => {
        attempts++;

        // Check for various error popups
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
          document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
          document.querySelector('footer div[contenteditable="true"]') ||
          document.querySelector('[data-testid="conversation-compose-box-input"]');

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

  // ── Send file via the attachment button + hidden input ───────
  async function sendFileViaAttachButton(attachment) {
    // Convert dataUrl back to a File
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
    // Click the "+" / paperclip attachment button
    const attachBtn =
      document.querySelector('[data-testid="attach-menu-plus"]') ||
      document.querySelector('span[data-icon="plus"]')?.closest("button") ||
      document.querySelector('span[data-icon="attach-menu-plus"]')?.closest("div[role='button']") ||
      document.querySelector('span[data-icon="plus"]')?.closest("div[role='button']") ||
      document.querySelector('[title="Attach"]') ||
      document.querySelector('[aria-label="Attach"]');

    if (!attachBtn) return false;

    attachBtn.click();
    await sleep(800);

    // Find the appropriate file input
    // WhatsApp Web creates hidden <input type="file"> elements for each attachment type
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) return false;

    // Choose the right input based on file type
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

    // Fallback: use the last file input (usually the document/generic one)
    if (!targetInput) {
      targetInput = fileInputs[fileInputs.length - 1];
    }

    // Set the file on the input using DataTransfer
    const dt = new DataTransfer();
    dt.items.add(file);
    targetInput.files = dt.files;

    // Trigger change event
    targetInput.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1000);
    return true;
  }

  async function tryClipboardPaste(file) {
    // Fallback: paste via ClipboardEvent
    const target =
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector("footer div[contenteditable='true']") ||
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
      const maxAttempts = 20; // 10 seconds

      const check = setInterval(() => {
        attempts++;

        // Check for media editor / preview panel
        const preview =
          document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-canvas"]') ||
          document.querySelector('[data-testid="image-preview"]') ||
          document.querySelector('[data-testid="media-editor-container"]') ||
          document.querySelector(".draw-container");

        // Also check if a send button appeared in the preview
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
          resolve(); // Don't reject — might still work
        }
      }, 500);
    });
  }

  // ── Type caption in the attachment preview ───────────────────
  async function typeCaption(text) {
    await sleep(500);

    // Find caption input — it's a contenteditable div in the media editor
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
    // Find the contenteditable that's NOT the main compose box
    const allEditable = document.querySelectorAll('div[contenteditable="true"]');
    const mainCompose = document.querySelector('div[contenteditable="true"][data-tab="10"]');

    for (const el of allEditable) {
      if (el !== mainCompose && el.closest('[data-testid="media-editor"]')) {
        return el;
      }
    }
    // Fallback: last contenteditable that isn't the main compose
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

        // Try multiple selectors for the send button
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

        // Fallback after several attempts: press Enter on compose box
        if (attempts >= 5) {
          const composeBox =
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
