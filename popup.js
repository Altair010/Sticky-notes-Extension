// popup.js
// Interacts with content script via chrome.tabs.sendMessage and reads storage to list highlights.

document.getElementById('addNote').addEventListener('click', () => {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    // ask content script to create a note
    chrome.tabs.sendMessage(tab.id, { action: 'create-note', text: '', x: 150, y: 150 }, () => {
      window.close(); // close popup to let user see the note
    });
  });
});

document.getElementById('refreshBtn').addEventListener('click', loadHighlights);
document.addEventListener('DOMContentLoaded', loadHighlights);

function loadHighlights() {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    const url = new URL(tab.url);
    const site = url.hostname;

    chrome.storage.local.get(site, (data) => {
      const siteData = data[site] || { notes: [], highlights: [] };
      const list = document.getElementById('highlightsList');
      list.innerHTML = '';

      if (!siteData.highlights || siteData.highlights.length === 0) {
        list.textContent = 'No highlights yet.';
        return;
      }

      siteData.highlights.forEach(h => {
        const div = document.createElement('div');
        div.className = 'popup-highlight';

        const colorBox = document.createElement('div');
        colorBox.className = 'color-box';
        colorBox.style.background = h.color || 'yellow';

        const text = document.createElement('div');
        text.className = 'hl-text';
        text.textContent = (h.selectedText || '(highlight)');

        const jump = document.createElement('button');
        jump.textContent = 'Jump';
        jump.addEventListener('click', () => {
          chrome.tabs.sendMessage(tab.id, { action: 'scroll-to-highlight', id: h.id });
          window.close();
        });

        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', () => {
          chrome.tabs.sendMessage(tab.id, { action: 'remove-highlight', id: h.id });
          // remove quickly from popup view
          setTimeout(loadHighlights, 200);
        });

        div.appendChild(colorBox);
        div.appendChild(text);
        div.appendChild(jump);
        div.appendChild(del);
        list.appendChild(div);
      });
    });
  });
}
