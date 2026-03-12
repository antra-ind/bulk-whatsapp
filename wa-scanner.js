// WhatsApp Web UI Scanner — Run this in DevTools console on web.whatsapp.com
// Outputs a full map of interactive elements, inputs, editables, buttons, icons, and attributes.
// Usage: Open WhatsApp Web → F12 → Console → Paste this entire script → Press Enter
// Then: copy(window.__waScanResult) to copy the JSON to clipboard.

(function() {
  const result = {};

  // 1. All buttons with their attributes
  result.buttons = [...document.querySelectorAll('button, [role="button"]')].map(el => ({
    tag: el.tagName,
    ariaLabel: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    testId: el.dataset?.testId,
    icon: el.querySelector('[data-icon]')?.dataset?.icon,
    role: el.getAttribute('role'),
    classes: el.className?.toString().slice(0, 80),
    visible: el.offsetParent !== null,
    text: el.textContent?.trim().slice(0, 50),
    parentTestId: el.closest('[data-testid]')?.dataset?.testId,
  }));

  // 2. All data-icon elements
  result.icons = [...document.querySelectorAll('[data-icon]')].map(el => ({
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
  result.testIds = [...document.querySelectorAll('[data-testid]')].map(el => ({
    testId: el.dataset.testId,
    tag: el.tagName,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    contentEditable: el.getAttribute('contenteditable'),
    visible: el.offsetParent !== null,
    childCount: el.children.length,
    text: el.textContent?.trim().slice(0, 30),
  }));

  // 4. All contenteditable elements (compose boxes, caption inputs)
  result.editables = [...document.querySelectorAll('[contenteditable="true"]')].map(el => ({
    tag: el.tagName,
    testId: el.dataset?.testId,
    dataTab: el.getAttribute('data-tab'),
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder'),
    parentTestId: el.closest('[data-testid]')?.dataset?.testId,
    classes: el.className?.toString().slice(0, 80),
    visible: el.offsetParent !== null,
    text: el.textContent?.trim().slice(0, 30),
    // Walk up to find context
    ancestors: (() => {
      const anc = [];
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        const info = {};
        if (p.dataset?.testId) info.testId = p.dataset.testId;
        if (p.getAttribute('role')) info.role = p.getAttribute('role');
        if (p.getAttribute('aria-label')) info.ariaLabel = p.getAttribute('aria-label');
        if (Object.keys(info).length) anc.push(info);
        p = p.parentElement;
      }
      return anc;
    })(),
  }));

  // 5. All file inputs
  result.fileInputs = [...document.querySelectorAll('input[type="file"]')].map(el => ({
    accept: el.getAttribute('accept'),
    multiple: el.multiple,
    parentTestId: el.closest('[data-testid]')?.dataset?.testId,
    visible: el.offsetParent !== null,
    classes: el.className?.toString().slice(0, 80),
  }));

  // 6. All elements with aria-label (for finding Attach, Send, etc.)
  result.ariaLabels = [...document.querySelectorAll('[aria-label]')].map(el => ({
    ariaLabel: el.getAttribute('aria-label'),
    tag: el.tagName,
    role: el.getAttribute('role'),
    testId: el.dataset?.testId,
    icon: el.querySelector('[data-icon]')?.dataset?.icon || el.dataset?.icon,
    visible: el.offsetParent !== null,
  })).filter(x => x.visible);

  // 7. Unique icon names (summary)
  result.uniqueIcons = [...new Set(result.icons.map(i => i.icon))].sort();

  // 8. Unique testIds (summary)
  result.uniqueTestIds = [...new Set(result.testIds.map(t => t.testId))].sort();

  // 9. Unique aria-labels (summary)
  result.uniqueAriaLabels = [...new Set(result.ariaLabels.map(a => a.ariaLabel))].sort();

  // 10. Search specifically for send/attach/plus related elements
  result.sendRelated = {
    sendIcons: result.icons.filter(i => /send|submit/i.test(i.icon)),
    attachIcons: result.icons.filter(i => /attach|plus|clip|add/i.test(i.icon)),
    sendButtons: result.buttons.filter(b => /send/i.test(b.ariaLabel || '') || /send/i.test(b.icon || '')),
    attachButtons: result.buttons.filter(b => /attach|plus|clip/i.test(b.ariaLabel || '') || /attach|plus|clip/i.test(b.icon || '')),
    sendTestIds: result.testIds.filter(t => /send/i.test(t.testId)),
    mediaTestIds: result.testIds.filter(t => /media|editor|preview|image|caption/i.test(t.testId)),
  };

  // Store result globally
  window.__waScanResult = result;

  // Print summary
  console.log('=== WhatsApp Web UI Scan Results ===');
  console.log(`Buttons: ${result.buttons.length}`);
  console.log(`Icons: ${result.icons.length} (${result.uniqueIcons.length} unique)`);
  console.log(`TestIds: ${result.testIds.length} (${result.uniqueTestIds.length} unique)`);
  console.log(`Editables: ${result.editables.length}`);
  console.log(`File inputs: ${result.fileInputs.length}`);
  console.log(`Aria labels: ${result.ariaLabels.length} (${result.uniqueAriaLabels.length} unique)`);
  console.log('');
  console.log('--- SEND related ---');
  console.table(result.sendRelated.sendIcons);
  console.table(result.sendRelated.sendButtons);
  console.log('--- ATTACH related ---');
  console.table(result.sendRelated.attachIcons);
  console.table(result.sendRelated.attachButtons);
  console.log('--- MEDIA/EDITOR related testIds ---');
  console.table(result.sendRelated.mediaTestIds);
  console.log('--- EDITABLES ---');
  console.table(result.editables);
  console.log('--- FILE INPUTS ---');
  console.table(result.fileInputs);
  console.log('');
  console.log('--- Unique Icons ---');
  console.log(result.uniqueIcons.join(', '));
  console.log('');
  console.log('--- Unique Aria Labels ---');
  console.log(result.uniqueAriaLabels.join(', '));
  console.log('');
  console.log('Full result stored in window.__waScanResult');
  console.log('To copy: copy(JSON.stringify(window.__waScanResult, null, 2))');
  console.log('');
  console.log('>>> NOW: Manually attach an image (click Attach > pick image) and when the preview shows, run this again to scan the preview overlay. <<<');
})();
