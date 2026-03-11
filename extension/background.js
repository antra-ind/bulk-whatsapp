// Background service worker
// Handles opening WhatsApp Web tab if needed

chrome.runtime.onInstalled.addListener(() => {
  console.log("Bulk WhatsApp Sender extension installed");
});

// Open WhatsApp Web when extension icon clicked and no WA tab exists
chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs.length === 0) {
    chrome.tabs.create({ url: "https://web.whatsapp.com" });
  } else {
    chrome.tabs.update(tabs[0].id, { active: true });
  }
});
