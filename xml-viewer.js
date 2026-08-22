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

  const xmlInput = document.getElementById('xml-input');
  const lineNumbers = document.getElementById('line-numbers');
  const rawBackdrop = document.getElementById('raw-backdrop');
  const treePane = document.getElementById('tree-pane');
  const appContainer = document.getElementById('app-container');
  const treeToggle = document.getElementById('tree-toggle');
  const viewerOutput = document.getElementById('viewer-output');
  const editorFooter = document.getElementById('editor-footer');
  const btnCloseTree = document.getElementById('btn-close-tree');
  const navToDiff = document.getElementById('nav-to-diff');

  const rawSearchInput = document.getElementById('raw-search-input');
  const rawSearchCount = document.getElementById('raw-search-count');
  const rawSearchPrev = document.getElementById('raw-search-prev');
  const rawSearchNext = document.getElementById('raw-search-next');
  let rawSearchIndices = [];
  let currentRawMatchIndex = -1;

  const treeSearchInput = document.getElementById('tree-search-input');
  const treeSearchCount = document.getElementById('tree-search-count');
  const treeSearchPrev = document.getElementById('tree-search-prev');
  const treeSearchNext = document.getElementById('tree-search-next');
  let treeMatches = [];
  let currentTreeMatchIndex = -1;

  let errorLinesSet = new Set();

  navToDiff.addEventListener('click', () => {
    localStorage.setItem('shared_xml_left', xmlInput.value);
  });

  function updateLineNumbers() {
    const lines = xmlInput.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= lines; i++) {
      const isErr = errorLinesSet.has(i);
      html += `<div class="${isErr ? 'error-line' : ''}" data-line="${i}">${i}</div>`;
    }
    lineNumbers.innerHTML = html;
  }

  function handleEditorChange(broadcast = true) {
    validateAndProcess();
    applyRawSearch();
    localStorage.setItem('shared_xml_left', xmlInput.value);

    if (broadcast) {
      xmlSyncChannel.postMessage({
        type: 'UPDATE_XML',
        payload: xmlInput.value
      });
    }
  }

  xmlInput.addEventListener('input', () => handleEditorChange(true));

  // Receive live updates from xml-diff.html or other tabs
  xmlSyncChannel.onmessage = (e) => {
    if (e.data?.type === 'UPDATE_XML' && e.data.payload !== xmlInput.value) {
      xmlInput.value = e.data.payload;
      handleEditorChange(false);
    }
  };

  xmlInput.addEventListener('scroll', () => {
    lineNumbers.scrollTop = xmlInput.scrollTop;
    rawBackdrop.scrollTop = xmlInput.scrollTop;
    rawBackdrop.scrollLeft = xmlInput.scrollLeft;
  });

  function setTreeViewVisibility(show) {
    treeToggle.checked = show;
    if (show) {
      treePane.style.display = 'flex';
      appContainer.classList.remove('single-pane');
      validateAndProcess();
      applyTreeSearch();
    } else {
      treePane.style.display = 'none';
      appContainer.classList.add('single-pane');
    }
  }

  treeToggle.addEventListener('change', (e) => setTreeViewVisibility(e.target.checked));
  btnCloseTree.addEventListener('click', () => setTreeViewVisibility(false));

  function escapeXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildXmlTreeNode(xmlNode) {
    if (xmlNode.nodeType === Node.DOCUMENT_NODE) {
      return buildXmlTreeNode(xmlNode.documentElement);
    }

    if (xmlNode.nodeType === Node.COMMENT_NODE) {
      const container = document.createElement('div');
      container.className = 'tree-item';
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.innerHTML = `<span style="color:#64748b; font-style:italic;" data-search-target="true">&lt;!-- ${escapeXml(xmlNode.nodeValue)} --&gt;</span>`;
      container.appendChild(row);
      return container;
    }

    if (xmlNode.nodeType === Node.TEXT_NODE) {
      const textVal = xmlNode.nodeValue.trim();
      if (!textVal) return document.createDocumentFragment();
      const container = document.createElement('div');
      container.className = 'tree-item';
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.innerHTML = `<span class="xml-val" data-search-target="true">${escapeXml(textVal)}</span>`;
      container.appendChild(row);
      return container;
    }

    if (xmlNode.nodeType === Node.ELEMENT_NODE) {
      const container = document.createElement('div');
      container.className = 'tree-item';

      const tagName = xmlNode.nodeName;
      let attrString = '';
      if (xmlNode.attributes && xmlNode.attributes.length > 0) {
        for (let i = 0; i < xmlNode.attributes.length; i++) {
          const attr = xmlNode.attributes[i];
          attrString += ` <span class="xml-a" data-search-target="true">${escapeXml(attr.name)}</span>=<span class="xml-v" data-search-target="true">"${escapeXml(attr.value)}"</span>`;
        }
      }

      const childNodes = Array.from(xmlNode.childNodes).filter(n => {
        if (n.nodeType === Node.TEXT_NODE) return n.nodeValue.trim().length > 0;
        return n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.COMMENT_NODE;
      });

      // Self-closing element
      if (childNodes.length === 0) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.innerHTML = `<span class="xml-b">&lt;</span><span class="xml-t" data-search-target="true">${escapeXml(tagName)}</span>${attrString}<span class="xml-b"> /&gt;</span>`;
        container.appendChild(row);
        return container;
      }

      // Single simple inline text node
      if (childNodes.length === 1 && childNodes[0].nodeType === Node.TEXT_NODE) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        const textVal = escapeXml(childNodes[0].nodeValue.trim());
        row.innerHTML = `
          <span class="xml-b">&lt;</span><span class="xml-t" data-search-target="true">${escapeXml(tagName)}</span>${attrString}<span class="xml-b">&gt;</span>
          <span class="xml-val" data-search-target="true">${textVal}</span>
          <span class="xml-b">&lt;/</span><span class="xml-t" data-search-target="true">${escapeXml(tagName)}</span><span class="xml-b">&gt;</span>
        `;
        container.appendChild(row);
        return container;
      }

      const row = document.createElement('div');
      row.className = 'tree-row';

      const caret = document.createElement('span');
      caret.className = 'caret-btn';
      caret.textContent = '▼';

      row.innerHTML = `<span class="xml-b">&lt;</span><span class="xml-t" data-search-target="true">${escapeXml(tagName)}</span>${attrString}<span class="xml-b">&gt;</span>`;
      row.prepend(caret);

      const summaryBadge = document.createElement('span');
      summaryBadge.className = 'badge-summary';
      summaryBadge.textContent = `${childNodes.length} nodes &lt;/${tagName}&gt;`;
      row.appendChild(summaryBadge);

      const toggleCollapse = (e) => {
        e.stopPropagation();
        container.classList.toggle('collapsed');
      };
      caret.addEventListener('click', toggleCollapse);
      summaryBadge.addEventListener('click', toggleCollapse);

      const childrenWrapper = document.createElement('div');
      childrenWrapper.className = 'tree-children';

      childNodes.forEach(child => {
        const renderedChild = buildXmlTreeNode(child);
        if (renderedChild) childrenWrapper.appendChild(renderedChild);
      });

      const closingRow = document.createElement('div');
      closingRow.className = 'tree-row';
      closingRow.innerHTML = `<span class="xml-b">&lt;/</span><span class="xml-t" data-search-target="true">${escapeXml(tagName)}</span><span class="xml-b">&gt;</span>`;

      container.appendChild(row);
      container.appendChild(childrenWrapper);
      container.appendChild(closingRow);
      return container;
    }

    return document.createDocumentFragment();
  }

  function validateAndProcess() {
    const raw = xmlInput.value;
    if (!raw.trim()) {
      errorLinesSet.clear();
      updateLineNumbers();
      editorFooter.className = 'editor-footer';
      editorFooter.innerHTML = '<span style="color: var(--text-muted);">Status: Ready (Empty document)</span>';
      viewerOutput.innerHTML = '<span style="color: var(--text-muted);">No XML data to display.</span>';
      return;
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(raw, "application/xml");
    const parseError = xmlDoc.querySelector("parsererror");

    if (parseError) {
      errorLinesSet = new Set([1]);
      updateLineNumbers();
      editorFooter.className = 'editor-footer has-error';
      editorFooter.innerHTML = `<div class="error-item"><span class="error-tag">XML Error</span><span class="error-msg">${escapeXml(parseError.textContent.slice(0, 180))}...</span></div>`;
      if (treeToggle.checked) {
        viewerOutput.innerHTML = `<div style="color: #f87171; padding: 12px; border: 1px solid var(--error-border);">Invalid XML. Fix syntax errors above to render tree.</div>`;
      }
    } else {
      errorLinesSet.clear();
      updateLineNumbers();
      editorFooter.className = 'editor-footer';
      editorFooter.innerHTML = `<span style="color: var(--xml-text); font-weight: 600;">✓ Valid XML</span>`;
      if (treeToggle.checked) {
        viewerOutput.innerHTML = '';
        viewerOutput.appendChild(buildXmlTreeNode(xmlDoc.documentElement));
        applyTreeSearch();
      }
    }
  }

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

  function applyRawSearch() {
    const query = rawSearchInput.value;
    const text = xmlInput.value;
    rawSearchIndices = [];
    currentRawMatchIndex = -1;

    if (!query) {
      rawBackdrop.innerHTML = '';
      rawSearchCount.textContent = '0/0';
      return;
    }

    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      rawSearchIndices.push({ start: match.index, end: match.index + match[0].length });
    }

    if (rawSearchIndices.length > 0) {
      currentRawMatchIndex = 0;
      updateRawHighlights();
    } else {
      rawBackdrop.innerHTML = escapeXml(text);
      rawSearchCount.textContent = '0/0';
    }
  }

  function updateRawHighlights() {
    const text = xmlInput.value;
    if (rawSearchIndices.length === 0) {
      rawBackdrop.innerHTML = '';
      rawSearchCount.textContent = '0/0';
      rawBackdrop.scrollTop = (typeof jsonInput !== 'undefined' ? jsonInput : xmlInput).scrollTop;
      rawBackdrop.scrollLeft = (typeof jsonInput !== 'undefined' ? jsonInput : xmlInput).scrollLeft;
      return;
    }

    let html = '';
    let lastIndex = 0;

    rawSearchIndices.forEach((pos, idx) => {
      html += escapeXml(text.substring(lastIndex, pos.start));
      const matchText = escapeXml(text.substring(pos.start, pos.end));
      const isActive = idx === currentRawMatchIndex;
      html += `<mark class="highlight ${isActive ? 'active-match' : ''}">${matchText}</mark>`;
      lastIndex = pos.end;
    });
    html += escapeXml(text.substring(lastIndex));
    rawBackdrop.innerHTML = html;
    rawSearchCount.textContent = `${currentRawMatchIndex + 1}/${rawSearchIndices.length}`;

    if (currentRawMatchIndex >= 0) {
      const active = rawSearchIndices[currentRawMatchIndex];
      const lineNumber = text.substring(0, active.start).split('\n').length;
      xmlInput.scrollTop = Math.max(0, (lineNumber - 4) * 19.5);
      lineNumbers.scrollTop = xmlInput.scrollTop;
      rawBackdrop.scrollTop = xmlInput.scrollTop;
    }
  }

  function navigateRawSearch(direction) {
    if (rawSearchIndices.length === 0) return;
    currentRawMatchIndex = (currentRawMatchIndex + direction + rawSearchIndices.length) % rawSearchIndices.length;
    updateRawHighlights();
  }

  rawSearchInput.addEventListener('input', applyRawSearch);
  rawSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateRawSearch(e.shiftKey ? -1 : 1);
    }
  });
  rawSearchNext.addEventListener('click', () => navigateRawSearch(1));
  rawSearchPrev.addEventListener('click', () => navigateRawSearch(-1));

  // 1. Cleans existing highlights without destroying DOM elements/listeners
function removeTreeHighlights(container) {
  const marks = container.querySelectorAll('mark.highlight');
  marks.forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

// 2. Safely highlights only raw text nodes inside [data-search-target="true"]
function highlightTextNodes(element, query) {
  if (!query) return;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQuery, 'gi');
  const targets = element.querySelectorAll('[data-search-target="true"]');

  targets.forEach(target => {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
      const val = node.nodeValue;
      if (!regex.test(val)) return;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      val.replace(regex, (match, offset) => {
        if (offset > lastIdx) {
          frag.appendChild(document.createTextNode(val.slice(lastIdx, offset)));
        }
        const mark = document.createElement('mark');
        mark.className = 'highlight';
        mark.textContent = match;
        frag.appendChild(mark);
        lastIdx = offset + match.length;
      });

      if (lastIdx < val.length) {
        frag.appendChild(document.createTextNode(val.slice(lastIdx)));
      }
      node.parentNode.replaceChild(frag, node);

      // Auto-expand all collapsed parent levels to reveal matched result
      let parent = target.closest('.tree-item.collapsed');
      while (parent) {
        parent.classList.remove('collapsed');
        parent = parent.parentElement ? parent.parentElement.closest('.tree-item.collapsed') : null;
      }
    });
  });
}

// 3. New applyTreeSearch function using the safe highlighting logic
function applyTreeSearch() {
  if (!treeToggle.checked) return;
  removeTreeHighlights(viewerOutput);

  const query = treeSearchInput.value.trim();
  treeMatches = [];
  currentTreeMatchIndex = -1;

  if (!query) {
    treeSearchCount.textContent = '0/0';
    return;
  }

  highlightTextNodes(viewerOutput, query);
  treeMatches = Array.from(viewerOutput.querySelectorAll('mark.highlight'));

  if (treeMatches.length > 0) {
    currentTreeMatchIndex = 0;
    updateActiveTreeMatch();
  } else {
    treeSearchCount.textContent = '0/0';
  }
}

  function updateActiveTreeMatch() {
    if (treeMatches.length === 0) {
      treeSearchCount.textContent = '0/0';
      return;
    }
    treeMatches.forEach((el, i) => {
      if (i === currentTreeMatchIndex) {
        el.classList.add('active-match');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        el.classList.remove('active-match');
      }
    });
    treeSearchCount.textContent = `${currentTreeMatchIndex + 1}/${treeMatches.length}`;
  }

  function navigateTreeSearch(direction) {
    if (treeMatches.length === 0) return;
    currentTreeMatchIndex = (currentTreeMatchIndex + direction + treeMatches.length) % treeMatches.length;
    updateActiveTreeMatch();
  }

  treeSearchInput.addEventListener('input', () => {
    if (treeToggle.checked) validateAndProcess();
  });

  treeSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateTreeSearch(e.shiftKey ? -1 : 1);
    }
  });

  treeSearchNext.addEventListener('click', () => navigateTreeSearch(1));
  treeSearchPrev.addEventListener('click', () => navigateTreeSearch(-1));

  document.getElementById('btn-format').addEventListener('click', () => {
    xmlInput.value = formatXml(xmlInput.value);
    handleEditorChange(true);
  });

  document.getElementById('btn-minify').addEventListener('click', () => {
    xmlInput.value = xmlInput.value.replace(/>\s+</g, '><').trim();
    handleEditorChange(true);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    xmlInput.value = '';
    rawSearchInput.value = '';
    treeSearchInput.value = '';
    rawSearchCount.textContent = '0/0';
    treeSearchCount.textContent = '0/0';
    handleEditorChange(true);
  });

  document.getElementById('btn-expand-all').addEventListener('click', () => {
    document.querySelectorAll('#viewer-output .tree-item.collapsed').forEach(el => el.classList.remove('collapsed'));
  });

  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    document.querySelectorAll('#viewer-output .tree-item').forEach(el => {
      if (el.querySelector('.tree-children')) el.classList.add('collapsed');
    });
  });

  const savedXml = localStorage.getItem('shared_xml_left');
  xmlInput.value = (savedXml && savedXml.trim().startsWith('<')) ? savedXml : '';

  updateLineNumbers();
  validateAndProcess();

  window.addEventListener('beforeunload', () => {
    xmlSyncChannel.close();
    themeSyncChannel.close();
  });