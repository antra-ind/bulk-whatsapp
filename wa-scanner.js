// WhatsApp Web UI Scanner — Automatic full scan + image attach + preview scan
// Paste in DevTools console on web.whatsapp.com (with a chat open).
// It will: 1) Scan normal state 2) Click attach 3) Pick a test image 4) Scan preview state
// 5) Auto-download a JSON file with everything.

(async function() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function scanDOM(label) {
    const scan = { label, timestamp: new Date().toISOString() };

    scan.buttons = [...document.querySelectorAll('button, [role="button"]')].map(el => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      testId: el.dataset?.testId,
      icon: el.querySelector('[data-icon]')?.dataset?.icon,
      role: el.getAttribute('role'),
      classes: el.className?.toString().slice(0, 100),
      visible: el.offsetParent !== null,
      text: el.textContent?.trim().slice(0, 50),
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
    }));

    scan.icons = [...document.querySelectorAll('[data-icon]')].map(el => ({
      icon: el.dataset.icon,
      tag: el.tagName,
      parentTag: el.parentElement?.tagName,
      parentRole: el.parentElement?.getAttribute('role'),
      parentAriaLabel: el.parentElement?.getAttribute('aria-label'),
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
      closestButton: el.closest('button')?.getAttribute('aria-label') || el.closest('[role="button"]')?.getAttribute('aria-label'),
      visible: el.offsetParent !== null,
    }));

    scan.testIds = [...document.querySelectorAll('[data-testid]')].map(el => ({
      testId: el.dataset.testId,
      tag: el.tagName,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      contentEditable: el.getAttribute('contenteditable'),
      visible: el.offsetParent !== null,
      childCount: el.children.length,
      text: el.textContent?.trim().slice(0, 40),
    }));

    scan.editables = [...document.querySelectorAll('[contenteditable="true"]')].map(el => ({
      tag: el.tagName,
      testId: el.dataset?.testId,
      dataTab: el.getAttribute('data-tab'),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder'),
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
      classes: el.className?.toString().slice(0, 100),
      visible: el.offsetParent !== null,
      text: el.textContent?.trim().slice(0, 40),
      ancestors: (() => {
        const anc = [];
        let p = el.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const info = { tag: p.tagName };
          if (p.dataset?.testId) info.testId = p.dataset.testId;
          if (p.getAttribute('role')) info.role = p.getAttribute('role');
          if (p.getAttribute('aria-label')) info.ariaLabel = p.getAttribute('aria-label');
          if (p.dataset?.icon) info.icon = p.dataset.icon;
          if (p.className) info.class = p.className.toString().slice(0, 60);
          anc.push(info);
          p = p.parentElement;
        }
        return anc;
      })(),
    }));

    scan.fileInputs = [...document.querySelectorAll('input[type="file"]')].map(el => ({
      accept: el.getAttribute('accept'),
      multiple: el.multiple,
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
      visible: el.offsetParent !== null,
      classes: el.className?.toString().slice(0, 100),
      parentHTML: el.parentElement?.outerHTML?.slice(0, 200),
    }));

    scan.ariaLabels = [...document.querySelectorAll('[aria-label]')].map(el => ({
      ariaLabel: el.getAttribute('aria-label'),
      tag: el.tagName,
      role: el.getAttribute('role'),
      testId: el.dataset?.testId,
      icon: el.querySelector('[data-icon]')?.dataset?.icon || el.dataset?.icon,
      visible: el.offsetParent !== null,
    })).filter(x => x.visible);

    scan.uniqueIcons = [...new Set(scan.icons.map(i => i.icon))].sort();
    scan.uniqueTestIds = [...new Set(scan.testIds.map(t => t.testId))].sort();
    scan.uniqueAriaLabels = [...new Set(scan.ariaLabels.map(a => a.ariaLabel))].sort();

    scan.sendRelated = {
      sendIcons: scan.icons.filter(i => /send|submit|wds.*send/i.test(i.icon)),
      attachIcons: scan.icons.filter(i => /attach|plus|clip|add/i.test(i.icon)),
      sendButtons: scan.buttons.filter(b => /send/i.test(b.ariaLabel || '') || /send/i.test(b.icon || '')),
      attachButtons: scan.buttons.filter(b => /attach|plus|clip/i.test(b.ariaLabel || '') || /attach|plus|clip/i.test(b.icon || '')),
      sendTestIds: scan.testIds.filter(t => /send/i.test(t.testId)),
      mediaTestIds: scan.testIds.filter(t => /media|editor|preview|image|caption|overlay/i.test(t.testId)),
    };

    return scan;
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Create a test image (1x1 red pixel PNG)
  function createTestImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '14px Arial';
    ctx.fillText('TEST', 30, 55);
    return new Promise(resolve => {
      canvas.toBlob(blob => {
        resolve(new File([blob], 'test-scan.png', { type: 'image/png' }));
      }, 'image/png');
    });
  }

  const fullResult = {
    scannedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: location.href,
    steps: {}
  };

  // ─── STEP 1: Scan normal chat state ─────────────────────────
  console.log('[Scanner] Step 1: Scanning normal chat state...');
  fullResult.steps.normalChat = scanDOM('normal-chat');
  console.log(`[Scanner] Found ${fullResult.steps.normalChat.buttons.length} buttons, ${fullResult.steps.normalChat.editables.length} editables`);

  // ─── STEP 2: Click the attach button ────────────────────────
  console.log('[Scanner] Step 2: Looking for attach button...');
  const attachBtn =
    document.querySelector('button[aria-label="Attach"]') ||
    document.querySelector('span[data-icon="plus-rounded"]')?.closest('button') ||
    document.querySelector('span[data-icon="plus"]')?.closest('button') ||
    document.querySelector('[title="Attach"]');

  if (!attachBtn) {
    console.error('[Scanner] Could not find attach button! Make sure a chat is open.');
    fullResult.error = 'Attach button not found. Open a chat first.';
    downloadJSON(fullResult, 'wa-scan-result.json');
    return;
  }

  console.log('[Scanner] Clicking attach button:', attachBtn.getAttribute('aria-label'), attachBtn.querySelector('[data-icon]')?.dataset?.icon);
  attachBtn.click();
  await sleep(2000);

  // ─── STEP 3: Scan after attach menu opened ──────────────────
  console.log('[Scanner] Step 3: Scanning after attach click...');
  fullResult.steps.afterAttachClick = scanDOM('after-attach-click');
  console.log(`[Scanner] Found ${fullResult.steps.afterAttachClick.fileInputs.length} file inputs`);

  // ─── STEP 4: Try to set file on file input ──────────────────
  console.log('[Scanner] Step 4: Creating test image and setting on file input...');
  const testFile = await createTestImage();

  const fileInputs = document.querySelectorAll('input[type="file"]');
  if (fileInputs.length === 0) {
    console.warn('[Scanner] No file inputs found after attach click. Trying paste method...');
    fullResult.steps.fileInputMethod = 'none-found';

    // Try paste instead
    const composeBox =
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('footer div[contenteditable="true"]');
    if (composeBox) composeBox.focus();
    await sleep(300);

    const dt = new DataTransfer();
    dt.items.add(testFile);
    const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: dt, writable: false });
    (composeBox || document.body).dispatchEvent(pasteEvent);
    console.log('[Scanner] Dispatched paste event');
  } else {
    // Find the image-accepting input
    let targetInput = null;
    for (const inp of fileInputs) {
      const accept = inp.getAttribute('accept') || '';
      if (accept.includes('image')) {
        targetInput = inp;
        break;
      }
    }
    if (!targetInput) targetInput = fileInputs[0];

    console.log('[Scanner] Using file input with accept:', targetInput.getAttribute('accept'));

    const dt = new DataTransfer();
    dt.items.add(testFile);
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) {
      nativeSetter.call(targetInput, dt.files);
    } else {
      targetInput.files = dt.files;
    }
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[Scanner] Set file on input and dispatched change event');
    fullResult.steps.fileInputMethod = 'native-setter';
  }

  // ─── STEP 5: Wait and scan for preview overlay ──────────────
  console.log('[Scanner] Step 5: Waiting for preview overlay...');
  const beforeEditables = new Set(document.querySelectorAll('div[contenteditable="true"]'));

  let previewFound = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const currentEditables = document.querySelectorAll('div[contenteditable="true"]');
    if (currentEditables.length > beforeEditables.size) {
      previewFound = true;
      console.log(`[Scanner] New contenteditable appeared! (was ${beforeEditables.size}, now ${currentEditables.length})`);
      break;
    }
    // Also check for new buttons/icons
    const sendBtn = document.querySelector('span[data-icon="wds-ic-send-filled"]');
    if (sendBtn) {
      // Check if there's a second one or if context changed
      const allSend = document.querySelectorAll('span[data-icon="wds-ic-send-filled"]');
      if (allSend.length > 1) {
        previewFound = true;
        console.log('[Scanner] Multiple send buttons detected — preview overlay is showing');
        break;
      }
    }
  }

  if (!previewFound) {
    console.warn('[Scanner] Preview overlay did NOT appear after 10 seconds.');
    fullResult.steps.previewOverlay = 'NOT_DETECTED';

    // Still scan to see what we have
    fullResult.steps.afterFileSet = scanDOM('after-file-set-no-preview');
  } else {
    console.log('[Scanner] Step 5b: Scanning preview overlay state...');
    await sleep(1000); // Extra wait for DOM to settle
    fullResult.steps.previewOverlay = scanDOM('preview-overlay');

    // Diff: find elements that are NEW in preview vs normal chat
    const normalIcons = new Set(fullResult.steps.normalChat.uniqueIcons);
    const previewIcons = fullResult.steps.previewOverlay.uniqueIcons;
    fullResult.steps.diff = {
      newIcons: previewIcons.filter(i => !normalIcons.has(i)),
      newTestIds: fullResult.steps.previewOverlay.uniqueTestIds.filter(
        t => !new Set(fullResult.steps.normalChat.uniqueTestIds).has(t)
      ),
      newEditables: fullResult.steps.previewOverlay.editables.length - fullResult.steps.normalChat.editables.length,
      editablesDetail: fullResult.steps.previewOverlay.editables,
    };
    console.log('[Scanner] New icons in preview:', fullResult.steps.diff.newIcons);
    console.log('[Scanner] New testIds in preview:', fullResult.steps.diff.newTestIds);
    console.log('[Scanner] New editables count:', fullResult.steps.diff.newEditables);
  }

  // ─── STEP 6: Try closing the preview (press Escape) ─────────
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await sleep(500);

  // ─── STEP 7: Download results ───────────────────────────────
  console.log('[Scanner] Done! Downloading results...');
  downloadJSON(fullResult, 'wa-scan-result.json');
  console.log('[Scanner] === SCAN COMPLETE === File downloaded as wa-scan-result.json');
})();
