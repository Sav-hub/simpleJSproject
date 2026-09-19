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

const btnJumpPrev = document.getElementById('btn-jump-prev');
const btnJumpNext = document.getElementById('btn-jump-next');
const diffJumpCounter = document.getElementById('diff-jump-counter');
const btnClearAll = document.getElementById('btn-diff-clear-all');

let syncScrollEnabled = true;
let isProgrammaticScrolling = false;
let scrollLockTimeout = null;
let activeDiffFilter = 'ALL';

let jumpDeltas = [];
let currentJumpIndex = -1;

navToViewer.addEventListener('click', () => {
  const content = diffInputLeft.value.trim();
  if (content.startsWith('{') || content.startsWith('[')) {
    sessionStorage.setItem('shared_json_left', diffInputLeft.value);
  }
});

btnSyncScroll.addEventListener('click', () => {
  syncScrollEnabled = !syncScrollEnabled;
  btnSyncScroll.classList.toggle('active', syncScrollEnabled);
  syncScrollLabel.textContent = syncScrollEnabled ? 'Sync Scroll: ON' : 'Sync Scroll: OFF';
});

// Hardware-Accelerated Leader-Follower Sync
let activeScrollSource = null;
let scrollReleaseTimer = null;

function claimScrollDriver(source) {
  activeScrollSource = source;
  clearTimeout(scrollReleaseTimer);
  scrollReleaseTimer = setTimeout(() => {
    activeScrollSource = null;
  }, 120);
}

function updatePositions(target, top) {
  const gutter = target === 'left' ? diffLinesLeft.firstElementChild : diffLinesRight.firstElementChild;
  const backdrop = target === 'left' ? diffBackdropLeft.firstElementChild : diffBackdropRight.firstElementChild;

  if (gutter) gutter.style.transform = `translate3d(0, ${-top}px, 0)`;
  if (backdrop) backdrop.style.transform = `translate3d(0, ${-top}px, 0)`;
}

diffInputLeft.addEventListener('wheel', () => claimScrollDriver('left'), { passive: true });
diffInputLeft.addEventListener('mouseenter', () => claimScrollDriver('left'), { passive: true });
diffInputLeft.addEventListener('pointerdown', () => claimScrollDriver('left'), { passive: true });

diffInputRight.addEventListener('wheel', () => claimScrollDriver('right'), { passive: true });
diffInputRight.addEventListener('mouseenter', () => claimScrollDriver('right'), { passive: true });
diffInputRight.addEventListener('pointerdown', () => claimScrollDriver('right'), { passive: true });

diffInputLeft.addEventListener('scroll', () => {
  const top = diffInputLeft.scrollTop;
  updatePositions('left', top);

  if (isProgrammaticScrolling) return;

  if (syncScrollEnabled && (activeScrollSource === 'left' || !activeScrollSource)) {
    claimScrollDriver('left');
    diffInputRight.scrollTop = top;
    updatePositions('right', top);
  }
}, { passive: true });

diffInputRight.addEventListener('scroll', () => {
  const top = diffInputRight.scrollTop;
  updatePositions('right', top);

  if (isProgrammaticScrolling) return;

  if (syncScrollEnabled && (activeScrollSource === 'right' || !activeScrollSource)) {
    claimScrollDriver('right');
    diffInputLeft.scrollTop = top;
    updatePositions('left', top);
  }
}, { passive: true });

function handleLeftInput(broadcast = true) {
  sessionStorage.setItem('shared_json_left', diffInputLeft.value);
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
  return str.match(/(".*?"|[a-zA-Z0-9_]+|\s+|[^\s\w])/g) || [];
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
  const diffA = new Set();
  const diffB = new Set();

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffB.add(j - 1);
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffA.add(i - 1);
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

  // Correlate corresponding keys: choose closest matching index
  const pairedModsA = new Map();
  const pairedModsB = new Map();
  const matchedRightIndices = new Set();

  diffA.forEach((typeA, idxA) => {
    const lineA = linesA[idxA].trim();
    const matchA = lineA.match(/"([^"]+)"\s*:/);
    if (matchA) {
      const keyA = matchA[1];
      let bestBIdx = -1;
      let minDistance = Infinity;

      for (const [idxB] of diffB.entries()) {
        if (!matchedRightIndices.has(idxB)) {
          const lineB = linesB[idxB].trim();
          const matchB = lineB.match(/"([^"]+)"\s*:/);
          if (matchB && matchB[1] === keyA) {
            const distance = Math.abs(idxA - idxB);
            if (distance < minDistance) {
              minDistance = distance;
              bestBIdx = idxB;
            }
          }
        }
      }

      if (bestBIdx !== -1) {
        diffA.set(idxA, 'MOD');
        diffB.set(bestBIdx, 'MOD');
        pairedModsA.set(idxA, bestBIdx);
        pairedModsB.set(bestBIdx, idxA);
        matchedRightIndices.add(bestBIdx);
      }
    }
  });

  return { diffA, diffB, pairedModsA, pairedModsB };
}

function renderTokens(tokens, changeSet, highlightClass) {
  return tokens.map((tok, idx) => {
    if (changeSet && changeSet.has(idx)) {
      if (!tok.trim()) return escapeHtml(tok);
      return `<mark class="${highlightClass}">${escapeHtml(tok)}</mark>`;
    }
    return escapeHtml(tok);
  }).join('');
}

function renderHighlightedTokens(lineText, type, pairedLineText, isFilterActive, isLeft) {
  if (!isFilterActive || !type) {
    return escapeHtml(lineText);
  }

  if (!pairedLineText) {
    const highlightClass = type === 'DEL' ? 'diff-token-del' : 'diff-token-add';
    const leading = lineText.match(/^\s*/)[0];
    const trailing = lineText.match(/\s*$/)[0];
    const core = lineText.slice(leading.length, lineText.length - trailing.length);
    if (!core) return escapeHtml(lineText);
    return `${escapeHtml(leading)}<mark class="${highlightClass}">${escapeHtml(core)}</mark>${escapeHtml(trailing)}`;
  }

  const tokensThis = tokenize(lineText);
  const tokensOther = tokenize(pairedLineText);
  const { diffA, diffB } = computeInlineTokens(tokensThis, tokensOther);
  const activeChangeSet = isLeft ? diffA : diffB;
  return renderTokens(tokensThis, activeChangeSet, 'diff-token-mod');
}

function executeLineByLineDiff() {
  const rawA = diffInputLeft.value;
  const rawB = diffInputRight.value;

  const linesA = rawA.length > 0 ? rawA.split('\n') : [];
  const linesB = rawB.length > 0 ? rawB.split('\n') : [];

  const { diffA, diffB, pairedModsA, pairedModsB } = computeLineDiff(linesA, linesB);

  let countAdd = 0, countDel = 0, countMod = 0;

  // 1. Render Left Backdrops
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

    const pairedIdx = pairedModsA.get(i);
    const pairedText = pairedIdx !== undefined ? linesB[pairedIdx] : null;
    const content = renderHighlightedTokens(linesA[i], type, pairedText, isFilterActive, true);
    backdropHtmlA += `<div class="backdrop-line">${content || '&nbsp;'}</div>`;
  }
  diffBackdropLeft.innerHTML = `<div class="backdrop-content">${backdropHtmlA}</div>`;

  // 2. Render Right Backdrops
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

    const pairedIdx = pairedModsB.get(j);
    const pairedText = pairedIdx !== undefined ? linesA[pairedIdx] : null;
    const content = renderHighlightedTokens(linesB[j], type, pairedText, isFilterActive, false);
    backdropHtmlB += `<div class="backdrop-line">${content || '&nbsp;'}</div>`;
  }
  diffBackdropRight.innerHTML = `<div class="backdrop-content">${backdropHtmlB}</div>`;

  // 3. Measure Rendered Heights
  requestAnimationFrame(() => {
    const backdropContentA = diffBackdropLeft.firstElementChild;
    const renderedLinesA = backdropContentA ? backdropContentA.children : [];
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
      gutterHtmlA += `<div class="gutter-row ${gutterClass}" style="height:${h}px">${i + 1}</div>`;
    }
    diffLinesLeft.innerHTML = `<div class="line-numbers-content">${gutterHtmlA}</div>`;

    const backdropContentB = diffBackdropRight.firstElementChild;
    const renderedLinesB = backdropContentB ? backdropContentB.children : [];
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
      gutterHtmlB += `<div class="gutter-row ${gutterClass}" style="height:${h}px">${j + 1}</div>`;
    }
    diffLinesRight.innerHTML = `<div class="line-numbers-content">${gutterHtmlB}</div>`;

    updatePositions('left', diffInputLeft.scrollTop);
    updatePositions('right', diffInputRight.scrollTop);
  });

  filterBtnAdd.textContent = `+ ${countAdd} `;
  filterBtnDel.textContent = `- ${countDel} `;
  filterBtnMod.textContent = `~ ${countMod} `;

  buildJumpDeltas(diffA, diffB, pairedModsA);
}

function buildJumpDeltas(diffA, diffB, pairedModsA) {
  jumpDeltas = [];
  const handledRightIndices = new Set();

  for (const [idxA, typeA] of diffA.entries()) {
    let qualifies = false;
    if (activeDiffFilter === 'ALL') qualifies = true;
    else if (activeDiffFilter === 'DEL' && typeA === 'DEL') qualifies = true;
    else if (activeDiffFilter === 'MOD' && typeA === 'MOD') qualifies = true;

    if (qualifies) {
      const idxB = pairedModsA.get(idxA) ?? null;
      if (idxB !== null) handledRightIndices.add(idxB);
      jumpDeltas.push({ lineA: idxA, lineB: idxB });
    }
  }

  for (const [idxB, typeB] of diffB.entries()) {
    if (handledRightIndices.has(idxB)) continue;
    let qualifies = false;
    if (activeDiffFilter === 'ALL') qualifies = true;
    else if (activeDiffFilter === 'ADD' && typeB === 'ADD') qualifies = true;
    else if (activeDiffFilter === 'MOD' && typeB === 'MOD') qualifies = true;

    if (qualifies) {
      jumpDeltas.push({ lineA: null, lineB: idxB });
    }
  }

  jumpDeltas.sort((a, b) => {
    const posA = a.lineA !== null ? a.lineA : a.lineB;
    const posB = b.lineA !== null ? b.lineA : b.lineB;
    return posA - posB;
  });

  if (jumpDeltas.length === 0) {
    currentJumpIndex = -1;
    diffJumpCounter.textContent = '0 / 0';
    btnJumpPrev.disabled = true;
    btnJumpNext.disabled = true;
  } else {
    if (currentJumpIndex >= jumpDeltas.length) {
      currentJumpIndex = jumpDeltas.length - 1;
    } else if (currentJumpIndex === -1) {
      currentJumpIndex = 0;
    }
    diffJumpCounter.textContent = `${currentJumpIndex + 1} / ${jumpDeltas.length}`;
    btnJumpPrev.disabled = false;
    btnJumpNext.disabled = false;
  }
}

function jumpToDelta(index) {
  if (index < 0 || index >= jumpDeltas.length) return;
  currentJumpIndex = index;
  diffJumpCounter.textContent = `${currentJumpIndex + 1} / ${jumpDeltas.length}`;

  const delta = jumpDeltas[index];

  document.querySelectorAll('.jump-target').forEach(el => el.classList.remove('jump-target'));

  let targetScrollY = 0;

  const contentA = diffBackdropLeft.firstElementChild;
  const linesA = contentA ? contentA.children : [];
  const gutterContentA = diffLinesLeft.firstElementChild;
  const guttersA = gutterContentA ? gutterContentA.children : [];

  const contentB = diffBackdropRight.firstElementChild;
  const linesB = contentB ? contentB.children : [];
  const gutterContentB = diffLinesRight.firstElementChild;
  const guttersB = gutterContentB ? gutterContentB.children : [];

  if (delta.lineA !== null && linesA[delta.lineA]) {
    const nodeA = linesA[delta.lineA];
    const boxA = nodeA.getBoundingClientRect();
    const containerBoxA = diffInputLeft.getBoundingClientRect();
    targetScrollY = (boxA.top - containerBoxA.top + diffInputLeft.scrollTop) - (diffInputLeft.clientHeight / 2) + (boxA.height / 2);

    if (guttersA[delta.lineA]) guttersA[delta.lineA].classList.add('jump-target');
  } else if (delta.lineB !== null && linesB[delta.lineB]) {
    const nodeB = linesB[delta.lineB];
    const boxB = nodeB.getBoundingClientRect();
    const containerBoxB = diffInputRight.getBoundingClientRect();
    targetScrollY = (boxB.top - containerBoxB.top + diffInputRight.scrollTop) - (diffInputRight.clientHeight / 2) + (boxB.height / 2);

    if (guttersB[delta.lineB]) guttersB[delta.lineB].classList.add('jump-target');
  }

  if (delta.lineA !== null && delta.lineB !== null) {
    if (guttersB[delta.lineB]) guttersB[delta.lineB].classList.add('jump-target');
  }

  targetScrollY = Math.max(0, targetScrollY);

  isProgrammaticScrolling = true;
  clearTimeout(scrollLockTimeout);

  diffInputLeft.scrollTo({ top: targetScrollY, behavior: 'smooth' });
  diffInputRight.scrollTo({ top: targetScrollY, behavior: 'smooth' });
  updatePositions('left', targetScrollY);
  updatePositions('right', targetScrollY);

  scrollLockTimeout = setTimeout(() => {
    isProgrammaticScrolling = false;
  }, 400);
}

btnJumpPrev.addEventListener('click', () => {
  if (jumpDeltas.length === 0) return;
  const prevIdx = currentJumpIndex > 0 ? currentJumpIndex - 1 : jumpDeltas.length - 1;
  jumpToDelta(prevIdx);
});

btnJumpNext.addEventListener('click', () => {
  if (jumpDeltas.length === 0) return;
  const nextIdx = currentJumpIndex < jumpDeltas.length - 1 ? currentJumpIndex + 1 : 0;
  jumpToDelta(nextIdx);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'F7') {
    e.preventDefault();
    if (e.shiftKey) {
      btnJumpPrev.click();
    } else {
      btnJumpNext.click();
    }
  }
});

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
  const iconContainer = btn.querySelector('.btn-icon') || btn;
  const originalSvg = iconContainer.innerHTML;
  iconContainer.innerHTML = isSuccess 
    ? '<span style="font-size: 11px; font-weight: bold; color: #34d399;">✓</span>' 
    : '<span style="font-size: 11px; font-weight: bold; color: #f87171;">✕</span>';
  setTimeout(() => { iconContainer.innerHTML = originalSvg; }, 1400);
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

// Centralized Clear Both Panes
if (btnClearAll) {
  btnClearAll.addEventListener('click', () => {
    diffInputLeft.value = '';
    diffInputRight.value = '';
    sessionStorage.removeItem('shared_json_left');
    localStorage.removeItem('shared_json_left');

    jsonSyncChannel.postMessage({
      type: 'UPDATE_JSON',
      payload: ''
    });

    diffInputLeft.scrollTop = 0;
    diffInputRight.scrollTop = 0;
    updatePositions('left', 0);
    updatePositions('right', 0);

    currentJumpIndex = -1;
    jumpDeltas = [];
    document.querySelectorAll('.jump-target').forEach(el => el.classList.remove('jump-target'));

    executeLineByLineDiff();
    showButtonFeedback(btnClearAll, true);
  });
}

window.addEventListener('resize', () => {
  executeLineByLineDiff();
});

// Initialization on clean load
diffInputLeft.value = '';
diffInputRight.value = '';
executeLineByLineDiff();

window.addEventListener('beforeunload', () => {
  jsonSyncChannel.close();
  themeSyncChannel.close();
});