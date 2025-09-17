// content.js
// Content script: restores notes & highlights on load, handles highlight creation/removal, sticky notes.

// Unique ID generator
function genId(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

const SITE = window.location.hostname;

// ---------- XPATH helpers (handles element and text nodes) ----------
function getXPath(node) {
  if (!node) return null;

  // Text node
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentNode;
    // count text node index among parent's childNodes that are text nodes
    let idx = 0;
    for (let i = 0; i < parent.childNodes.length; i++) {
      const n = parent.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE) {
        idx++;
        if (n === node) {
          return getXPath(parent) + `/text()[${idx}]`;
        }
      }
    }
  }

  // Element node
  let segments = [];
  for (let cur = node; cur && cur.nodeType === Node.ELEMENT_NODE; cur = cur.parentNode) {
    let tag = cur.nodeName.toLowerCase();
    // compute index among siblings with same tag
    let index = 1;
    let sib = cur.previousSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === cur.nodeName) index++;
      sib = sib.previousSibling;
    }
    segments.unshift(index > 1 ? `${tag}[${index}]` : tag);
  }
  return '/' + segments.join('/');
}

function getNodeByXPath(xpath) {
  if (!xpath) return null;
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
  } catch (e) {
    return null;
  }
}

// ---------- Storage helpers ----------
function loadSiteData(callback) {
  chrome.storage.local.get(SITE, (data) => {
    callback(data[SITE] || { notes: [], highlights: [] });
  });
}

function saveSiteData(siteData, callback) {
  chrome.storage.local.set({ [SITE]: siteData }, () => {
    if (callback) callback();
  });
}

// ---------- Highlighting ----------
function createHighlightFromSelection(color = 'yellow') {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;

  // Build metadata
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startXPath = getXPath(startContainer);
  const endXPath = getXPath(endContainer);
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;

  const hid = genId('h');

  // Create wrapper span and apply color & id
  const wrapper = document.createElement('span');
  wrapper.className = 'saved-highlight';
  wrapper.dataset.hid = hid;
  wrapper.dataset.color = color;
  wrapper.style.backgroundColor = color;

  // Try to wrap selection safely; fallback if surroundContents fails
  try {
    range.surroundContents(wrapper);
  } catch (e) {
    // fallback: extract and insert inside span
    const content = range.extractContents();
    wrapper.appendChild(content);
    range.insertNode(wrapper);
  }

  const selectedText = wrapper.innerText || wrapper.textContent || '';

  // Save highlight metadata
  loadSiteData((siteData) => {
    siteData.highlights = siteData.highlights || [];
    siteData.highlights.push({
      id: hid,
      color,
      startXPath,
      startOffset,
      endXPath,
      endOffset,
      selectedText
    });
    saveSiteData(siteData);
  });

  // attach dblclick handler to remove
  wrapper.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    removeHighlightById(hid);
  });

  // clear selection
  sel.removeAllRanges();
}

function restoreHighlight(h) {
  // h should include startXPath, startOffset, endXPath, endOffset, id, color
  const startNode = getNodeByXPath(h.startXPath);
  const endNode = getNodeByXPath(h.endXPath);
  if (!startNode || !endNode) return;

  const range = document.createRange();
  try {
    range.setStart(startNode, h.startOffset);
    range.setEnd(endNode, h.endOffset);
  } catch (e) {
    // offsets or nodes changed -> skip this highlight
    return;
  }

  const span = document.createElement('span');
  span.className = 'saved-highlight';
  span.dataset.hid = h.id;
  span.dataset.color = h.color || 'yellow';
  span.style.backgroundColor = h.color || 'yellow';

  try {
    range.surroundContents(span);
  } catch (e) {
    // fallback: extract and insert inside span
    const content = range.extractContents();
    span.appendChild(content);
    range.insertNode(span);
  }

  span.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();
    removeHighlightById(span.dataset.hid);
  });
}

function removeHighlightById(id) {
  if (!id) return;
  // Remove from DOM: replace span with its children (keep text)
  const el = document.querySelector(`.saved-highlight[data-hid="${id}"]`);
  if (el && el.parentNode) {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  // Remove metadata from storage
  loadSiteData((siteData) => {
    siteData.highlights = (siteData.highlights || []).filter(h => h.id !== id);
    saveSiteData(siteData);
  });
}

function scrollToHighlightById(id) {
  const el = document.querySelector(`.saved-highlight[data-hid="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // small visual pulse
  el.style.transition = 'box-shadow 0.3s';
  el.style.boxShadow = '0 0 0 3px rgba(0,0,0,0.15)';
  setTimeout(() => { el.style.boxShadow = ''; }, 700);
}

// ---------- Sticky notes ----------
function createNote(text = '', x = 150, y = 150, nid = null, color = '#fff59b') {
  const note = document.createElement('div');
  note.className = 'sticky-note';
  note.style.left = (x || 150) + 'px';
  note.style.top = (y || 150) + 'px';
  note.dataset.nid = nid || genId('n');

  // header
  const header = document.createElement('div');
  header.className = 'sticky-note-header';

  const title = document.createElement('span');
  title.textContent = 'Note';
  title.style.flex = '1';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'X';
  closeBtn.title = 'Delete note';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    note.remove();
    saveAllData();
  });

  header.appendChild(title);
  header.appendChild(closeBtn);

  const textarea = document.createElement('textarea');
  textarea.value = text || '';
  textarea.addEventListener('input', saveAllData);

  note.appendChild(header);
  note.appendChild(textarea);
  note.style.background = color;

  document.body.appendChild(note);
  dragElement(note, header);

  // focus cursor in new note
  textarea.focus();
}

function saveAllData() {
  // collect notes
  const notes = Array.from(document.querySelectorAll('.sticky-note')).map(n => ({
    id: n.dataset.nid,
    text: n.querySelector('textarea').value,
    x: parseInt(n.style.left || '0', 10),
    y: parseInt(n.style.top || '0', 10),
    color: n.style.background || '#fff59b'
  }));

  // collect colors/text for highlights (to update metadata if needed)
  const domHighlights = Array.from(document.querySelectorAll('.saved-highlight')).map(h => ({
    id: h.dataset.hid,
    color: h.dataset.color || h.style.backgroundColor || 'yellow',
    selectedText: h.innerText || h.textContent || ''
  }));

  loadSiteData((siteData) => {
    siteData = siteData || { notes: [], highlights: [] };

    // replace notes
    siteData.notes = notes;

    // update highlights metadata (preserve XPath/offsets already stored)
    siteData.highlights = (siteData.highlights || []).map(h => {
      const dom = domHighlights.find(d => d.id === h.id);
      if (dom) {
        h.color = dom.color;
        h.selectedText = dom.selectedText;
      }
      return h;
    });

    saveSiteData(siteData);
  });
}

// ---------- Drag helper ----------
function dragElement(elmnt, handle) {
  let startX = 0, startY = 0, x = 0, y = 0;

  handle.style.cursor = 'move';
  handle.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    x = elmnt.offsetLeft;
    y = elmnt.offsetTop;
    document.onmouseup = closeDrag;
    document.onmousemove = drag;
  }

  function drag(e) {
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    elmnt.style.left = (x + dx) + 'px';
    elmnt.style.top = (y + dy) + 'px';
  }

  function closeDrag() {
    document.onmouseup = null;
    document.onmousemove = null;
    saveAllData();
  }
}

// ---------- Restore on load ----------
function restoreAll() {
  loadSiteData((siteData) => {
    siteData = siteData || { notes: [], highlights: [] };

    // restore notes
    if (Array.isArray(siteData.notes)) {
      siteData.notes.forEach(n => {
        createNote(n.text, n.x, n.y, n.id, n.color);
      });
    }

    // restore highlights precisely
    if (Array.isArray(siteData.highlights)) {
      siteData.highlights.forEach(h => {
        try { restoreHighlight(h); } catch (e) { console.warn('restore highlight failed', e); }
      });
    }
  });
}

// ---------- Message listener (from background or popup) ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  if (msg.action === 'highlight-selection') {
    createHighlightFromSelection(msg.color || 'yellow');
  } else if (msg.action === 'remove-highlight') {
    removeHighlightById(msg.id);
  } else if (msg.action === 'scroll-to-highlight') {
    scrollToHighlightById(msg.id);
  } else if (msg.action === 'create-note') {
    createNote(msg.text || '', msg.x || 150, msg.y || 150, msg.id || null, msg.color || '#fff59b');
  }
});

// run restore after DOM idle
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  restoreAll();
} else {
  window.addEventListener('DOMContentLoaded', restoreAll);
}
