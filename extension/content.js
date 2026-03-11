// Content script injected into WhatsApp Web
// Handles sending messages + attachments to phone numbers without saving contacts

(function () {
  "use strict";

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendMessage") {
      handleSendMessage(request.phone, request.message, request.attachment)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }
  });

  async function handleSendMessage(phone, message, attachment) {
    // Navigate to chat with this phone number
    const chatUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;

    if (attachment) {
      // With attachment: navigate to chat, paste file via clipboard, add caption, send
      window.location.href = chatUrl;
      await waitForChatReady();
      await sleep(1000);

      // Paste the file into the chat using clipboard API
      await pasteFileAttachment(attachment);

      // Wait for the attachment preview / caption screen
      await waitForAttachmentPreview();

      // If there's a message, type it as a caption
      if (message) {
        await typeCaption(message);
      }

      // Click the send button on the attachment preview
      await clickAttachmentSend();
      await sleep(2000);
    } else {
      // Text only: use the URL with text parameter
      const textUrl = `${chatUrl}&text=${encodeURIComponent(message)}`;
      window.location.href = textUrl;
      await waitForChatReady();
      await sleep(500);
      await clickSendButton();
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

        // Check for error popups (invalid number)
        const errorPopup = document.querySelector('[data-testid="popup-contents"]');
        if (errorPopup && errorPopup.textContent.includes("invalid")) {
          clearInterval(check);
          reject(new Error("Invalid phone number or not on WhatsApp"));
          return;
        }

        // Check for the compose box or conversation panel
        const composeBox = document.querySelector(
          'div[contenteditable="true"][data-tab="10"]'
        );
        const footer = document.querySelector("footer");

        if (composeBox || footer) {
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

  // ── Paste file as attachment via clipboard ───────────────────
  async function pasteFileAttachment(attachment) {
    // Convert data URL back to a File object
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], attachment.name, { type: attachment.type });

    // Create a ClipboardEvent with the file
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Find the compose area or the main app element to dispatch the paste event
    const target =
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector("#main") ||
      document.querySelector("#app");

    if (!target) {
      throw new Error("Could not find chat input area");
    }

    // Dispatch paste event — this is how WhatsApp Web receives files
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    target.dispatchEvent(pasteEvent);

    await sleep(500);
  }

  // ── Wait for attachment preview to appear ────────────────────
  function waitForAttachmentPreview() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds

      const check = setInterval(() => {
        attempts++;

        // Look for the attachment preview / media editor
        const sendMediaBtn = document.querySelector(
          'span[data-icon="send"],' +
          '[data-testid="send"],' +
          'div[aria-label="Send"]'
        );

        const captionInput = document.querySelector(
          'div[contenteditable="true"][data-tab="10"],' +
          'div.copyable-text[contenteditable="true"]'
        );

        // The image preview panel
        const previewPanel = document.querySelector(
          '[data-testid="media-canvas"],' +
          '[data-testid="image-preview"],' +
          '.draw-container,' +
          '._2swyp,' +
          '[data-testid="media-editor"]'
        );

        if (previewPanel || (sendMediaBtn && attempts > 3)) {
          clearInterval(check);
          resolve();
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(check);
          // Don't reject — might still work, the preview might have a different layout
          resolve();
        }
      }, 500);
    });
  }

  // ── Type caption on the attachment preview ───────────────────
  async function typeCaption(text) {
    await sleep(500);

    // Find the caption input (contenteditable div on the attachment preview)
    const captionInputs = document.querySelectorAll(
      'div[contenteditable="true"]'
    );

    // The caption input is usually the last contenteditable div or has specific attributes
    let captionInput = null;
    for (const input of captionInputs) {
      // Find the one with placeholder "Add a caption" or similar
      const placeholder = input.getAttribute("data-lexical-text") ||
        input.closest('[data-testid="media-caption-input-container"]') ||
        input.getAttribute("title");
      if (placeholder || input.closest(".copyable-area")) {
        captionInput = input;
      }
    }

    // Fallback: use the last contenteditable
    if (!captionInput && captionInputs.length > 0) {
      captionInput = captionInputs[captionInputs.length - 1];
    }

    if (captionInput) {
      captionInput.focus();
      // Use execCommand for compat with WhatsApp's React-based input
      document.execCommand("insertText", false, text);
      // Also dispatch input event
      captionInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
    }
  }

  // ── Click send on attachment preview ─────────────────────────
  function clickAttachmentSend() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 10;

      const tryClick = setInterval(() => {
        attempts++;

        const sendBtn =
          document.querySelector('span[data-icon="send"]')?.closest("button") ||
          document.querySelector('span[data-icon="send"]')?.closest('[role="button"]') ||
          document.querySelector('[data-testid="send"]') ||
          document.querySelector('div[aria-label="Send"]');

        if (sendBtn) {
          clearInterval(tryClick);
          sendBtn.click();
          resolve();
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(tryClick);
          reject(new Error("Could not find send button for attachment"));
        }
      }, 500);
    });
  }

  // ── Click the regular send button (text only) ────────────────
  function clickSendButton() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 10;

      const tryClick = setInterval(() => {
        attempts++;

        const sendBtn =
          document.querySelector('span[data-icon="send"]')?.closest("button") ||
          document.querySelector('button[aria-label="Send"]') ||
          document.querySelector('[data-testid="send"]') ||
          document.querySelector('span[data-icon="send"]')?.parentElement;

        if (sendBtn) {
          clearInterval(tryClick);
          sendBtn.click();
          resolve();
          return;
        }

        // Fallback: press Enter on compose box
        const composeBox = document.querySelector(
          'div[contenteditable="true"][data-tab="10"]'
        );
        if (composeBox && attempts >= 3) {
          clearInterval(tryClick);
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
