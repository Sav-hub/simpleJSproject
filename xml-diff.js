
  // 1. Broadcast Channels Setup
  const xmlSyncChannel = new BroadcastChannel('xml_sync_channel');
  const themeSyncChannel = new BroadcastChannel('theme_sync_channel');

  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');

  function applyTheme(themeName, broadcast = false) {
    if (themeName === 'dark') {
      document.body.classList.add('dark-theme');
      themeIcon.textContent = '☀️';
      themeLabel.textContent = 'Grey Theme';
    } else {
      document.body.classList.remove('dark-theme');
      themeIcon.textContent = '🌙';
      themeLabel.textContent = 'Dark Theme';
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
    if (content.startsWith('<')) {
      localStorage.setItem('shared_xml_left', diffInputLeft.value);
    }
  });

  btnSyncScroll.addEventListener('click', () => {
    syncScrollEnabled = !syncScrollEnabled;
    btnSyncScroll.classList.toggle('active', syncScrollEnabled);
    syncScrollLabel.textContent = syncScrollEnabled ? 'Sync Scroll: ON' : 'Sync Scroll: OFF';
  });

  diffInputLeft.addEventListener('scroll', () => {
    diffLinesLeft.scrollTop = diffInputLeft.scrollTop;
    diffBackdropLeft.scrollTop = diffInputLeft.scrollTop;
    diffBackdropLeft.scrollLeft = diffInputLeft.scrollLeft;

    if (!syncScrollEnabled || isSyncingLeft) return;
    isSyncingRight = true;
    diffInputRight.scrollTop = diffInputLeft.scrollTop;
    diffInputRight.scrollLeft = diffInputLeft.scrollLeft;
    diffLinesRight.scrollTop = diffInputLeft.scrollTop;
    diffBackdropRight.scrollTop = diffInputLeft.scrollTop;
    diffBackdropRight.scrollLeft = diffInputLeft.scrollLeft;
    requestAnimationFrame(() => { isSyncingRight = false; });
  });

  diffInputRight.addEventListener('scroll', () => {
    diffLinesRight.scrollTop = diffInputRight.scrollTop;
    diffBackdropRight.scrollTop = diffInputRight.scrollTop;
    diffBackdropRight.scrollLeft = diffInputRight.scrollLeft;

    if (!syncScrollEnabled || isSyncingRight) return;
    isSyncingLeft = true;
    diffInputLeft.scrollTop = diffInputRight.scrollTop;
    diffInputLeft.scrollLeft = diffInputRight.scrollLeft;
    diffLinesLeft.scrollTop = diffInputRight.scrollTop;
    diffBackdropLeft.scrollTop = diffInputRight.scrollTop;
    diffBackdropLeft.scrollLeft = diffInputRight.scrollLeft;
    requestAnimationFrame(() => { isSyncingLeft = false; });
  });

  function handleLeftInput(broadcast = true) {
    localStorage.setItem('shared_xml_left', diffInputLeft.value);
    if (broadcast) {
      xmlSyncChannel.postMessage({
        type: 'UPDATE_XML',
        payload: diffInputLeft.value
      });
    }
    executeLineByLineDiff();
  }

  diffInputLeft.addEventListener('input', () => handleLeftInput(true));
  diffInputRight.addEventListener('input', executeLineByLineDiff);

  // Sync listener from xml-viewer.html
  xmlSyncChannel.onmessage = (e) => {
    if (e.data?.type === 'UPDATE_XML' && e.data.payload !== diffInputLeft.value) {
      diffInputLeft.value = e.data.payload;
      handleLeftInput(false);
    }
  };

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

    diffA.forEach((typeA, idxA) => {
      const lineA = linesA[idxA].trim();
      diffB.forEach((typeB, idxB) => {
        const lineB = linesB[idxB].trim();
        const tagA = (lineA.match(/^<([a-zA-Z0-9_\-]+)/) || [])[1];
        const tagB = (lineB.match(/^<([a-zA-Z0-9_\-]+)/) || [])[1];
        if (tagA && tagB && tagA === tagB) {
          diffA.set(idxA, 'MOD');
          diffB.set(idxB, 'MOD');
        }
      });
    });

    return { diffA, diffB };
  }

  function executeLineByLineDiff() {
    const rawA = diffInputLeft.value;
    const rawB = diffInputRight.value;
    const linesA = rawA.split('\n');
    const linesB = rawB.split('\n');

    const { diffA, diffB } = computeLineDiff(linesA, linesB);

    let countAdd = 0, countDel = 0, countMod = 0;

    let gutterHtmlA = '', backdropHtmlA = '';
    for (let i = 0; i < linesA.length; i++) {
      const type = diffA.get(i);
      let gutterClass = '', bgClass = '';

      if (type === 'DEL') {
        if (activeDiffFilter === 'ALL' || activeDiffFilter === 'DEL') {
          gutterClass = 'gutter-del'; bgClass = 'line-deleted';
        }
        countDel++;
      } else if (type === 'MOD') {
        if (activeDiffFilter === 'ALL' || activeDiffFilter === 'MOD') {
          gutterClass = 'gutter-mod'; bgClass = 'line-modified';
        }
        countMod++;
      }

      gutterHtmlA += `<div class="${gutterClass}">${i + 1}</div>`;
      backdropHtmlA += `<div class="diff-line-bg ${bgClass}"></div>`;
    }
    diffLinesLeft.innerHTML = gutterHtmlA;
    diffBackdropLeft.innerHTML = backdropHtmlA;

    let gutterHtmlB = '', backdropHtmlB = '';
    for (let j = 0; j < linesB.length; j++) {
      const type = diffB.get(j);
      let gutterClass = '', bgClass = '';

      if (type === 'ADD') {
        if (activeDiffFilter === 'ALL' || activeDiffFilter === 'ADD') {
          gutterClass = 'gutter-add'; bgClass = 'line-added';
        }
        countAdd++;
      } else if (type === 'MOD') {
        if (activeDiffFilter === 'ALL' || activeDiffFilter === 'MOD') {
          gutterClass = 'gutter-mod'; bgClass = 'line-modified';
        }
      }

      gutterHtmlB += `<div class="${gutterClass}">${j + 1}</div>`;
      backdropHtmlB += `<div class="diff-line-bg ${bgClass}"></div>`;
    }
    diffLinesRight.innerHTML = gutterHtmlB;
    diffBackdropRight.innerHTML = backdropHtmlB;

    filterBtnAdd.textContent = `+${countAdd} Added`;
    filterBtnDel.textContent = `-${countDel} Removed`;
    filterBtnMod.textContent = `~${countMod} Modified`;
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

  function formatXml(xml) {
    let formatted = '', indent = '';
    const tab = '  ';
    xml.split(/>\s*</).forEach(node => {
      if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
      formatted += indent + '<' + node + '>\r\n';
      if (node.match(/^<?\w[^>]*[^\/]$/)) indent += tab;
    });
    return formatted.substring(1, formatted.length - 3);
  }

  document.getElementById('btn-diff-swap').addEventListener('click', () => {
    const temp = diffInputLeft.value;
    diffInputLeft.value = diffInputRight.value;
    diffInputRight.value = temp;
    handleLeftInput(true);
  });

  document.getElementById('btn-diff-format-left').addEventListener('click', () => {
    diffInputLeft.value = formatXml(diffInputLeft.value);
    handleLeftInput(true);
  });

  document.getElementById('btn-diff-format-right').addEventListener('click', () => {
    diffInputRight.value = formatXml(diffInputRight.value);
    executeLineByLineDiff();
  });

  document.getElementById('btn-diff-clear-left').addEventListener('click', () => {
    diffInputLeft.value = '';
    handleLeftInput(true);
  });

  document.getElementById('btn-diff-clear-right').addEventListener('click', () => {
    diffInputRight.value = '';
    executeLineByLineDiff();
  });

  const sharedXml = localStorage.getItem('shared_xml_left');
  diffInputLeft.value = (sharedXml && sharedXml.trim().startsWith('<')) ? sharedXml : '';
  diffInputRight.value = '';
  executeLineByLineDiff();

  window.addEventListener('beforeunload', () => {
    xmlSyncChannel.close();
    themeSyncChannel.close();
  });