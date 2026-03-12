// WhatsApp Web UI Scanner v3 — Fully automatic, tests ALL attachment methods
// Follows the REAL user flow: Attach → menu → pick type → file → preview → caption → send
// Paste in DevTools console on web.whatsapp.com (with a chat open).
// Auto-downloads wa-scan-result.json with complete DOM analysis.

(async function() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function scanDOM(label) {
    const scan = { label, timestamp: new Date().toISOString() };

    // 1. All buttons
    scan.buttons = [...document.querySelectorAll('button, [role="button"]')].map(el => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      testId: el.dataset?.testId,
      icon: el.querySelector('[data-icon]')?.dataset?.icon,
      role: el.getAttribute('role'),
      classes: el.className?.toString().slice(0, 120),
      visible: el.offsetParent !== null,
      display: getComputedStyle(el).display,
      text: el.textContent?.trim().slice(0, 60),
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
      rect: el.getBoundingClientRect().toJSON(),
    }));

    // 2. All data-icon elements
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

    // 3. All data-testid elements
    scan.testIds = [...document.querySelectorAll('[data-testid]')].map(el => ({
      testId: el.dataset.testId,
      tag: el.tagName,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      contentEditable: el.getAttribute('contenteditable'),
      visible: el.offsetParent !== null,
      childCount: el.children.length,
      text: el.textContent?.trim().slice(0, 50),
    }));

    // 4. All contenteditable elements with full ancestor chain
    scan.editables = [...document.querySelectorAll('[contenteditable="true"]')].map(el => ({
      tag: el.tagName,
      testId: el.dataset?.testId,
      dataTab: el.getAttribute('data-tab'),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder'),
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
      classes: el.className?.toString().slice(0, 120),
      visible: el.offsetParent !== null,
      display: getComputedStyle(el).display,
      text: el.textContent?.trim().slice(0, 50),
      rect: el.getBoundingClientRect().toJSON(),
      outerHTML: el.outerHTML.slice(0, 300),
      ancestors: (() => {
        const anc = [];
        let p = el.parentElement;
        for (let i = 0; i < 10 && p && p !== document.body; i++) {
          const info = { tag: p.tagName };
          if (p.dataset?.testId) info.testId = p.dataset.testId;
          if (p.getAttribute('role')) info.role = p.getAttribute('role');
          if (p.getAttribute('aria-label')) info.ariaLabel = p.getAttribute('aria-label');
          if (p.dataset?.icon) info.icon = p.dataset.icon;
          if (p.className) info.class = p.className.toString().slice(0, 80);
          if (p.id) info.id = p.id;
          anc.push(info);
          p = p.parentElement;
        }
        return anc;
      })(),
    }));

    // 5. All file inputs with parent HTML context
    scan.fileInputs = [...document.querySelectorAll('input[type="file"]')].map(el => ({
      accept: el.getAttribute('accept'),
      multiple: el.multiple,
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
      visible: el.offsetParent !== null,
      display: getComputedStyle(el).display,
      classes: el.className?.toString().slice(0, 120),
      parentHTML: el.parentElement?.outerHTML?.slice(0, 300),
      grandparentHTML: el.parentElement?.parentElement?.outerHTML?.slice(0, 300),
    }));

    // 6. All inputs of any type
    scan.allInputs = [...document.querySelectorAll('input')].map(el => ({
      type: el.type,
      accept: el.getAttribute('accept'),
      name: el.name,
      id: el.id,
      classes: el.className?.toString().slice(0, 80),
      visible: el.offsetParent !== null,
      parentTestId: el.closest('[data-testid]')?.dataset?.testId,
    }));

    // 7. Visible aria-labels
    scan.ariaLabels = [...document.querySelectorAll('[aria-label]')].map(el => ({
      ariaLabel: el.getAttribute('aria-label'),
      tag: el.tagName,
      role: el.getAttribute('role'),
      testId: el.dataset?.testId,
      icon: el.querySelector('[data-icon]')?.dataset?.icon || el.dataset?.icon,
      visible: el.offsetParent !== null,
    })).filter(x => x.visible);

    // 8. Modals, overlays, dialogs
    scan.overlays = [...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [data-testid*="modal"], [data-testid*="overlay"], ' +
      '[data-testid*="drawer"], [data-testid*="popup"], .overlay, .modal'
    )].map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      testId: el.dataset?.testId,
      classes: el.className?.toString().slice(0, 120),
      visible: el.offsetParent !== null,
      childCount: el.children.length,
      outerHTML: el.outerHTML.slice(0, 500),
    }));

    // 9. All spans/divs with data-* attributes (WhatsApp uses many custom data attrs)
    scan.dataAttrs = [...document.querySelectorAll('[data-testid], [data-icon], [data-tab], [data-animate-dropdown-item]')].map(el => {
      const attrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) attrs[attr.name] = attr.value;
      }
      return {
        tag: el.tagName,
        attrs,
        visible: el.offsetParent !== null,
        ariaLabel: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
      };
    });

    // 10. Footer / compose area HTML snapshot
    const footer = document.querySelector('footer') || document.querySelector('[data-testid="conversation-compose-box"]')?.parentElement;
    scan.footerHTML = footer ? footer.outerHTML.slice(0, 2000) : 'NOT FOUND';

    // 11. Main panel HTML snapshot (abbreviated)
    const mainPanel = document.querySelector('#main') || document.querySelector('[data-testid="conversation-panel-body"]')?.parentElement;
    if (mainPanel) {
      // Just get the bottom part (where compose/attach/send lives)
      const children = [...mainPanel.children];
      const lastChild = children[children.length - 1];
      scan.mainPanelBottomHTML = lastChild ? lastChild.outerHTML.slice(0, 3000) : 'EMPTY';
    }

    // Summaries
    scan.uniqueIcons = [...new Set(scan.icons.map(i => i.icon))].sort();
    scan.uniqueTestIds = [...new Set(scan.testIds.map(t => t.testId))].sort();
    scan.uniqueAriaLabels = [...new Set(scan.ariaLabels.map(a => a.ariaLabel))].sort();

    scan.sendRelated = {
      sendIcons: scan.icons.filter(i => /send|submit|wds.*send/i.test(i.icon)),
      attachIcons: scan.icons.filter(i => /attach|plus|clip|add/i.test(i.icon)),
      sendButtons: scan.buttons.filter(b => /send/i.test(b.ariaLabel || '') || /send/i.test(b.icon || '')),
      attachButtons: scan.buttons.filter(b => /attach|plus|clip/i.test(b.ariaLabel || '') || /attach|plus|clip/i.test(b.icon || '')),
      sendTestIds: scan.testIds.filter(t => /send/i.test(t.testId)),
      mediaTestIds: scan.testIds.filter(t => /media|editor|preview|image|caption|overlay|photo|video/i.test(t.testId)),
    };

    // Count summary
    scan.summary = {
      buttons: scan.buttons.length,
      icons: scan.icons.length,
      uniqueIcons: scan.uniqueIcons.length,
      testIds: scan.testIds.length,
      uniqueTestIds: scan.uniqueTestIds.length,
      editables: scan.editables.length,
      fileInputs: scan.fileInputs.length,
      allInputs: scan.allInputs.length,
      overlays: scan.overlays.length,
      ariaLabels: scan.ariaLabels.length,
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

  // Detect if overlay/preview appeared by comparing editable counts + DOM changes
  async function waitForChange(beforeEditables, beforeButtons, maxWait) {
    for (let i = 0; i < maxWait / 300; i++) {
      await sleep(300);
      const nowEditables = document.querySelectorAll('div[contenteditable="true"]').length;
      const nowButtons = document.querySelectorAll('button, [role="button"]').length;
      if (nowEditables > beforeEditables || nowButtons > beforeButtons + 2) {
        return true;
      }
    }
    return false;
  }

  const fullResult = {
    scannerVersion: 3,
    scannedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: location.href,
    pageTitle: document.title,
    steps: {},
    methodResults: {},
  };

  const testFile = await createTestImage();

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Scan normal chat state
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 1/9: Scanning normal chat state...');
  fullResult.steps.normalChat = scanDOM('normal-chat');
  console.log(`[Scanner] Summary:`, fullResult.steps.normalChat.summary);

  const normalEditableCount = fullResult.steps.normalChat.editables.length;
  const normalButtonCount = fullResult.steps.normalChat.buttons.length;

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Click attach button → scan the ATTACHMENT MENU
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 2/9: Clicking attach button...');
  const attachBtn =
    document.querySelector('button[aria-label="Attach"]') ||
    document.querySelector('span[data-icon="plus-rounded"]')?.closest('button') ||
    document.querySelector('span[data-icon="plus"]')?.closest('button') ||
    document.querySelector('[title="Attach"]');

  if (!attachBtn) {
    fullResult.error = 'Attach button not found! Make sure a chat is open.';
    console.error('[Scanner]', fullResult.error);
    downloadJSON(fullResult, 'wa-scan-result.json');
    return;
  }

  attachBtn.click();
  await sleep(2000);
  fullResult.steps.afterAttachClick = scanDOM('after-attach-click');
  console.log(`[Scanner] After attach: ${fullResult.steps.afterAttachClick.fileInputs.length} file inputs, ${fullResult.steps.afterAttachClick.summary.buttons} buttons`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Scan the attachment MENU items (Photos, Document, etc.)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 3/9: Scanning attachment menu items...');

  // Diff icons/buttons that appeared after clicking attach = the menu items
  const normalIcons = new Set(fullResult.steps.normalChat.uniqueIcons);
  const normalTestIds = new Set(fullResult.steps.normalChat.uniqueTestIds);
  const normalAriaLabels = new Set(fullResult.steps.normalChat.uniqueAriaLabels);

  fullResult.steps.attachMenu = {
    newIcons: fullResult.steps.afterAttachClick.uniqueIcons.filter(i => !normalIcons.has(i)),
    newTestIds: fullResult.steps.afterAttachClick.uniqueTestIds.filter(t => !normalTestIds.has(t)),
    newAriaLabels: fullResult.steps.afterAttachClick.uniqueAriaLabels.filter(a => !normalAriaLabels.has(a)),
    newButtons: fullResult.steps.afterAttachClick.buttons.filter(b => {
      // Find buttons that are new in the menu
      const isNew = b.visible && !fullResult.steps.normalChat.buttons.some(nb =>
        nb.ariaLabel === b.ariaLabel && nb.icon === b.icon && nb.text === b.text
      );
      return isNew;
    }),
    newFileInputs: fullResult.steps.afterAttachClick.fileInputs,
    // Scan all li, menu items, dropdown items
    menuItems: [...document.querySelectorAll(
      '[data-animate-dropdown-item], [role="menuitem"], li[role="button"], ' +
      '[data-testid*="attach"], [data-testid*="menu"]'
    )].map(el => ({
      tag: el.tagName,
      testId: el.dataset?.testId,
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      text: el.textContent?.trim().slice(0, 80),
      icon: el.querySelector('[data-icon]')?.dataset?.icon,
      classes: el.className?.toString().slice(0, 120),
      visible: el.offsetParent !== null,
      hasFileInput: !!el.querySelector('input[type="file"]'),
      fileInputAccept: el.querySelector('input[type="file"]')?.getAttribute('accept'),
      outerHTML: el.outerHTML.slice(0, 500),
      rect: el.getBoundingClientRect().toJSON(),
    })),
    // Also find any clickable items near the attach area
    allClickablesNearAttach: (() => {
      // Find the dropdown/menu container that appeared
      const menuContainer =
        document.querySelector('[data-animate-dropdown-item]')?.closest('[class]')?.parentElement ||
        document.querySelector('[data-testid*="attach-menu"]') ||
        document.querySelector('ul[role="list"]');
      if (!menuContainer) return [];
      return [...menuContainer.querySelectorAll('button, [role="button"], li, [tabindex]')].map(el => ({
        tag: el.tagName,
        testId: el.dataset?.testId,
        ariaLabel: el.getAttribute('aria-label'),
        text: el.textContent?.trim().slice(0, 80),
        icon: el.querySelector('[data-icon]')?.dataset?.icon,
        dataIcon: el.dataset?.icon,
        hasFileInput: !!el.querySelector('input[type="file"]'),
        fileInputAccept: el.querySelector('input[type="file"]')?.getAttribute('accept'),
        visible: el.offsetParent !== null,
        outerHTML: el.outerHTML.slice(0, 400),
      }));
    })(),
    // Full HTML snapshot of anything new/dropdown
    dropdownHTML: (() => {
      const el =
        document.querySelector('[data-animate-dropdown-item]')?.closest('[class]')?.parentElement?.parentElement ||
        document.querySelector('[data-testid*="attach-menu"]');
      return el ? el.outerHTML.slice(0, 5000) : 'NOT FOUND';
    })(),
  };

  console.log(`[Scanner] Menu items found: ${fullResult.steps.attachMenu.menuItems.length}`);
  console.log(`[Scanner] New icons in menu: ${fullResult.steps.attachMenu.newIcons.join(', ')}`);
  console.log(`[Scanner] New buttons in menu: ${fullResult.steps.attachMenu.newButtons.length}`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Click "Photos & Videos" menu item → then test file input
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 4/9: Looking for Photos/Videos menu item...');

  // Find the image/photo menu item by various strategies
  let photoMenuItem = null;
  const strategies = [
    // Strategy 1: data-testid containing image/photo
    () => document.querySelector('[data-testid*="image"], [data-testid*="photo"], [data-testid*="media"]'),
    // Strategy 2: aria-label containing Photos/Image
    () => document.querySelector('[aria-label*="photo" i], [aria-label*="image" i], [aria-label*="Photos" i]'),
    // Strategy 3: Button with image-related icon
    () => {
      const icons = document.querySelectorAll('[data-icon]');
      for (const ic of icons) {
        if (/image|photo|gallery|camera-roll|media|picture/i.test(ic.dataset.icon)) {
          return ic.closest('button') || ic.closest('[role="button"]') || ic.closest('li') || ic.parentElement;
        }
      }
      return null;
    },
    // Strategy 4: File input with image accept (click its container)
    () => {
      const inp = document.querySelector('input[type="file"][accept*="image"]');
      return inp ? (inp.closest('button') || inp.closest('[role="button"]') || inp.closest('li') || inp.parentElement) : null;
    },
    // Strategy 5: Menu item containing "Photos" or "Image" text
    () => {
      const all = document.querySelectorAll('button, [role="button"], li, [data-animate-dropdown-item]');
      for (const el of all) {
        if (/photos|image|photo|video/i.test(el.textContent?.trim() || '')) {
          return el;
        }
      }
      return null;
    },
  ];

  for (const strategy of strategies) {
    photoMenuItem = strategy();
    if (photoMenuItem) break;
  }

  fullResult.steps.photoMenuItemSearch = {
    found: !!photoMenuItem,
    tag: photoMenuItem?.tagName,
    testId: photoMenuItem?.dataset?.testId,
    ariaLabel: photoMenuItem?.getAttribute('aria-label'),
    text: photoMenuItem?.textContent?.trim().slice(0, 80),
    icon: photoMenuItem?.querySelector('[data-icon]')?.dataset?.icon,
    outerHTML: photoMenuItem?.outerHTML?.slice(0, 500),
  };

  if (photoMenuItem) {
    console.log(`[Scanner] Found photo menu item: "${photoMenuItem.textContent?.trim().slice(0, 50)}" [${photoMenuItem.tagName}]`);

    // Record editable/button counts BEFORE clicking
    const beforeMenuClickEditables = document.querySelectorAll('div[contenteditable="true"]').length;
    const beforeMenuClickButtons = document.querySelectorAll('button, [role="button"]').length;

    photoMenuItem.click();
    await sleep(2000);

    // Scan after clicking the photo menu item
    fullResult.steps.afterPhotoMenuClick = scanDOM('after-photo-menu-click');
    console.log(`[Scanner] After photo menu click: ${fullResult.steps.afterPhotoMenuClick.fileInputs.length} file inputs`);

    // Now try setting a file on the file input
    const photoFileInputs = document.querySelectorAll('input[type="file"]');
    if (photoFileInputs.length > 0) {
      let targetInput = null;
      for (const inp of photoFileInputs) {
        if ((inp.getAttribute('accept') || '').includes('image')) { targetInput = inp; break; }
      }
      if (!targetInput) targetInput = photoFileInputs[0];

      console.log(`[Scanner] Setting file on input with accept="${targetInput.getAttribute('accept')}"`);

      const dt = new DataTransfer();
      dt.items.add(testFile);
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (nativeSetter) nativeSetter.call(targetInput, dt.files);
      else targetInput.files = dt.files;
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));

      const fileMethodWorked = await waitForChange(beforeMenuClickEditables, beforeMenuClickButtons, 8000);
      fullResult.methodResults.fileInputViaMenu = {
        worked: fileMethodWorked,
        accept: targetInput.getAttribute('accept'),
        menuItemClicked: photoMenuItem.textContent?.trim().slice(0, 50),
      };
      console.log(`[Scanner] File input via menu: ${fileMethodWorked ? 'PREVIEW APPEARED!' : 'NO CHANGE'}`);

      if (fileMethodWorked) {
        await sleep(1500);
        fullResult.steps.previewViaMenuFileInput = scanDOM('preview-via-menu-file-input');

        // Compute diff
        fullResult.steps.menuFileInputDiff = {
          newIcons: fullResult.steps.previewViaMenuFileInput.uniqueIcons.filter(i => !normalIcons.has(i)),
          newTestIds: fullResult.steps.previewViaMenuFileInput.uniqueTestIds.filter(t => !normalTestIds.has(t)),
          newEditableCount: fullResult.steps.previewViaMenuFileInput.editables.length - normalEditableCount,
          allEditables: fullResult.steps.previewViaMenuFileInput.editables,
          allSendRelated: fullResult.steps.previewViaMenuFileInput.sendRelated,
          allOverlays: fullResult.steps.previewViaMenuFileInput.overlays,
        };
      }

      // Close
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(1000);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(1000);
    } else {
      fullResult.methodResults.fileInputViaMenu = { worked: false, reason: 'no file inputs after clicking photo menu' };
      console.log('[Scanner] No file inputs after clicking photo menu item');
    }
  } else {
    fullResult.steps.photoMenuItemSearch.reason = 'Could not find Photos/Videos menu item by any strategy';
    fullResult.methodResults.fileInputViaMenu = { worked: false, reason: 'photo menu item not found' };
    console.warn('[Scanner] Could not find the Photos/Videos menu item!');
  }

  // Close any remaining menu
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await sleep(1000);

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Test direct file input (without menu click) for comparison
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 5/9: Testing direct file input (no menu)...');
  // Re-open attach menu
  attachBtn.click();
  await sleep(2000);

  const directFileInputs = document.querySelectorAll('input[type="file"]');
  if (directFileInputs.length > 0) {
    let targetInput = null;
    for (const inp of directFileInputs) {
      if ((inp.getAttribute('accept') || '').includes('image')) { targetInput = inp; break; }
    }
    if (!targetInput) targetInput = directFileInputs[0];

    const dt = new DataTransfer();
    dt.items.add(testFile);
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) nativeSetter.call(targetInput, dt.files);
    else targetInput.files = dt.files;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));

    const directWorked = await waitForChange(normalEditableCount, normalButtonCount, 8000);
    fullResult.methodResults.directFileInput = {
      worked: directWorked,
      accept: targetInput.getAttribute('accept'),
      note: 'Set file directly without clicking photo menu item first',
    };
    console.log(`[Scanner] Direct file input (no menu click): ${directWorked ? 'PREVIEW APPEARED' : 'NO CHANGE'}`);

    if (directWorked) {
      await sleep(1000);
      fullResult.steps.previewViaDirectFileInput = scanDOM('preview-via-direct-file-input');
    }

    // Close
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(1000);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(1000);
  } else {
    fullResult.methodResults.directFileInput = { worked: false, reason: 'no file inputs found' };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: Test Method B — Paste (ClipboardEvent)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 6/9: Testing paste method...');
  // Make sure we're back to normal state
  const composeBox =
    document.querySelector('[data-testid="conversation-compose-box-input"]') ||
    document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
    document.querySelector('footer div[contenteditable="true"]');
  if (composeBox) composeBox.focus();
  await sleep(500);

  const beforePasteEditables = document.querySelectorAll('div[contenteditable="true"]').length;
  const beforePasteButtons = document.querySelectorAll('button, [role="button"]').length;

  const pasteDt = new DataTransfer();
  pasteDt.items.add(testFile);
  const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(pasteEvent, 'clipboardData', { value: pasteDt, writable: false });
  (composeBox || document.body).dispatchEvent(pasteEvent);

  const pasteWorked = await waitForChange(beforePasteEditables, beforePasteButtons, 8000);
  fullResult.methodResults.paste = { worked: pasteWorked };
  console.log(`[Scanner] Paste method: ${pasteWorked ? 'PREVIEW APPEARED' : 'NO CHANGE'}`);

  if (pasteWorked) {
    await sleep(1000);
    fullResult.steps.previewViaPaste = scanDOM('preview-via-paste');

    // Compute diff from normal state
    const normalIcons = new Set(fullResult.steps.normalChat.uniqueIcons);
    const normalTestIds = new Set(fullResult.steps.normalChat.uniqueTestIds);
    fullResult.steps.pasteDiff = {
      newIcons: fullResult.steps.previewViaPaste.uniqueIcons.filter(i => !normalIcons.has(i)),
      newTestIds: fullResult.steps.previewViaPaste.uniqueTestIds.filter(t => !normalTestIds.has(t)),
      newEditableCount: fullResult.steps.previewViaPaste.editables.length - normalEditableCount,
      allEditables: fullResult.steps.previewViaPaste.editables,
      allSendRelated: fullResult.steps.previewViaPaste.sendRelated,
    };
  }

  // Close
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await sleep(1000);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await sleep(1000);

  // ═══════════════════════════════════════════════════════════════
  // STEP 7: Test Method C — Drag and Drop
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 7/9: Testing drag-and-drop method...');
  const beforeDropEditables = document.querySelectorAll('div[contenteditable="true"]').length;
  const beforeDropButtons = document.querySelectorAll('button, [role="button"]').length;

  const dropTarget =
    document.querySelector('[data-testid="conversation-panel-body"]') ||
    document.querySelector('#main') ||
    document.querySelector('#app');

  if (dropTarget) {
    const dropDt = new DataTransfer();
    dropDt.items.add(testFile);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dropDt };
    dropTarget.dispatchEvent(new DragEvent('dragenter', opts));
    dropTarget.dispatchEvent(new DragEvent('dragover', opts));
    dropTarget.dispatchEvent(new DragEvent('drop', opts));

    const dropWorked = await waitForChange(beforeDropEditables, beforeDropButtons, 8000);
    fullResult.methodResults.drop = { worked: dropWorked, target: dropTarget.tagName, targetTestId: dropTarget.dataset?.testId };
    console.log(`[Scanner] Drop method: ${dropWorked ? 'PREVIEW APPEARED' : 'NO CHANGE'}`);

    if (dropWorked) {
      await sleep(1000);
      fullResult.steps.previewViaDrop = scanDOM('preview-via-drop');
    }

    // Close
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(1000);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(1000);
  } else {
    fullResult.methodResults.drop = { worked: false, reason: 'no drop target found' };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 8: Scan any React internal data (fiber, props)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 8/9: Scanning React internals...');
  try {
    const appEl = document.querySelector('#app');
    const reactKey = appEl ? Object.keys(appEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')) : null;
    fullResult.reactInfo = {
      hasReact: !!reactKey,
      reactKey: reactKey?.slice(0, 40),
    };

    // Check compose box for React fiber
    if (composeBox) {
      const composeReactKey = Object.keys(composeBox).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps') || k.startsWith('__reactInternalInstance'));
      if (composeReactKey) {
        const fiber = composeBox[composeReactKey];
        fullResult.reactInfo.composeBoxFiber = {
          key: composeReactKey.slice(0, 40),
          type: typeof fiber,
          hasOnPaste: !!(fiber?.onPaste || fiber?.memoizedProps?.onPaste),
          hasOnDrop: !!(fiber?.onDrop || fiber?.memoizedProps?.onDrop),
          hasOnChange: !!(fiber?.onChange || fiber?.memoizedProps?.onChange),
          propKeys: fiber?.memoizedProps ? Object.keys(fiber.memoizedProps).slice(0, 30) : (typeof fiber === 'object' ? Object.keys(fiber).slice(0, 30) : []),
        };
      }
    }
  } catch (e) {
    fullResult.reactInfo = { error: e.message };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 9: Final summary + download
  // ═══════════════════════════════════════════════════════════════
  console.log('[Scanner] Step 9/9: Generating results...');

  fullResult.finalSummary = {
    methods: fullResult.methodResults,
    normalEditables: normalEditableCount,
    normalButtons: normalButtonCount,
    allUniqueIcons: fullResult.steps.normalChat.uniqueIcons,
    allUniqueTestIds: fullResult.steps.normalChat.uniqueTestIds,
    recommendation: (() => {
      if (fullResult.methodResults.fileInputViaMenu?.worked) return 'USE FILE INPUT VIA MENU (Attach → Photos & Videos → set file)';
      if (fullResult.methodResults.paste?.worked) return 'USE PASTE METHOD';
      if (fullResult.methodResults.drop?.worked) return 'USE DROP METHOD';
      if (fullResult.methodResults.directFileInput?.worked) return 'USE DIRECT FILE INPUT (no menu click needed)';
      return 'NONE WORKED — need manual investigation';
    })(),
  };

  console.log('[Scanner] ═══════════════════════════════════════');
  console.log('[Scanner] RESULTS:');
  console.log('[Scanner] File Input via Menu:', fullResult.methodResults.fileInputViaMenu?.worked ? 'WORKS' : 'FAILED');
  console.log('[Scanner] Direct File Input:', fullResult.methodResults.directFileInput?.worked ? 'WORKS' : 'FAILED');
  console.log('[Scanner] Paste:', fullResult.methodResults.paste?.worked ? 'WORKS' : 'FAILED');
  console.log('[Scanner] Drop:', fullResult.methodResults.drop?.worked ? 'WORKS' : 'FAILED');
  console.log('[Scanner] Recommendation:', fullResult.finalSummary.recommendation);
  console.log('[Scanner] ═══════════════════════════════════════');

  downloadJSON(fullResult, 'wa-scan-result.json');
  console.log('[Scanner] DONE — wa-scan-result.json downloaded!');
})();
