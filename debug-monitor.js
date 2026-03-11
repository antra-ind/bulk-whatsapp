// Monitor all events when you manually attach & send an image
(function() {
  // Track drag/drop events
  ['dragenter','dragover','drop'].forEach(evt => {
    document.addEventListener(evt, e => {
      console.log(`[DEBUG] ${evt.toUpperCase()}`, {
        target: e.target.tagName,
        testId: e.target.closest('[data-testid]')?.dataset.testId,
        files: e.dataTransfer?.files?.length
      });
    }, true);
  });

  // Track paste events
  document.addEventListener('paste', e => {
    console.log('[DEBUG] PASTE', {
      target: e.target.tagName,
      testId: e.target.closest('[data-testid]')?.dataset.testId,
      files: e.clipboardData?.files?.length
    });
  }, true);

  // Track file input changes
  document.addEventListener('change', e => {
    if (e.target.type === 'file') {
      console.log('[DEBUG] FILE INPUT', {
        accept: e.target.accept,
        files: e.target.files.length,
        name: e.target.files[0]?.name,
        parentTestId: e.target.closest('[data-testid]')?.dataset.testId
      });
    }
  }, true);

  // Track clicks on buttons
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-testid],[data-icon],button,[role=button]');
    if (el) console.log('[DEBUG] CLICK', {
      testId: el.dataset?.testId,
      icon: el.dataset?.icon || el.querySelector('[data-icon]')?.dataset.icon,
      ariaLabel: el.ariaLabel,
      tag: el.tagName
    });
  }, true);

  // Watch for media editor appearing
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const ed = n.querySelector?.('[data-testid="media-editor"]') ||
        (n.dataset?.testId === 'media-editor' ? n : null);
      if (ed) console.log('[DEBUG] MEDIA EDITOR APPEARED', {
        editables: ed.querySelectorAll('[contenteditable=true]').length,
        sendBtns: ed.querySelectorAll('[data-testid=send]').length,
        sendIcons: ed.querySelectorAll('[data-icon=send]').length
      });
    }
  }).observe(document.body, {childList: true, subtree: true});

  console.log('[DEBUG] Monitoring started. Now manually attach & send an image.');
})();
