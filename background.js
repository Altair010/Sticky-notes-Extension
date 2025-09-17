// background.js
// Creates context menu items for highlight colors and forwards the action to the page (content script).

chrome.runtime.onInstalled.addListener(() => {
  const colors = [
    { id: "yellow", title: "Highlight — Yellow" },
    { id: "pink",   title: "Highlight — Pink" },
    { id: "green",  title: "Highlight — Green" },
    { id: "blue",   title: "Highlight — Blue" }
  ];

  colors.forEach(c => {
    chrome.contextMenus.create({
      id: `highlight_${c.id}`,
      title: c.title,
      contexts: ["selection"] // only shown when some text is selected
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !info.menuItemId) return;
  if (info.menuItemId.startsWith("highlight_")) {
    const color = info.menuItemId.replace("highlight_", "");
    // Ask the content script in the active tab to save & render the highlight
    chrome.tabs.sendMessage(tab.id, { action: "highlight-selection", color });
  }
});
