// ── Storage helpers ─────────────────────────────────────────────
async function getStorage(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => resolve(data[key] ?? fallback));
  });
}

async function setStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ── State ──────────────────────────────────────────────────────
let isSending = false;
let stopRequested = false;
let singleFileData = null; // { name, type, size, dataUrl }
let bulkFileData = null;

// ── DOM refs ───────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Tab switching ──────────────────────────────────────────────
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".tab-content").forEach((tc) => tc.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── WhatsApp Web connection check ──────────────────────────────
async function checkWhatsAppTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        $("#wa-status").className = "status-dot connected";
        $("#wa-status-text").textContent = "WhatsApp Web connected";
        resolve(tabs[0]);
      } else {
        $("#wa-status").className = "status-dot disconnected";
        $("#wa-status-text").textContent = "Open WhatsApp Web first";
        resolve(null);
      }
    });
  });
}

checkWhatsAppTab();
setInterval(checkWhatsAppTab, 3000);

// ── File handling helpers ──────────────────────────────────────
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function setupFileInput(fileInputId, dropZoneId, previewId, setData) {
  const fileInput = $(fileInputId);
  const dropZone = $(dropZoneId);
  const preview = $(previewId);

  async function handleFile(file) {
    if (!file) return;
    // Limit to 16MB (WhatsApp limit)
    if (file.size > 16 * 1024 * 1024) {
      alert("File too large. WhatsApp limit is 16MB.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const data = { name: file.name, type: file.type, size: file.size, dataUrl };
    setData(data);
    renderFilePreview(preview, data, () => {
      setData(null);
      preview.classList.add("hidden");
      fileInput.value = "";
    });
  }

  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // Drag & drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
}

function renderFilePreview(container, data, onRemove) {
  container.classList.remove("hidden");
  let mediaHtml = "";
  if (data.type.startsWith("image/")) {
    mediaHtml = `<img src="${data.dataUrl}" alt="preview" />`;
  } else if (data.type.startsWith("video/")) {
    mediaHtml = `<video src="${data.dataUrl}" muted></video>`;
  } else {
    mediaHtml = `<span style="font-size:24px">📄</span>`;
  }
  container.innerHTML = `
    ${mediaHtml}
    <div class="file-info">
      <div class="file-name">${escapeHtml(data.name)}</div>
      <div class="file-size">${formatFileSize(data.size)}</div>
    </div>
    <button class="file-remove" title="Remove">✕</button>
  `;
  container.querySelector(".file-remove").addEventListener("click", onRemove);
}

// Setup file inputs
setupFileInput("#single-file", "#single-drop-zone", "#single-file-preview", (d) => { singleFileData = d; });
setupFileInput("#bulk-file", "#bulk-drop-zone", "#bulk-file-preview", (d) => { bulkFileData = d; });

// ── Dynamic variable hints from headers ────────────────────────
function updateVariableHints() {
  const headers = $("#bulk-headers").value
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h && h !== "phone");
  const hints = headers.map((h) => `{{${h}}}`).join("  ");
  $("#variable-hints").textContent = hints || "(none)";
}

$("#bulk-headers").addEventListener("input", updateVariableHints);
updateVariableHints();

// ── Single message ─────────────────────────────────────────────
$("#btn-send-single").addEventListener("click", async () => {
  const phone = $("#single-phone").value.replace(/[\s\-\+\(\)]/g, "").trim();
  const message = $("#single-message").value.trim();

  if (!phone) return alert("Enter a phone number");
  if (!message && !singleFileData) return alert("Enter a message or attach a file");

  const waTab = await checkWhatsAppTab();
  if (!waTab) {
    chrome.tabs.create({ url: "https://web.whatsapp.com" });
    alert("WhatsApp Web is opening. Wait for it to load, then try again.");
    return;
  }

  updateStatus("sending", "Sending...");

  try {
    await sendMessageViaBackground(phone, message, singleFileData);
    await addHistory(phone, "", message, "sent", singleFileData ? singleFileData.name : null);
    updateStatus("connected", "Message sent!");
    $("#single-phone").value = "";
    $("#single-message").value = "";
    singleFileData = null;
    $("#single-file-preview").classList.add("hidden");
    $("#single-file").value = "";
  } catch (err) {
    await addHistory(phone, "", message, "failed", singleFileData ? singleFileData.name : null);
    updateStatus("error", "Send failed");
    showErrorToast(err.message);
  }
});

// ── CSV Upload with auto-detect headers ────────────────────────
$("#csv-upload").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return;

    // Detect if first row is a header
    const firstRow = lines[0].split(",").map((c) => c.trim());
    const isHeader = /^[a-zA-Z_]+$/.test(firstRow[0]);

    let headers;
    let startIdx;

    if (isHeader) {
      headers = firstRow.map((h) => h.toLowerCase());
      startIdx = 1;
      // Update the headers input
      $("#bulk-headers").value = headers.join(",");
      updateVariableHints();
      // Show detected columns
      const info = $("#csv-columns-info");
      info.textContent = `Detected columns: ${headers.join(", ")} (${lines.length - 1} contacts)`;
      info.classList.remove("hidden");
    } else {
      headers = $("#bulk-headers").value.split(",").map((h) => h.trim().toLowerCase());
      startIdx = 0;
      const info = $("#csv-columns-info");
      info.textContent = `Loaded ${lines.length} contacts (using headers: ${headers.join(", ")})`;
      info.classList.remove("hidden");
    }

    const contacts = [];
    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split(",").map((p) => p.trim());
      if (parts[0]) contacts.push(parts.join(","));
    }

    $("#bulk-contacts").value = contacts.join("\n");
  };
  reader.readAsText(file);
});

// ── Parse contacts with dynamic headers ────────────────────────
function parseContacts() {
  const raw = $("#bulk-contacts").value.trim();
  if (!raw) return [];

  const headers = $("#bulk-headers").value
    .split(",")
    .map((h) => h.trim().toLowerCase());

  return raw
    .split("\n")
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const phone = (parts[0] || "").replace(/[\s\-\+\(\)]/g, "");
      if (!phone) return null;

      // Build a data object from headers
      const data = {};
      headers.forEach((h, i) => {
        data[h] = parts[i] || "";
      });
      data.phone = phone;
      return data;
    })
    .filter(Boolean);
}

// Replace all {{variable}} in message with contact data
function personaliseMessage(message, contactData) {
  return message.replace(/\{\{(\w+)\}\}/gi, (match, key) => {
    return contactData[key.toLowerCase()] || "";
  });
}

// ── Bulk Preview ───────────────────────────────────────────────
// ── Live warnings for delay and contact count ──────────────────
function updateDelayWarning() {
  const minVal = parseInt($("#bulk-delay-min").value) || 5;
  const warning = $("#delay-warning");
  if (minVal < 8) {
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

function updateContactWarning() {
  const contacts = parseContacts();
  const warning = $("#contact-warning");
  if (contacts.length > 250) {
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

$("#bulk-delay-min").addEventListener("input", updateDelayWarning);
$("#bulk-delay-max").addEventListener("input", updateDelayWarning);
$("#bulk-contacts").addEventListener("input", updateContactWarning);
$("#csv-upload").addEventListener("change", () => setTimeout(updateContactWarning, 500));

// Initial check
updateDelayWarning();

$("#btn-preview-bulk").addEventListener("click", () => {
  const contacts = parseContacts();
  const message = $("#bulk-message").value.trim();

  if (contacts.length === 0) return alert("Add at least one contact");
  if (!message && !bulkFileData) return alert("Enter a message or attach a file");

  const previewList = $("#preview-list");
  previewList.innerHTML = "";
  $("#preview-count").textContent = `(${contacts.length} contacts)`;

  contacts.forEach((c, i) => {
    const personalised = personaliseMessage(message, c);
    const div = document.createElement("div");
    div.className = "preview-item";
    div.innerHTML = `
      <div class="preview-header">
        <span class="name">${i + 1}. ${escapeHtml(c.name || "(no name)")}</span>
        <span class="phone">+${escapeHtml(c.phone)}</span>
      </div>
      <div class="preview-msg">${escapeHtml(personalised)}${bulkFileData ? " 📎" + escapeHtml(bulkFileData.name) : ""}</div>
    `;
    previewList.appendChild(div);
  });

  $("#bulk-preview").classList.remove("hidden");
});

// ── Bulk Send ──────────────────────────────────────────────────
$("#btn-send-bulk").addEventListener("click", async () => {
  if (isSending) return;

  const contacts = parseContacts();
  const message = $("#bulk-message").value.trim();
  const delayMin = Math.max(3, parseInt($("#bulk-delay-min").value) || 5) * 1000;
  const delayMax = Math.max(delayMin + 2000, parseInt($("#bulk-delay-max").value) || 12) * 1000;

  if (contacts.length === 0) return alert("Add at least one contact");
  if (!message && !bulkFileData) return alert("Enter a message or attach a file");

  // Warn if delay is too low
  if (delayMin < 8000) {
    const proceedDelay = confirm(
      "⚠️ Warning: Delay below 8 seconds increases the risk of your account being flagged by WhatsApp.\n\nDo you want to continue anyway?"
    );
    if (!proceedDelay) return;
  }

  // Warn if too many contacts
  if (contacts.length > 250) {
    const proceedCount = confirm(
      `⚠️ Warning: You are about to send to ${contacts.length} contacts.\n\nSending more than 250 messages per day can get your WhatsApp account temporarily or permanently blocked.\n\nDo you want to continue anyway?`
    );
    if (!proceedCount) return;
  }

  const waTab = await checkWhatsAppTab();
  if (!waTab) {
    chrome.tabs.create({ url: "https://web.whatsapp.com" });
    alert("WhatsApp Web is opening. Wait for it to load, then try again.");
    return;
  }

  const attachInfo = bulkFileData ? ` + 📎 ${bulkFileData.name}` : "";
  const ok = confirm(
    `Send to ${contacts.length} contact(s)?${attachInfo}\nDelay: ${delayMin / 1000}–${delayMax / 1000}s (random) between messages`
  );
  if (!ok) return;

  isSending = true;
  stopRequested = false;

  // Ask content script to keep the browser awake
  sendKeepAwake(waTab.id, true);

  $("#btn-send-bulk").classList.add("hidden");
  $("#btn-stop-bulk").classList.remove("hidden");
  $("#btn-stop-bulk").disabled = false;
  $("#btn-stop-bulk").textContent = "Stop";
  $("#bulk-progress").classList.remove("hidden");

  const log = $("#progress-log");
  log.innerHTML = "";

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < contacts.length; i++) {
    if (stopRequested) {
      appendLog(log, "⏹ Stopped by user", "skip");
      break;
    }

    const contact = contacts[i];
    const personalised = personaliseMessage(message, contact);

    updateProgress(i, contacts.length, sent, failed);
    updateStatus("sending", `Sending ${i + 1}/${contacts.length}...`);

    try {
      await sendMessageViaBackground(contact.phone, personalised, bulkFileData);
      sent++;
      appendLog(log, `✓ Sent to ${contact.name || contact.phone}`, "success");
      await addHistory(contact.phone, contact.name || "", personalised, "sent", bulkFileData ? bulkFileData.name : null);
    } catch (err) {
      failed++;
      appendLog(log, `✗ Failed: ${contact.phone} — ${err.message}`, "error");
      showErrorToast(err.message);
      await addHistory(contact.phone, contact.name || "", personalised, "failed", bulkFileData ? bulkFileData.name : null);
    }

    updateProgress(i + 1, contacts.length, sent, failed);

    if (i < contacts.length - 1 && !stopRequested) {
      const randomDelay = delayMin + Math.random() * (delayMax - delayMin);
      const delaySec = Math.round(randomDelay / 1000);
      appendLog(log, `⏳ Waiting ${delaySec}s...`, "skip");
      await sleep(randomDelay);
    }
  }

  isSending = false;

  // Release wake lock
  sendKeepAwake(waTab.id, false);

  $("#btn-send-bulk").classList.remove("hidden");
  $("#btn-stop-bulk").classList.add("hidden");

  updateStatus("connected", `Done! Sent: ${sent}, Failed: ${failed}`);
  appendLog(log, `── Done: ${sent} sent, ${failed} failed ──`, "summary");
});

// ── Stop button ────────────────────────────────────────────────
$("#btn-stop-bulk").addEventListener("click", () => {
  stopRequested = true;
  $("#btn-stop-bulk").disabled = true;
  $("#btn-stop-bulk").textContent = "Stopping...";
});

// ── Send message via background script ──────────────────────────
function sendMessageViaBackground(phone, message, fileData) {
  return new Promise((resolve, reject) => {
    const payload = { action: "sendMessage", phone, message };
    if (fileData) {
      payload.attachment = {
        name: fileData.name,
        type: fileData.type,
        dataUrl: fileData.dataUrl,
      };
    }
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response && response.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || "Unknown error"));
      }
    });
  });
}

// ── Templates ──────────────────────────────────────────────────
$("#btn-save-template").addEventListener("click", async () => {
  const name = $("#template-name").value.trim();
  const message = $("#template-message").value.trim();

  if (!name) return alert("Enter a template name");
  if (!message) return alert("Enter a template message");

  const templates = await getStorage("templates", []);
  templates.push({ name, message, createdAt: Date.now() });
  await setStorage("templates", templates);

  $("#template-name").value = "";
  $("#template-message").value = "";
  renderTemplates();
});

async function renderTemplates() {
  const templates = await getStorage("templates", []);
  const container = $("#template-list");

  if (templates.length === 0) {
    container.innerHTML = '<p class="empty-msg">No templates saved yet</p>';
    return;
  }

  container.innerHTML = "";
  templates.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "template-item";
    div.innerHTML = `
      <div class="t-name">${escapeHtml(t.name)}</div>
      <div class="t-msg">${escapeHtml(t.message)}</div>
      <div class="t-actions">
        <button class="btn btn-secondary btn-sm use-template" data-idx="${i}">Use in Bulk</button>
        <button class="btn btn-danger btn-sm del-template" data-idx="${i}">Delete</button>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll(".use-template").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const templates = await getStorage("templates", []);
      if (templates[idx]) {
        $("#bulk-message").value = templates[idx].message;
        $$(".tab")[1].click();
      }
    });
  });

  container.querySelectorAll(".del-template").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const templates = await getStorage("templates", []);
      templates.splice(idx, 1);
      await setStorage("templates", templates);
      renderTemplates();
    });
  });
}

// ── History ────────────────────────────────────────────────────
async function addHistory(phone, name, message, status, attachmentName) {
  const history = await getStorage("history", []);
  history.unshift({
    phone,
    name,
    message,
    status,
    attachment: attachmentName || null,
    time: Date.now(),
  });
  if (history.length > 200) history.length = 200;
  await setStorage("history", history);
}

async function renderHistory() {
  const history = await getStorage("history", []);
  const container = $("#history-list");

  if (history.length === 0) {
    container.innerHTML = '<p class="empty-msg">No messages sent yet</p>';
    return;
  }

  container.innerHTML = "";
  history.forEach((h) => {
    const div = document.createElement("div");
    div.className = "history-item";
    const time = new Date(h.time).toLocaleString();
    div.innerHTML = `
      <div>
        <span class="h-phone">+${escapeHtml(h.phone)}</span>
        ${h.name ? `<span> (${escapeHtml(h.name)})</span>` : ""}
        <span class="h-status ${h.status}">${h.status}</span>
      </div>
      <div class="h-msg">${escapeHtml(h.message || "(attachment only)")}</div>
      ${h.attachment ? `<div class="h-attachment">📎 ${escapeHtml(h.attachment)}</div>` : ""}
      <div class="h-time">${escapeHtml(time)}</div>
    `;
    container.appendChild(div);
  });
}

$("#btn-clear-history").addEventListener("click", async () => {
  if (confirm("Clear all message history?")) {
    await setStorage("history", []);
    renderHistory();
  }
});

// ── Utility functions ──────────────────────────────────────────
function updateProgress(current, total, sent, failed) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-text").textContent = `${current} / ${total} processed (${sent} sent, ${failed} failed)`;
}

function appendLog(container, text, type) {
  const div = document.createElement("div");
  div.className = `log-entry ${type || ""}`;
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (type === "success" || type === "error") {
    div.innerHTML = `<span style="opacity:0.5">${escapeHtml(now)}</span> ${escapeHtml(text)}`;
  } else {
    div.textContent = text;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function updateStatus(state, text) {
  $("#wa-status").className = `status-dot ${state}`;
  $("#wa-status-text").textContent = text;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendKeepAwake(tabId, enable) {
  chrome.runtime.sendMessage({ action: "keepAwake", tabId, enable });
}

// ── Error toast ──────────────────────────────────────────────────
const ERROR_HINTS = {
  NO_WHATSAPP_TAB: "Open web.whatsapp.com in a tab, scan QR, wait for chats to load, then try again.",
  NOT_LOGGED_IN: "Open WhatsApp on your phone → Settings → Linked Devices → scan the QR code.",
  INVALID_PHONE: "Use full number with country code, no spaces or dashes. Example: 919876543210",
  NAVIGATION_FAILED: "The WhatsApp Web tab may have been closed. Reopen it and try again.",
  PAGE_LOAD_TIMEOUT: "Your internet may be slow or WhatsApp Web is down. Refresh and retry.",
  CONTENT_SCRIPT_FAILED: "Refresh WhatsApp Web (Ctrl+R / Cmd+R), wait for it to load, then resend.",
  CHAT_NOT_READY: "The chat didn't open. The number may not be on WhatsApp, or WhatsApp Web is still loading.",
  ATTACHMENT_FAILED: "Try a smaller file (under 16MB), or a different format (JPG, PNG, MP4, PDF).",
  SEND_BUTTON_NOT_FOUND: "WhatsApp Web UI may have updated. Refresh the page and try again.",
  SEND_FAILED: "Something went wrong during send. Check if WhatsApp Web is still open and logged in.",
};

function showErrorToast(errMessage) {
  const toast = $("#error-toast");
  const titleEl = $("#error-toast-title");
  const msgEl = $("#error-toast-msg");
  const hintEl = $("#error-toast-hint");

  // Parse error code from message like "CODE: details"
  const codeMatch = errMessage.match(/^([A-Z_]+):\s*(.*)/);
  let title = "Send Failed";
  let msg = errMessage;
  let hint = "";

  if (codeMatch) {
    const code = codeMatch[1];
    msg = codeMatch[2];
    title = code.replace(/_/g, " ");
    hint = ERROR_HINTS[code] || "";
  } else {
    // Try to match partial
    for (const [code, h] of Object.entries(ERROR_HINTS)) {
      if (errMessage.toLowerCase().includes(code.toLowerCase().replace(/_/g, " "))) {
        hint = h;
        break;
      }
    }
    if (!hint) {
      hint = "Make sure WhatsApp Web is open, logged in, and your internet is working.";
    }
  }

  titleEl.textContent = title;
  msgEl.textContent = msg;
  hintEl.textContent = hint ? "💡 " + hint : "";

  toast.classList.remove("hidden");

  // Auto-hide after 10 seconds
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.add("hidden"), 10000);
}

$("#error-toast-close").addEventListener("click", () => {
  $("#error-toast").classList.add("hidden");
});

// ── Init ───────────────────────────────────────────────────────
renderTemplates();
renderHistory();

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.tab === "history") renderHistory();
    if (tab.dataset.tab === "templates") renderTemplates();
  });
});
