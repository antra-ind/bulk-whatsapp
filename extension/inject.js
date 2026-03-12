// inject.js — Runs in the PAGE'S MAIN WORLD (not the content script's isolated world).
// This is critical because WhatsApp Web uses React, and events dispatched from
// the content script's isolated world are not seen by React's event handlers.
// Communication with the content script happens via CustomEvent on document.

(function () {
  "use strict";

  const INJECT_VERSION = "1.2.3";
  if (window.__bulkWAInjectVersion === INJECT_VERSION) return;
  window.__bulkWAInjectVersion = INJECT_VERSION;

  // ── Listen for file-attach requests from the content script ──
  document.addEventListener("__bulkWA_attachFile", async (e) => {
    const { fileData, fileName, fileType, method } = e.detail;

    try {
      // Convert base64 back to File
      const response = await fetch(fileData);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: fileType });

      let success = false;

      if (method === "drop") {
        success = doDrop(file);
      } else if (method === "paste") {
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

  // ── Attach via menu: Attach → Photos & Videos → intercept file dialog → set file ──
  // This is the ONLY method that works on WhatsApp Web (confirmed by scanner).
  // The key trick: we intercept the file input's click to prevent the OS dialog,
  // then set the file programmatically.
  document.addEventListener("__bulkWA_attachViaMenu", async (e) => {
    const { fileData, fileName, fileType } = e.detail;

    try {
      const response = await fetch(fileData);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: fileType });

      // Step 1: Intercept ALL file input clicks to prevent native OS dialog
      const originalClick = HTMLInputElement.prototype.click;
      let interceptedInput = null;
      HTMLInputElement.prototype.click = function () {
        if (this.type === "file") {
          interceptedInput = this;
          // Do NOT call original — this prevents the OS file dialog
          return;
        }
        return originalClick.call(this);
      };

      // Step 2: Click the Attach button
      const attachBtn =
        document.querySelector('button[aria-label="Attach"]') ||
        document.querySelector('span[data-icon="plus-rounded"]')?.closest("button") ||
        document.querySelector('span[data-icon="plus"]')?.closest("button") ||
        document.querySelector('[title="Attach"]');

      if (!attachBtn) {
        HTMLInputElement.prototype.click = originalClick;
        document.dispatchEvent(new CustomEvent("__bulkWA_attachViaMenuResult", {
          detail: { success: false, error: "attach button not found" },
        }));
        return;
      }

      attachBtn.click();
      await sleep(1500);

      // Step 3: Find and click the "Photos & videos" menu item
      const photoItem =
        document.querySelector('[aria-label="Photos & videos"]') ||
        document.querySelector('[aria-label*="photo" i]') ||
        document.querySelector('[aria-label*="Photos" i]') ||
        (() => {
          const items = document.querySelectorAll('[role="menuitem"]');
          for (const item of items) {
            if (/photos|image|photo/i.test(item.textContent || "")) return item;
          }
          return null;
        })();

      if (!photoItem) {
        HTMLInputElement.prototype.click = originalClick;
        document.dispatchEvent(new CustomEvent("__bulkWA_attachViaMenuResult", {
          detail: { success: false, error: "photo menu item not found" },
        }));
        return;
      }

      photoItem.click();

      // Step 4: Wait briefly for the intercepted click to happen
      await sleep(500);

      // Step 5: Restore original click
      HTMLInputElement.prototype.click = originalClick;

      // Step 6: Set the file on the intercepted input (or find one)
      const targetInput = interceptedInput ||
        document.querySelector('input[type="file"][accept*="image"]') ||
        document.querySelector('input[type="file"]');

      if (!targetInput) {
        document.dispatchEvent(new CustomEvent("__bulkWA_attachViaMenuResult", {
          detail: { success: false, error: "no file input found" },
        }));
        return;
      }

      // Set file using native setter
      const dt = new DataTransfer();
      dt.items.add(file);
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "files"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(targetInput, dt.files);
      } else {
        targetInput.files = dt.files;
      }
      targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      targetInput.dispatchEvent(new Event("change", { bubbles: true }));

      document.dispatchEvent(new CustomEvent("__bulkWA_attachViaMenuResult", {
        detail: { success: true, intercepted: !!interceptedInput },
      }));
    } catch (err) {
      document.dispatchEvent(new CustomEvent("__bulkWA_attachViaMenuResult", {
        detail: { success: false, error: err.message },
      }));
    }
  });

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

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

  // ── Drop file onto the chat area (most reliable for React) ───
  function doDrop(file) {
    // Find the chat conversation area to drop onto
    const dropTarget =
      document.querySelector('[data-testid="conversation-panel-body"]') ||
      document.querySelector("#main") ||
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector("#app");

    if (!dropTarget) return false;

    const dt = new DataTransfer();
    dt.items.add(file);

    // Simulate the full drag-and-drop sequence that React listens for
    const commonOpts = { bubbles: true, cancelable: true, dataTransfer: dt };

    dropTarget.dispatchEvent(new DragEvent("dragenter", commonOpts));
    dropTarget.dispatchEvent(new DragEvent("dragover", commonOpts));
    dropTarget.dispatchEvent(new DragEvent("drop", commonOpts));

    return true;
  }

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
    target.dispatchEvent(pasteEvent);
    return true;
  }

  // ── Set file on a file input element ─────────────────────────
  function doFileInput(file) {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) {
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

    return true;
  }

  // ── Type text into the compose box (for captions in preview) ──
  // WhatsApp uses Lexical editor which listens for InputEvent, not execCommand.
  // Running this from MAIN world ensures React/Lexical sees the events properly.
  document.addEventListener("__bulkWA_typeText", async (e) => {
    const { text, selector } = e.detail;
    try {
      const el =
        (selector && document.querySelector(selector)) ||
        document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="10"]');

      if (!el) {
        document.dispatchEvent(new CustomEvent("__bulkWA_typeTextResult", {
          detail: { success: false, error: "compose box not found" },
        }));
        return;
      }

      // Click the element to activate Lexical's focus handling
      el.click();
      await sleep(200);
      el.focus();
      await sleep(200);

      // Select all and delete existing content using keyboard events
      // Lexical handles Ctrl+A / Meta+A for select-all
      el.dispatchEvent(new KeyboardEvent("keydown", {
        key: "a", code: "KeyA", keyCode: 65,
        ctrlKey: true, metaKey: true, bubbles: true,
      }));
      await sleep(100);

      // Try execCommand first (works in some contexts)
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(100);

      // Type the text using execCommand (Lexical does support this in many cases)
      const inserted = document.execCommand("insertText", false, text);

      if (!inserted || el.textContent.trim() !== text.trim()) {
        // Fallback: dispatch InputEvent which Lexical listens for
        el.textContent = "";
        el.dispatchEvent(new InputEvent("beforeinput", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          cancelable: true,
          composed: true,
        }));
        el.dispatchEvent(new InputEvent("input", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          composed: true,
        }));
      }

      // Also dispatch a regular input event for good measure
      el.dispatchEvent(new Event("input", { bubbles: true }));

      await sleep(200);
      const typed = el.textContent.trim().length > 0;

      document.dispatchEvent(new CustomEvent("__bulkWA_typeTextResult", {
        detail: { success: typed, textContent: el.textContent.substring(0, 100) },
      }));
    } catch (err) {
      document.dispatchEvent(new CustomEvent("__bulkWA_typeTextResult", {
        detail: { success: false, error: err.message },
      }));
    }
  });

  // ── Click the send button ────────────────────────────────────
  function doClickSend() {
    // Priority 1: WhatsApp's current send icon (wds-ic-send-filled)
    const wdsSend = document.querySelector('span[data-icon="wds-ic-send-filled"]');
    if (wdsSend) {
      const btn = wdsSend.closest("button") || wdsSend.closest('div[role="button"]') || wdsSend;
      btn.click();
      return true;
    }

    // Priority 2: Legacy send selectors
    const sendBtn =
      document.querySelector('[data-testid="send"]') ||
      document.querySelector('span[data-icon="send"]')?.closest("button") ||
      document.querySelector('span[data-icon="send"]')?.closest('div[role="button"]') ||
      document.querySelector('button[aria-label="Send"]') ||
      document.querySelector('span[data-icon="send"]')?.parentElement;

    if (sendBtn) {
      sendBtn.click();
      return true;
    }

    return false;
  }

})();
