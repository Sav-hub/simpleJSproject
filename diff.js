// 1. Broadcast Channels Setup
const jsonSyncChannel = new BroadcastChannel('json_sync_channel');
const themeSyncChannel = new BroadcastChannel('theme_sync_channel');

const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = document.getElementById('theme-icon');

function applyTheme(themeName, broadcast = false) {
  if (themeName === 'dark') {
    document.body.classList.add('dark-theme');
    themeIcon.textContent = '☀️';
  } else {
    document.body.classList.remove('dark-theme');
    themeIcon.textContent = '🌙';
  }
  localStorage.setItem('json_studio_theme', themeName);

  if (broadcast) {
    themeSyncChannel.postMessage({ type: 'SET_THEME', theme: themeName });
  }
}

themeToggleBtn.addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark-theme');
  applyTheme(isDark ? 'grey' : 'dark', true);
});

themeSyncChannel.onmessage = (e) => {
  if (e.data?.type === 'SET_THEME' && e.data.theme) {
    applyTheme(e.data.theme, false);
  }
};

applyTheme(localStorage.getItem('json_studio_theme') || 'grey', false);

const diffInputLeft = document.getElementById('diff-input-left');
const diffInputRight = document.getElementById('diff-input-right');
const diffLinesLeft = document.getElementById('diff-lines-left');
const diffLinesRight = document.getElementById('diff-lines-right');
const diffBackdropLeft = document.getElementById('diff-backdrop-left');
const diffBackdropRight = document.getElementById('diff-backdrop-right');
const navToViewer = document.getElementById('nav-to-viewer');

const btnSyncScroll = document.getElementById('btn-sync-scroll');
const syncScrollLabel = document.getElementById('sync-scroll-label');

const filterBtnAll = document.getElementById('filter-btn-all');
const filterBtnAdd = document.getElementById('filter-btn-add');
const filterBtnDel = document.getElementById('filter-btn-del');
const filterBtnMod = document.getElementById('filter-btn-mod');

let syncScrollEnabled = true;
let isSyncingLeft = false;
let isSyncingRight = false;
let activeDiffFilter = 'ALL';

navToViewer.addEventListener('click', () => {
  const content = diffInputLeft.value.trim();
  if (content.startsWith('{') || content.startsWith('[')) {
    localStorage.setItem('shared_json_left', diffInputLeft.value);
  }
});

btnSyncScroll.addEventListener('click', () => {
  syncScrollEnabled = !syncScrollEnabled;
  btnSyncScroll.classList.toggle('active', syncScrollEnabled);
  syncScrollLabel.textContent = syncScrollEnabled ? 'Sync Scroll: ON' : 'Sync Scroll: OFF';
});

// Vertical Scroll Sync
diffInputLeft.addEventListener('scroll', () => {
  diffLinesLeft.scrollTop = diffInputLeft.scrollTop;
  diffBackdropLeft.scrollTop = diffInputLeft.scrollTop;

  if (!syncScrollEnabled || isSyncingLeft) return;
  isSyncingRight = true;
  diffInputRight.scrollTop = diffInputLeft.scrollTop;
  diffLinesRight.scrollTop = diffInputLeft.scrollTop;
  diffBackdropRight.scrollTop = diffInputLeft.scrollTop;
  requestAnimationFrame(() => { isSyncingRight = false; });
});

diffInputRight.addEventListener('scroll', () => {
  diffLinesRight.scrollTop = diffInputRight.scrollTop;
  diffBackdropRight.scrollTop = diffInputRight.scrollTop;

  if (!syncScrollEnabled || isSyncingRight) return;
  isSyncingLeft = true;
  diffInputLeft.scrollTop = diffInputRight.scrollTop;
  diffLinesLeft.scrollTop = diffInputRight.scrollTop;
  diffBackdropLeft.scrollTop = diffInputRight.scrollTop;
  requestAnimationFrame(() => { isSyncingLeft = false; });
});

function handleLeftInput(broadcast = true) {
  localStorage.setItem('shared_json_left', diffInputLeft.value);
  if (broadcast) {
    jsonSyncChannel.postMessage({
      type: 'UPDATE_JSON',
      payload: diffInputLeft.value
    });
  }
  executeLineByLineDiff();
}

diffInputLeft.addEventListener('input', () => handleLeftInput(true));
diffInputRight.addEventListener('input', executeLineByLineDiff);

jsonSyncChannel.onmessage = (e) => {
  if (e.data?.type === 'UPDATE_JSON' && e.data.payload !== diffInputLeft.value) {
    diffInputLeft.value = e.data.payload;
    handleLeftInput(false);
  }
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tokenize(str) {
  return str.match(/([a-zA-Z0-9_]+|\s+|[^\s\w])/g) || [];
}

function computeInlineTokens(tokensA, tokensB) {
  const n = tokensA.length;
  const m = tokensB.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (tokensA[i - 1] === tokensB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n, j = m;
  const diffA = new Map();
  const diffB = new Map();

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffB.set(j - 1, true);
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffA.set(i - 1, true);
      i--;
    }
  }

  return { diffA, diffB };
}

function computeLineDiff(linesA, linesB) {
  const N = linesA.length;
  const M = linesB.length;
  const dp = Array.from({ length: N + 1 }, () => new Int32Array(M + 1));

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      if (linesA[i - 1].trim() === linesB[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = N, j = M;
  const diffA = new Map();
  const diffB = new Map();

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1].trim() === linesB[j - 1].trim()) {
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffB.set(j - 1, 'ADD');
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffA.set(i - 1, 'DEL');
      i--;
    }
  }

  const pairedMods = new Map();
  diffA.forEach((typeA, idxA) => {
    const lineA = linesA[idxA].trim();
    const matchA = lineA.match(/"([^"]+)":/);
    if (matchA) {
      const keyA = matchA[1];
      diffB.forEach((typeB, idxB) => {
        const lineB = linesB[idxB].trim();
        const matchB = lineB.match(/"([^"]+)":/);
        if (matchB && matchB[1] === keyA) {
          diffA.set(idxA, 'MOD');
          diffB.set(idxB, 'MOD');
          pairedMods.set(idxA, idxB);
        }
      });
    }
  });

  return { diffA, diffB, pairedMods };
}

function renderHighlightedTokens(lineText, type, pairedLineText, filterActive) {
  if (!filterActive || !type) {
    return escapeHtml(lineText);
  }

  if (type === 'DEL' && !pairedLineText) {
    const trimmed = lineText.trim();
    if (!trimmed) return escapeHtml(lineText);
    const leading = lineText.match(/^\s*/)[0];
    const trailing = lineText.match(/\s*$/)[0];
    const core = lineText.slice(leading.length, lineText.length - trailing.length);
    return `${escapeHtml(leading)}<mark class="diff-token-del">${escapeHtml(core)}</mark>${escapeHtml(trailing)}`;
  }

  if (type === 'ADD' && !pairedLineText) {
    const trimmed = lineText.trim();
    if (!trimmed) return escapeHtml(lineText);
    const leading = lineText.match(/^\s*/)[0];
    const trailing = lineText.match(/\s*$/)[0];
    const core = lineText.slice(leading.length, lineText.length - trailing.length);
    return `${escapeHtml(leading)}<mark class="diff-token-add">${escapeHtml(core)}</mark>${escapeHtml(trailing)}`;
  }

  const tokensThis = tokenize(lineText);
  const tokensOther = tokenize(pairedLineText);
  const { diffA, diffB } = computeInlineTokens(tokensThis, tokensOther);
  const markMap = (type === 'DEL' || type === 'MOD') ? diffA : diffB;
  const highlightClass = type === 'MOD' ? 'diff-token-mod' : (type === 'DEL' ? 'diff-token-del' : 'diff-token-add');

  return tokensThis.map((tok, idx) => {
    if (markMap.has(idx) && tok.trim().length > 0) {
      return `<mark class="${highlightClass}">${escapeHtml(tok)}</mark>`;
    }
    return escapeHtml(tok);
  }).join('');
}

function executeLineByLineDiff() {
  const rawA = diffInputLeft.value;
  const rawB = diffInputRight.value;
  const linesA = rawA.split('\n');
  const linesB = rawB.split('\n');

  const { diffA, diffB, pairedMods } = computeLineDiff(linesA, linesB);

  let countAdd = 0, countDel = 0, countMod = 0;

  // Render left backdrop lines
  let backdropHtmlA = '';
  for (let i = 0; i < linesA.length; i++) {
    const type = diffA.get(i);
    let isFilterActive = false;

    if (type === 'DEL') {
      isFilterActive = (activeDiffFilter === 'ALL' || activeDiffFilter === 'DEL');
      countDel++;
    } else if (type === 'MOD') {
      isFilterActive = (activeDiffFilter === 'ALL' || activeDiffFilter === 'MOD');
      countMod++;
    }

    const pairedIdx = pairedMods.get(i);
    const pairedText = pairedIdx !== undefined ? linesB[pairedIdx] : null;
    const highlightedContent = renderHighlightedTokens(linesA[i], type, pairedText, isFilterActive);
    backdropHtmlA += `<div class="backdrop-line">${highlightedContent || '&nbsp;'}</div>`;
  }
  diffBackdropLeft.innerHTML = backdropHtmlA;

  // Render right backdrop lines
  let backdropHtmlB = '';
  for (let j = 0; j < linesB.length; j++) {
    const type = diffB.get(j);
    let isFilterActive = false;

    if (type === 'ADD') {
      isFilterActive = (activeDiffFilter === 'ALL' || activeDiffFilter === 'ADD');
      countAdd++;
    } else if (type === 'MOD') {
      isFilterActive = (activeDiffFilter === 'ALL' || activeDiffFilter === 'MOD');
    }

    let pairedText = null;
    for (const [idxA, idxB] of pairedMods.entries()) {
      if (idxB === j) { pairedText = linesA[idxA]; break; }
    }
    const highlightedContent = renderHighlightedTokens(linesB[j], type, pairedText, isFilterActive);
    backdropHtmlB += `<div class="backdrop-line">${highlightedContent || '&nbsp;'}</div>`;
  }
  diffBackdropRight.innerHTML = backdropHtmlB;

  // Sync line number heights directly to the actual rendered backdrop line heights
  const renderedLinesA = diffBackdropLeft.children;
  let gutterHtmlA = '';
  for (let i = 0; i < linesA.length; i++) {
    const type = diffA.get(i);
    let gutterClass = '';
    if (type === 'DEL' && (activeDiffFilter === 'ALL' || activeDiffFilter === 'DEL')) {
      gutterClass = 'gutter-del';
    } else if (type === 'MOD' && (activeDiffFilter === 'ALL' || activeDiffFilter === 'MOD')) {
      gutterClass = 'gutter-mod';
    }
    const h = renderedLinesA[i] ? renderedLinesA[i].getBoundingClientRect().height : 20;
    gutterHtmlA += `<div class="${gutterClass}" style="height:${h}px">${i + 1}</div>`;
  }
  diffLinesLeft.innerHTML = gutterHtmlA;

  const renderedLinesB = diffBackdropRight.children;
  let gutterHtmlB = '';
  for (let j = 0; j < linesB.length; j++) {
    const type = diffB.get(j);
    let gutterClass = '';
    if (type === 'ADD' && (activeDiffFilter === 'ALL' || activeDiffFilter === 'ADD')) {
      gutterClass = 'gutter-add';
    } else if (type === 'MOD' && (activeDiffFilter === 'ALL' || activeDiffFilter === 'MOD')) {
      gutterClass = 'gutter-mod';
    }
    const h = renderedLinesB[j] ? renderedLinesB[j].getBoundingClientRect().height : 20;
    gutterHtmlB += `<div class="${gutterClass}" style="height:${h}px">${j + 1}</div>`;
  }
  diffLinesRight.innerHTML = gutterHtmlB;

  filterBtnAdd.textContent = `+ ${countAdd} `;
  filterBtnDel.textContent = `- ${countDel} `;
  filterBtnMod.textContent = `~ ${countMod} `;
}

function setDiffFilter(filterType) {
  activeDiffFilter = filterType;
  filterBtnAll.classList.toggle('active', filterType === 'ALL');
  filterBtnAdd.classList.toggle('active', filterType === 'ADD');
  filterBtnDel.classList.toggle('active', filterType === 'DEL');
  filterBtnMod.classList.toggle('active', filterType === 'MOD');
  executeLineByLineDiff();
}

filterBtnAll.addEventListener('click', () => setDiffFilter('ALL'));
filterBtnAdd.addEventListener('click', () => setDiffFilter('ADD'));
filterBtnDel.addEventListener('click', () => setDiffFilter('DEL'));
filterBtnMod.addEventListener('click', () => setDiffFilter('MOD'));

document.getElementById('btn-diff-swap').addEventListener('click', () => {
  const temp = diffInputLeft.value;
  diffInputLeft.value = diffInputRight.value;
  diffInputRight.value = temp;
  handleLeftInput(true);
});

function showButtonFeedback(btn, isSuccess) {
  if (!btn) return;
  const originalContent = btn.innerHTML;
  btn.innerHTML = isSuccess 
    ? '<span style="font-size: 11px; font-weight: bold; color: #34d399;">✓</span>' 
    : '<span style="font-size: 11px; font-weight: bold; color: #f87171;">✕</span>';
  setTimeout(() => { btn.innerHTML = originalContent; }, 1400);
}

const btnFormatLeft = document.getElementById('btn-diff-format-left');
btnFormatLeft.addEventListener('click', () => {
  const raw = diffInputLeft.value;
  if (!raw.trim()) return;

  if (typeof analyzeJSONDiagnostics === 'function') {
    const diag = analyzeJSONDiagnostics(raw);
    if (diag && diag.success) {
      diffInputLeft.value = JSON.stringify(diag.data, null, 2);
      handleLeftInput(true);
      showButtonFeedback(btnFormatLeft, true);
    } else {
      showButtonFeedback(btnFormatLeft, false);
    }
  } else {
    try {
      diffInputLeft.value = JSON.stringify(JSON.parse(raw), null, 2);
      handleLeftInput(true);
      showButtonFeedback(btnFormatLeft, true);
    } catch {
      showButtonFeedback(btnFormatLeft, false);
    }
  }
});

const btnFormatRight = document.getElementById('btn-diff-format-right');
btnFormatRight.addEventListener('click', () => {
  const raw = diffInputRight.value;
  if (!raw.trim()) return;

  if (typeof analyzeJSONDiagnostics === 'function') {
    const diag = analyzeJSONDiagnostics(raw);
    if (diag && diag.success) {
      diffInputRight.value = JSON.stringify(diag.data, null, 2);
      executeLineByLineDiff();
      showButtonFeedback(btnFormatRight, true);
    } else {
      showButtonFeedback(btnFormatRight, false);
    }
  } else {
    try {
      diffInputRight.value = JSON.stringify(JSON.parse(raw), null, 2);
      executeLineByLineDiff();
      showButtonFeedback(btnFormatRight, true);
    } catch {
      showButtonFeedback(btnFormatRight, false);
    }
  }
});

document.getElementById('btn-diff-clear-left').addEventListener('click', () => {
  diffInputLeft.value = '';
  handleLeftInput(true);
});

document.getElementById('btn-diff-clear-right').addEventListener('click', () => {
  diffInputRight.value = '';
  executeLineByLineDiff();
});

window.addEventListener('resize', () => {
  executeLineByLineDiff();
});

const sharedLeft = localStorage.getItem('shared_json_left');
if (sharedLeft) {
  const trimmed = sharedLeft.trim();
  diffInputLeft.value = (trimmed.startsWith('{') || trimmed.startsWith('[')) ? sharedLeft : '';
} else {
  diffInputLeft.value = '';
}
diffInputRight.value = '';
executeLineByLineDiff();

window.addEventListener('beforeunload', () => {
  jsonSyncChannel.close();
  themeSyncChannel.close();
});