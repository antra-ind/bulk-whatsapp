// wa-caption-scanner.js — Focused scanner to find the caption input in image preview
// Run this in DevTools console while a chat is open on WhatsApp Web.
// It will attach an image, wait for preview, then exhaustively scan for the caption field.

(async function() {
  'use strict';
  const results = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      tag: el.tagName,
      id: el.id || null,
      classes: el.className?.toString().substring(0, 200) || null,
      contentEditable: el.contentEditable,
      dataTab: el.dataset?.tab || null,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      ariaPlaceholder: el.getAttribute('aria-placeholder'),
      placeholder: el.getAttribute('placeholder') || el.dataset?.placeholder || el.getAttribute('aria-placeholder'),
      spellcheck: el.getAttribute('spellcheck'),
      tabIndex: el.tabIndex,
      textContent: el.textContent?.substring(0, 100) || '',
      visible: rect.width > 0 && rect.height > 0,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      zIndex: style.zIndex,
      position: style.position,
      display: style.display,
      opacity: style.opacity,
      overflow: style.overflow,
      outerHTML: el.outerHTML.substring(0, 500),
      // Walk up ancestors to find container context
      ancestors: Array.from({length: 8}, (_, i) => {
        let p = el;
        for (let j = 0; j <= i; j++) p = p?.parentElement;
        if (!p) return null;
        const pr = p.getBoundingClientRect();
        return {
          tag: p.tagName,
          id: p.id || null,
          class: p.className?.toString().substring(0, 150) || null,
          role: p.getAttribute('role'),
          ariaLabel: p.getAttribute('aria-label'),
          rect: { x: pr.x, y: pr.y, width: pr.width, height: pr.height },
          zIndex: window.getComputedStyle(p).zIndex,
        };
      }).filter(Boolean),
    };
  }

  // ── Step 1: Scan BEFORE attachment (baseline) ──
  console.log('[CaptionScanner] Step 1: Scanning baseline (no preview)...');
  const baselineEditables = document.querySelectorAll('[contenteditable="true"]');
  results.baseline = {
    count: baselineEditables.length,
    elements: Array.from(baselineEditables).map(getElementInfo),
  };

  // Also scan for anything with "caption" or "add a caption" text
  const allElements = document.querySelectorAll('*');
  const captionRelated = [];
  for (const el of allElements) {
    const text = (el.textContent || '').toLowerCase();
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const ph = (el.getAttribute('aria-placeholder') || el.getAttribute('placeholder') || '').toLowerCase();
    if (/caption|add a caption|type a caption/i.test(text + label + ph)) {
      if (el.children.length < 3) { // avoid huge container elements
        captionRelated.push({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100),
          ariaLabel: el.getAttribute('aria-label'),
          placeholder: ph,
          outerHTML: el.outerHTML.substring(0, 300),
        });
      }
    }
  }
  results.baselineCaptionRelated = captionRelated;

  // ── Step 2: Attach an image using the menu method ──
  console.log('[CaptionScanner] Step 2: Attaching test image...');
  
  // Create a small test image
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4CAF50';
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = '#FFF';
  ctx.font = '14px sans-serif';
  ctx.fillText('TEST', 30, 55);
  
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'caption-test.png', { type: 'image/png' });
  
  // Intercept file input click
  const originalClick = HTMLInputElement.prototype.click;
  let interceptedInput = null;
  HTMLInputElement.prototype.click = function() {
    if (this.type === 'file') {
      interceptedInput = this;
      return;
    }
    return originalClick.call(this);
  };
  
  // Click attach button
  const attachBtn =
    document.querySelector('button[aria-label="Attach"]') ||
    document.querySelector('span[data-icon="plus-rounded"]')?.closest('button') ||
    document.querySelector('span[data-icon="plus"]')?.closest('button');
  
  if (!attachBtn) {
    HTMLInputElement.prototype.click = originalClick;
    console.error('[CaptionScanner] Attach button not found! Make sure a chat is open.');
    return;
  }
  
  attachBtn.click();
  await sleep(1500);
  
  // Click Photos & Videos
  const photoItem =
    document.querySelector('[aria-label="Photos & videos"]') ||
    document.querySelector('[aria-label*="photo" i]') ||
    document.querySelector('[aria-label*="Photos" i]');
  
  if (!photoItem) {
    HTMLInputElement.prototype.click = originalClick;
    console.error('[CaptionScanner] Photo menu item not found!');
    return;
  }
  
  photoItem.click();
  await sleep(500);
  
  // Restore and set file
  HTMLInputElement.prototype.click = originalClick;
  
  const targetInput = interceptedInput ||
    document.querySelector('input[type="file"][accept*="image"]') ||
    document.querySelector('input[type="file"]');
  
  if (!targetInput) {
    console.error('[CaptionScanner] No file input found!');
    return;
  }
  
  const dt = new DataTransfer();
  dt.items.add(file);
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
  if (nativeSetter) nativeSetter.call(targetInput, dt.files);
  else targetInput.files = dt.files;
  targetInput.dispatchEvent(new Event('input', { bubbles: true }));
  targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  
  console.log('[CaptionScanner] Step 3: Waiting for preview to appear...');
  
  // Wait for preview (check for x-alt, scissors, or send-filled icons)
  let previewFound = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (document.querySelector('span[data-icon="x-alt"]') ||
        document.querySelector('span[data-icon="scissors"]') ||
        document.querySelector('div[role="button"][aria-label="Send"]')) {
      previewFound = true;
      break;
    }
  }
  
  if (!previewFound) {
    console.error('[CaptionScanner] Preview did not appear!');
    return;
  }
  
  console.log('[CaptionScanner] Preview detected! Waiting 2s for full stabilization...');
  await sleep(2000);
  
  // ── Step 4: Exhaustive scan of preview state ──
  console.log('[CaptionScanner] Step 4: Scanning preview state...');
  
  // 4a: All contenteditable elements
  const previewEditables = document.querySelectorAll('[contenteditable="true"]');
  results.preview = {
    editableCount: previewEditables.length,
    editables: Array.from(previewEditables).map(getElementInfo),
  };
  
  // 4b: All elements with role="textbox"
  const textboxes = document.querySelectorAll('[role="textbox"]');
  results.previewTextboxes = Array.from(textboxes).map(getElementInfo);
  
  // 4c: All input/textarea elements
  const inputs = document.querySelectorAll('input:not([type="file"]):not([type="hidden"]), textarea');
  results.previewInputs = Array.from(inputs).map(el => ({
    tag: el.tagName,
    type: el.type,
    placeholder: el.placeholder,
    ariaLabel: el.getAttribute('aria-label'),
    name: el.name,
    visible: el.getBoundingClientRect().width > 0,
  }));
  
  // 4d: Caption-related elements in preview
  const previewCaptionRelated = [];
  const allPreviewElements = document.querySelectorAll('*');
  for (const el of allPreviewElements) {
    const text = (el.textContent || '').toLowerCase();
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const ph = (el.getAttribute('aria-placeholder') || el.getAttribute('placeholder') || '').toLowerCase();
    if (/caption|add a caption|type a caption/i.test(text + label + ph)) {
      if (el.children.length < 3) {
        previewCaptionRelated.push({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100),
          ariaLabel: el.getAttribute('aria-label'),
          placeholder: ph,
          contentEditable: el.contentEditable,
          outerHTML: el.outerHTML.substring(0, 400),
        });
      }
    }
  }
  results.previewCaptionRelated = previewCaptionRelated;
  
  // 4e: Scan for elements with "Add a caption" placeholder (common WhatsApp pattern)
  // Also check for any element near the bottom of the preview that might be the caption
  const previewSendBtn = document.querySelector('div[role="button"][aria-label="Send"]');
  if (previewSendBtn) {
    const sendRect = previewSendBtn.getBoundingClientRect();
    results.sendButtonRect = sendRect;
    
    // Find all editable-like elements near the send button (within 200px vertically)
    const nearSend = [];
    for (const el of allPreviewElements) {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && Math.abs(r.y - sendRect.y) < 200) {
        if (el.contentEditable === 'true' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
            el.getAttribute('role') === 'textbox') {
          nearSend.push(getElementInfo(el));
        }
      }
    }
    results.editablesNearSendButton = nearSend;
  }
  
  // 4f: Compare baseline vs preview editables — find NEW ones
  const baselineTabs = new Set(results.baseline.elements.map(e => e.dataTab));
  const newEditables = results.preview.editables.filter(e => !baselineTabs.has(e.dataTab));
  results.newEditablesInPreview = newEditables;
  
  // 4g: Check if data-tab="10" element changed (different DOM node)
  const tab10 = document.querySelector('div[contenteditable="true"][data-tab="10"]');
  if (tab10) {
    results.tab10InPreview = getElementInfo(tab10);
    // Check if it's behind an overlay (compare z-index with preview elements)
    const tab10Rect = tab10.getBoundingClientRect();
    const elementAtCenter = document.elementFromPoint(
      tab10Rect.x + tab10Rect.width / 2,
      tab10Rect.y + tab10Rect.height / 2
    );
    results.elementAtTab10Center = elementAtCenter ? {
      tag: elementAtCenter.tagName,
      class: elementAtCenter.className?.toString().substring(0, 200),
      contentEditable: elementAtCenter.contentEditable,
      dataTab: elementAtCenter.dataset?.tab,
      ariaLabel: elementAtCenter.getAttribute('aria-label'),
      ariaPlaceholder: elementAtCenter.getAttribute('aria-placeholder'),
      role: elementAtCenter.getAttribute('role'),
      outerHTML: elementAtCenter.outerHTML.substring(0, 500),
      isSameAsTab10: elementAtCenter === tab10,
    } : null;
  }
  
  // 4h: Look at the footer area specifically
  const footer = document.querySelector('footer');
  if (footer) {
    results.footerInPreview = {
      outerHTML: footer.outerHTML.substring(0, 1000),
      visible: footer.getBoundingClientRect().height > 0,
      rect: footer.getBoundingClientRect(),
    };
  }
  
  // 4i: Scan for Lexical editors (class contains "lexical")
  const lexicalEditors = document.querySelectorAll('.lexical-rich-text-input, [class*="lexical"]');
  results.lexicalEditors = Array.from(lexicalEditors).map(el => {
    const child = el.querySelector('[contenteditable="true"]');
    return {
      class: el.className?.toString().substring(0, 200),
      rect: el.getBoundingClientRect(),
      visible: el.getBoundingClientRect().width > 0,
      childEditable: child ? {
        dataTab: child.dataset?.tab,
        ariaLabel: child.getAttribute('aria-label'),
        ariaPlaceholder: child.getAttribute('aria-placeholder'),
      } : null,
    };
  });
  
  // 4j: Check what element gets focus when we click in the caption area
  // The preview image is typically in the center, caption below it
  const previewXAlt = document.querySelector('span[data-icon="x-alt"]');
  if (previewXAlt) {
    const xAltRect = previewXAlt.getBoundingClientRect();
    results.xAltPosition = xAltRect;
    
    // The caption area is typically at the bottom of the preview, near the send button
    // Try clicking in different areas to see what gets focus
    results.focusTests = [];
    
    // Don't actually click — just use elementFromPoint at different positions
    if (previewSendBtn) {
      const sr = previewSendBtn.getBoundingClientRect();
      // Check left of send button (where caption input usually is)
      for (let xOffset = -400; xOffset <= -50; xOffset += 100) {
        const testX = sr.x + xOffset;
        const testY = sr.y + sr.height / 2;
        const el = document.elementFromPoint(testX, testY);
        if (el) {
          results.focusTests.push({
            testPoint: { x: testX, y: testY },
            element: {
              tag: el.tagName,
              contentEditable: el.contentEditable,
              dataTab: el.dataset?.tab,
              ariaLabel: el.getAttribute('aria-label'),
              ariaPlaceholder: el.getAttribute('aria-placeholder'),
              role: el.getAttribute('role'),
              class: el.className?.toString().substring(0, 150),
            },
          });
        }
      }
    }
  }

  // ── Step 5: Close the preview (click x-alt) ──
  console.log('[CaptionScanner] Step 5: Closing preview...');
  const closeBtn = document.querySelector('span[data-icon="x-alt"]')?.closest('button') ||
    document.querySelector('span[data-icon="x-alt"]')?.closest('div[role="button"]') ||
    document.querySelector('span[data-icon="x-alt"]');
  if (closeBtn) closeBtn.click();
  
  // ── Output results ──
  const jsonStr = JSON.stringify(results, null, 2);
  window.__captionScanResult = results;

  // Method 1: Download as file (most reliable)
  try {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wa-caption-scan-result.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('[CaptionScanner] ✅ Results downloaded as wa-caption-scan-result.json');
  } catch(e) {
    console.error('[CaptionScanner] Download failed:', e);
  }

  // Method 2: copy() function (Chrome DevTools built-in)
  try {
    copy(results);
    console.log('[CaptionScanner] ✅ Results also copied to clipboard via copy()');
  } catch(e) {
    // copy() only works in DevTools console, not in page context
  }

  // Method 3: Log a small summary to console
  console.log('[CaptionScanner] Done! Summary:');
  console.log('  Baseline editables:', results.baseline.count);
  console.log('  Preview editables:', results.preview?.editableCount);
  console.log('  New editables in preview:', results.newEditablesInPreview?.length);
  console.log('  Caption-related elements:', results.previewCaptionRelated?.length);
  console.log('  Lexical editors:', results.lexicalEditors?.length);
  console.log('  Element at tab10 center is tab10?', results.elementAtTab10Center?.isSameAsTab10);
  console.log('[CaptionScanner] Full results stored in window.__captionScanResult');
  console.log('[CaptionScanner] File should have been downloaded. If not, run: copy(window.__captionScanResult)');
})();
