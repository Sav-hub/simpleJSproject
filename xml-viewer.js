const xmlSyncChannel = new BroadcastChannel('xml_sync_channel');
const themeSyncChannel = new BroadcastChannel('theme_sync_channel');

const textarea = document.getElementById('xml-textarea');
const editorLayer = document.getElementById('editor-layer');
const gutter = document.getElementById('gutter');
const gutterContent = document.getElementById('gutter-content');
const viewport = document.getElementById('viewport');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const activeFilenameEl = document.getElementById('active-filename');
const fileInput = document.getElementById('file-input');
const dropOverlay = document.getElementById('drop-overlay');

// Telemetry DOM
const diagnosticBadge = document.getElementById('diagnostic-badge');
const diagnosticText = document.getElementById('diagnostic-text');
const telCursor = document.getElementById('tel-cursor');
const telSelection = document.getElementById('tel-selection');
const telSelCount = document.getElementById('tel-sel-count');
const telLines = document.getElementById('tel-lines');
const telSize = document.getElementById('tel-size');
const telTags = document.getElementById('tel-tags');

// Inline Search Capsule DOM
const inlineSearchCapsule = document.getElementById('inline-search-capsule');
const searchInput = document.getElementById('search-input');
const replaceInput = document.getElementById('replace-input');
const searchCount = document.getElementById('search-count');
const toggleCaseBtn = document.getElementById('toggle-case');
const toggleRegexBtn = document.getElementById('toggle-regex');
const btnToggleFind = document.getElementById('btn-toggle-find');
const btnCloseFind = document.getElementById('btn-close-find');

let activeFilename = "document.xml";
let foldedBlocks = new Map();
let searchMatches = [];
let rawSearchMatches = [];
let currentSearchIdx = -1;
let errorLine = null;
let dragCounter = 0;
let isCaseSensitive = false;
let isRegex = false;

// 1. Theme Configuration
function applyTheme(isDark) {
  document.body.classList.toggle('dark-theme', isDark);
  document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
  document.getElementById('theme-label').textContent = isDark ? 'Grey Theme' : 'Dark Theme';
  localStorage.setItem('json_studio_theme', isDark ? 'dark' : 'grey');
}

themeToggleBtn.addEventListener('click', () => {
  const isDark = !document.body.classList.contains('dark-theme');
  applyTheme(isDark);
  themeSyncChannel.postMessage({ type: 'SET_THEME', theme: isDark ? 'dark' : 'grey' });
});

themeSyncChannel.onmessage = (e) => {
  if (e.data?.type === 'SET_THEME') applyTheme(e.data.theme === 'dark');
};
applyTheme(localStorage.getItem('json_studio_theme') === 'dark');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setEditorValue(newVal, newFilename = null) {
  textarea.value = newVal;
  if (newFilename) {
    activeFilename = newFilename;
    activeFilenameEl.textContent = `(${newFilename})`;
  }
  localStorage.setItem('shared_xml_left', newVal);
  xmlSyncChannel.postMessage({ type: 'UPDATE_XML', payload: newVal });
  validate();
  render();
}

// 2. Native DOMParser Validation & Telemetry (No Custom Logic)
function validate() {
  const raw = textarea.value;
  if (!raw.trim()) {
    errorLine = null;
    diagnosticBadge.className = 'diagnostic-badge valid';
    diagnosticText.textContent = 'Empty Document';
    telTags.innerHTML = '<span>0</span> tags';
    return;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "application/xml");
  const parserErr = doc.querySelector("parsererror");

  if (parserErr) {
    errorLine = 1;
    diagnosticBadge.className = 'diagnostic-badge error';
    diagnosticText.textContent = 'XML Syntax Error';
    telTags.innerHTML = '<span>—</span> tags';
  } else {
    errorLine = null;
    diagnosticBadge.className = 'diagnostic-badge valid';
    diagnosticText.textContent = 'Valid XML';
    const tagCount = doc.querySelectorAll('*').length;
    telTags.innerHTML = `<span>${tagCount}</span> tags`;
  }
}

function updateTelemetry() {
  const val = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  const linesBefore = val.substring(0, start).split('\n');
  const curLine = linesBefore.length;
  const curCol = linesBefore[linesBefore.length - 1].length + 1;
  telCursor.innerHTML = `Ln <span>${curLine}</span>, Col <span>${curCol}</span>`;

  if (start !== end) {
    telSelection.style.display = 'inline-flex';
    telSelCount.textContent = Math.abs(end - start);
  } else {
    telSelection.style.display = 'none';
  }

  const totalLines = val.split('\n').length;
  telLines.innerHTML = `<span>${val ? totalLines : 0}</span> lines`;

  const bytes = new Blob([val]).size;
  let formattedSize = bytes + ' B';
  if (bytes >= 1024 * 1024) formattedSize = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  else if (bytes >= 1024) formattedSize = (bytes / 1024).toFixed(1) + ' KB';
  telSize.innerHTML = `<span>${formattedSize}</span>`;
}

// 3. Robust XML Lexer & Block Folding Range Scanner
function parseEditorLines(rawText) {
  const lines = rawText.split('\n');
  const lineStructures = [];
  const stack = [];
  const foldRanges = [];

  lines.forEach((line, i) => {
    // 3A. Scan for multi-line block folding ranges
    const tagMatcher = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/)?([a-zA-Z0-9_\-:]+)((?:\s+[^>]*?)?)(\/)?>/g;
    let match;
    while ((match = tagMatcher.exec(line)) !== null) {
      const [full, isClose, tagName, , isSelfClosing] = match;
      if (full.startsWith('<!--') || full.startsWith('<![CDATA[') || full.startsWith('<?') || full.startsWith('<!')) {
        continue;
      }
      if (isSelfClosing) continue;

      if (isClose) {
        if (stack.length > 0 && stack[stack.length - 1].tag === tagName) {
          const start = stack.pop();
          if (start.line !== i) {
            foldRanges.push({ start: start.line, end: i, tag: tagName });
          }
        }
      } else {
        stack.push({ tag: tagName, line: i });
      }
    }

    // 3B. Tokenize line into syntax-highlighted HTML spans
    const tokenRegex = /(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^>]*?\?>|<\/?[a-zA-Z0-9_\-:]+|[a-zA-Z0-9_\-:]+(?=\s*=)|="[^"]*"|='[^']*'|\/?>|>|&[a-zA-Z0-9#]+;)/g;
    let formattedHtml = '';
    let lastIndex = 0;
    let tok;

    while ((tok = tokenRegex.exec(line)) !== null) {
      formattedHtml += escapeHtml(line.substring(lastIndex, tok.index));
      const str = tok[0];

      if (str.startsWith('<!--')) {
        formattedHtml += `<span class="xml-comment">${escapeHtml(str)}</span>`;
      } else if (str.startsWith('<![CDATA[')) {
        formattedHtml += `<span class="xml-cdata">${escapeHtml(str)}</span>`;
      } else if (str.startsWith('</') || str.startsWith('<')) {
        formattedHtml += `<span class="xml-punct">&lt;${str.startsWith('</') ? '/' : ''}</span><span class="xml-tag">${escapeHtml(str.replace(/^<\/?/, ''))}</span>`;
      } else if (str === '>' || str === '/>' || str.startsWith('<?') || str.endsWith('?>')) {
        formattedHtml += `<span class="xml-punct">${escapeHtml(str)}</span>`;
      } else if (str.startsWith('=')) {
        formattedHtml += `<span class="xml-punct">=</span><span class="xml-val">${escapeHtml(str.slice(1))}</span>`;
      } else if (str.startsWith('&')) {
        formattedHtml += `<span class="xml-punct">${escapeHtml(str)}</span>`;
      } else {
        formattedHtml += `<span class="xml-attr">${escapeHtml(str)}</span>`;
      }
      lastIndex = tokenRegex.lastIndex;
    }
    formattedHtml += escapeHtml(line.substring(lastIndex));

    lineStructures.push({ raw: line, html: formattedHtml || '&nbsp;' });
  });

  return { lineStructures, foldRanges };
}

// 4. Render Engine & True 1:1 Synchronized Layout
function render() {
  const raw = textarea.value;
  const { lineStructures, foldRanges } = parseEditorLines(raw);

  const activeStartLines = new Set(foldRanges.map(f => f.start));
  for (const key of foldedBlocks.keys()) {
    if (!activeStartLines.has(key)) foldedBlocks.delete(key);
  }

  const foldMap = new Map();
  foldRanges.forEach(f => foldMap.set(f.start, f));

  const hiddenLines = new Set();
  foldedBlocks.forEach((end, start) => {
    for (let i = start + 1; i <= end; i++) hiddenLines.add(i);
  });

  let gutterHtml = '';
  let editorHtml = '';
  let visibleLineCount = 0;

  lineStructures.forEach((l, idx) => {
    const isFolded = foldedBlocks.has(idx);
    const isHidden = hiddenLines.has(idx);
    const foldInfo = foldMap.get(idx);
    const isErr = errorLine === (idx + 1);

    if (!isHidden) {
      visibleLineCount++;
      gutterHtml += `
        <div class="gutter-row ${isErr ? 'error-line' : ''}" data-line="${idx + 1}">
          <span class="line-num">${idx + 1}</span>
          ${foldInfo ? `<span class="fold-btn ${isFolded ? 'folded' : ''}" onclick="toggleFold(${idx}, ${foldInfo.end})">▼</span>` : '<span style="width:14px"></span>'}
        </div>
      `;

      let foldBadge = '';
      if (isFolded && foldInfo) {
        const count = foldInfo.end - foldInfo.start;
        foldBadge = `<span class="fold-badge" onclick="toggleFold(${idx}, ${foldInfo.end})">... ${count} lines hidden &lt;/${foldInfo.tag}&gt;</span>`;
      }

      editorHtml += `<div class="code-line" id="code-line-${idx}">${l.html}${foldBadge}</div>`;
    }
  });

  const maxDigits = String(lineStructures.length).length;
  gutter.style.width = `${Math.max(52, maxDigits * 8 + 26)}px`;
  gutterContent.innerHTML = gutterHtml;
  editorLayer.innerHTML = editorHtml;

  const totalLines = foldedBlocks.size > 0 ? visibleLineCount : lineStructures.length;
  const exactContentHeight = totalLines * 22 + 24;
  const targetHeight = Math.max(exactContentHeight, viewport.clientHeight);
  const targetWidth = Math.max(editorLayer.scrollWidth, viewport.clientWidth);

  textarea.style.height = `${targetHeight}px`;
  textarea.style.width = `${targetWidth}px`;
  editorLayer.style.width = `${targetWidth}px`;
  gutterContent.style.height = `${targetHeight}px`;

  updateTelemetry();
  applySearch();
}

window.toggleFold = function(start, end) {
  if (foldedBlocks.has(start)) foldedBlocks.delete(start);
  else foldedBlocks.set(start, end);
  render();
};

viewport.addEventListener('scroll', () => { gutter.scrollTop = viewport.scrollTop; }, { passive: true });
textarea.addEventListener('scroll', () => {
  if (textarea.scrollTop !== 0 || textarea.scrollLeft !== 0) {
    viewport.scrollTop += textarea.scrollTop;
    viewport.scrollLeft += textarea.scrollLeft;
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;
    gutter.scrollTop = viewport.scrollTop;
  }
});

// 5. XML Pretty Print Formatter
function formatXml(xml) {
  let formatted = '';
  let indent = '';
  const tab = '  ';
  const tokens = xml.replace(/(>)(<)(\/*)/g, '$1\r\n$2$3').split('\r\n');

  tokens.forEach(node => {
    let padding = 0;
    if (node.match(/^<\/\w/)) {
      if (indent.length >= tab.length) indent = indent.substring(tab.length);
    }
    if (node.match(/^<?\w[^>]*[^\/]>$/) && !node.startsWith('<?') && !node.startsWith('<!')) {
      padding = 1;
    }
    formatted += indent + node + '\n';
    if (padding === 1) indent += tab;
  });
  return formatted.trim();
}

function minifyXml(xml) {
  return xml.replace(/>\s+</g, '><').trim();
}

// 6. Action Listeners
document.getElementById('btn-format').addEventListener('click', () => {
  if (!textarea.value.trim()) return;
  setEditorValue(formatXml(textarea.value));
});

document.getElementById('btn-minify').addEventListener('click', () => {
  if (!textarea.value.trim()) return;
  setEditorValue(minifyXml(textarea.value));
});

document.getElementById('btn-clear').addEventListener('click', () => setEditorValue('', 'untitled.xml'));
document.getElementById('btn-expand-all').addEventListener('click', () => { foldedBlocks.clear(); render(); });
document.getElementById('btn-collapse-all').addEventListener('click', () => {
  const { foldRanges } = parseEditorLines(textarea.value);
  foldRanges.forEach(f => foldedBlocks.set(f.start, f.end));
  render();
});

// File I/O
document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => { setEditorValue(evt.target.result, file.name); fileInput.value = ''; };
  reader.readAsText(file);
});

document.getElementById('btn-save').addEventListener('click', () => {
  const blob = new Blob([textarea.value], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = activeFilename || 'document.xml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const btn = document.getElementById('btn-copy');
  const oldSvg = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(textarea.value);
    btn.innerHTML = '<span style="font-size: 11px; font-weight: bold; color: #34d399;">✓</span>';
  } catch {
    btn.innerHTML = '<span style="font-size: 11px; font-weight: bold; color: #f87171;">✕</span>';
  }
  setTimeout(() => { btn.innerHTML = oldSvg; }, 1400);
});

// Drag and Drop
const mainView = document.getElementById('main-view');
mainView.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropOverlay.classList.add('active'); });
mainView.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); } });
mainView.addEventListener('dragover', (e) => e.preventDefault());
mainView.addEventListener('drop', (e) => {
  e.preventDefault(); dragCounter = 0; dropOverlay.classList.remove('active');
  const file = e.dataTransfer.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (evt) => setEditorValue(evt.target.result, file.name);
    reader.readAsText(file);
  }
});

// 7. Find & Replace System
function openSearch(focusReplace = false) {
  inlineSearchCapsule.classList.add('active');
  btnToggleFind.classList.add('active');
  if (focusReplace) replaceInput.focus();
  else searchInput.focus();
  applySearch();
}

function closeSearch() {
  inlineSearchCapsule.classList.remove('active');
  btnToggleFind.classList.remove('active');
  searchMatches = [];
  rawSearchMatches = [];
  currentSearchIdx = -1;
  render();
  textarea.focus();
}

function getSearchRegExp(global = false) {
  if (!inlineSearchCapsule.classList.contains('active')) return null;
  const query = searchInput.value;
  if (!query) return null;
  let flags = global ? 'g' : '';
  if (!isCaseSensitive) flags += 'i';
  try {
    return isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    return null;
  }
}

function applySearch() {
  const regexGlobal = getSearchRegExp(true);
  const regexTest = getSearchRegExp(false);
  if (!regexGlobal || !regexTest) {
    searchCount.textContent = '0/0';
    searchMatches = [];
    return;
  }

  const lines = editorLayer.querySelectorAll('.code-line');
  searchMatches = [];

  lines.forEach(line => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement.closest('.fold-badge')) textNodes.push(walker.currentNode);
    }

    textNodes.forEach(node => {
      const val = node.nodeValue;
      if (!regexTest.test(val)) return;

      const frag = document.createDocumentFragment();
      let last = 0;
      val.replace(getSearchRegExp(true), (mText, offset) => {
        if (offset > last) frag.appendChild(document.createTextNode(val.slice(last, offset)));
        const mark = document.createElement('mark');
        mark.className = 'highlight';
        mark.textContent = mText;
        frag.appendChild(mark);
        last = offset + mText.length;
      });
      if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  });

  searchMatches = Array.from(editorLayer.querySelectorAll('mark.highlight'));
  if (searchMatches.length > 0) {
    if (currentSearchIdx >= searchMatches.length || currentSearchIdx < 0) currentSearchIdx = 0;
    searchMatches.forEach((m, i) => m.classList.toggle('active-match', i === currentSearchIdx));
    searchCount.textContent = `${currentSearchIdx + 1}/${searchMatches.length}`;
  } else {
    searchCount.textContent = '0/0';
  }
}

function stepSearch(dir) {
  if (!searchMatches.length) return;
  currentSearchIdx = (currentSearchIdx + dir + searchMatches.length) % searchMatches.length;
  applySearch();
}

btnToggleFind.addEventListener('click', () => {
  if (inlineSearchCapsule.classList.contains('active')) closeSearch();
  else openSearch();
});
btnCloseFind.addEventListener('click', closeSearch);
searchInput.addEventListener('input', () => { currentSearchIdx = 0; render(); });
toggleCaseBtn.addEventListener('click', () => { isCaseSensitive = !isCaseSensitive; toggleCaseBtn.classList.toggle('active', isCaseSensitive); applySearch(); });
toggleRegexBtn.addEventListener('click', () => { isRegex = !isRegex; toggleRegexBtn.classList.toggle('active', isRegex); applySearch(); });
document.getElementById('search-next').addEventListener('click', () => stepSearch(1));
document.getElementById('search-prev').addEventListener('click', () => stepSearch(-1));

document.getElementById('btn-replace').addEventListener('click', () => {
  const regex = getSearchRegExp(false);
  if (!regex) return;
  textarea.value = textarea.value.replace(regex, replaceInput.value);
  setEditorValue(textarea.value);
});

document.getElementById('btn-replace-all').addEventListener('click', () => {
  const regex = getSearchRegExp(true);
  if (!regex) return;
  textarea.value = textarea.value.replace(regex, replaceInput.value);
  setEditorValue(textarea.value);
});

// 8. Smart XML Caret & Indentation
textarea.addEventListener('keydown', (e) => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;

  if (e.key === 'Tab') {
    e.preventDefault();
    textarea.setRangeText('  ', start, end, 'end');
    textarea.selectionStart = textarea.selectionEnd = start + 2;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const before = val.substring(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const currentLine = before.substring(lineStart);
    const currentIndent = (currentLine.match(/^\s*/) || [''])[0];
    const insertText = '\n' + currentIndent;
    textarea.setRangeText(insertText, start, end, 'end');
    textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

// Shortcuts & Input Listeners
textarea.addEventListener('input', () => { validate(); render(); });
['click', 'keyup', 'focus', 'select'].forEach(evt => textarea.addEventListener(evt, () => { updateTelemetry(); render(); }));

// Initialization
const initialXml = localStorage.getItem('shared_xml_left') || '<root>\n  <item id="1">Hello XML</item>\n</root>';
textarea.value = initialXml;
validate();
render();