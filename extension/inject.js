// inject.js — Runs in the PAGE'S MAIN WORLD (not the content script's isolated world).
// This is critical because WhatsApp Web uses React, and events dispatched from
// the content script's isolated world are not seen by React's event handlers.
// Communication with the content script happens via CustomEvent on document.

(function () {
  "use strict";

  if (window.__bulkWAInjectLoaded) return;
  window.__bulkWAInjectLoaded = true;

  // ── Listen for file-attach requests from the content script ──
  document.addEventListener("__bulkWA_attachFile", async (e) => {
    const { fileData, fileName, fileType, method } = e.detail;

    try {
      // Convert base64 back to File
      const response = await fetch(fileData);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: fileType });

      let success = false;

      if (method === "paste") {
        success = doPaste(file);
      } else if (method === "input") {
        success = doFileInput(file);
      }

      document.dispatchEvent(
        new CustomEvent("__bulkWA_attachResult", {
          detail: { success, method },
        })
      );
    } catch (err) {
      console.error("[BulkWA inject] Error:", err);
      document.dispatchEvent(
        new CustomEvent("__bulkWA_attachResult", {
          detail: { success: false, error: err.message },
        })
      );
    }
  });

  // ── Listen for send-click requests from the content script ───
  document.addEventListener("__bulkWA_clickSend", () => {
    const success = doClickSend();
    document.dispatchEvent(
      new CustomEvent("__bulkWA_clickSendResult", {
        detail: { success },
      })
    );
  });

  // ── Listen for Enter key press requests ──────────────────────
  document.addEventListener("__bulkWA_pressEnter", (e) => {
    const { selector } = e.detail || {};
    const target = selector
      ? document.querySelector(selector)
      : document.activeElement;

    if (target) {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
      document.dispatchEvent(
        new CustomEvent("__bulkWA_pressEnterResult", { detail: { success: true } })
      );
    } else {
      document.dispatchEvent(
        new CustomEvent("__bulkWA_pressEnterResult", { detail: { success: false } })
      );
    }
  });

  // ── Paste file into the focused compose box ──────────────────
  function doPaste(file) {
    const composeBox =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('footer div[contenteditable="true"]');

    if (composeBox) {
      composeBox.focus();
    }

    const dt = new DataTransfer();
    dt.items.add(file);

    // In the main world, ClipboardEvent constructor's clipboardData works properly.
    // But just in case, we also use Object.defineProperty as a robust approach.
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: dt,
      writable: false,
    });

    const target = composeBox || document.querySelector("#app") || document.body;
    const dispatched = target.dispatchEvent(pasteEvent);
    console.log("[BulkWA inject] Paste dispatched on", target.tagName, "result:", dispatched);
    return true;
  }

  // ── Set file on a file input element ─────────────────────────
  function doFileInput(file) {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) {
      console.log("[BulkWA inject] No file inputs found");
      return false;
    }

    const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");
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

    // Use the native setter to bypass React's synthetic wrapper
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files"
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(targetInput, dt.files);
    } else {
      targetInput.files = dt.files;
    }

    // React listens on the native input event — fire both
    targetInput.dispatchEvent(new Event("input", { bubbles: true }));
    targetInput.dispatchEvent(new Event("change", { bubbles: true }));

    console.log(
      "[BulkWA inject] File set via native setter, accept:",
      targetInput.getAttribute("accept"),
      "files:",
      targetInput.files.length
    );
    return true;
  }

  // ── Click the send button ────────────────────────────────────
  function doClickSend() {
    // Priority 1: Send button inside media editor
    const mediaEditor =
      document.querySelector('[data-testid="media-editor"]') ||
      document.querySelector('[data-testid="media-editor-container"]');

    if (mediaEditor) {
      const btn =
        mediaEditor.querySelector('[data-testid="send"]') ||
        mediaEditor.querySelector('span[data-icon="send"]')?.closest("button") ||
        mediaEditor.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
        mediaEditor.querySelector('button[aria-label="Send"]') ||
        mediaEditor.querySelector('span[data-icon="send"]')?.parentElement;

      if (btn) {
        btn.click();
        console.log("[BulkWA inject] Clicked send in media editor");
        return true;
      }
    }

    // Priority 2: Any visible send button
    const sendBtn =
      document.querySelector('[data-testid="send"]') ||
      document.querySelector('span[data-icon="send"]')?.closest("button") ||
      document.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
      document.querySelector('button[aria-label="Send"]') ||
      document.querySelector('span[data-icon="send"]')?.parentElement;

    if (sendBtn) {
      sendBtn.click();
      console.log("[BulkWA inject] Clicked send button (global)");
      return true;
    }

    console.log("[BulkWA inject] No send button found");
    return false;
  }

  console.log("[BulkWA inject] Main-world helper loaded");
})();
