// Malformed JSON Edge Cases Test Fixtures
  const testFixtures = {
    'missing-comma': '{\n  "id": 101\n  "title": "Missing comma between keys"\n}',
    'trailing-comma': '{\n  "tags": [\n    "javascript",\n    "json",\n  ]\n}',
    'single-quotes': '{\n  \'service\': \'auth_provider\',\n  "active": true\n}',
    'missing-colon': '{\n  "database" { "host": "localhost", "port": 5432 }\n}',
    'unquoted-key': '{\n  connection_timeout: 3000,\n  "retries": 3\n}',
    'invalid-number': '{\n  "leading_zero": 0123,\n  "trailing_dot": 45.\n}',
    'comments-js': '{\n  // Single line comment\n  "status": undefined,\n  /* Multi-line\n     comment */\n  "valid_key": null\n}',
    'mismatched-brackets': '{\n  "items": [\n    {"id": 1},\n    {"id": 2}\n  }\n}',
    'unclosed-string': '{\n  "bio": "Software architect and engineer\n  based in London",\n  "active": true\n}',
    'trailing-garbage': '{\n  "status": 200\n}\n{\n  "extra_root": "invalid"\n}'
  };

  const textarea = document.getElementById('json-textarea');
  const editorLayer = document.getElementById('editor-layer');
  const gutter = document.getElementById('gutter');
  const gutterContent = document.getElementById('gutter-content');
  const viewport = document.getElementById('viewport');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const activeFilenameEl = document.getElementById('active-filename');
  const fileInput = document.getElementById('file-input');
  const dropOverlay = document.getElementById('drop-overlay');

  // Diagnostics DOM
  const diagnosticBadge = document.getElementById('diagnostic-badge');
  const diagnosticText = document.getElementById('diagnostic-text');
  const diagnosticsDrawer = document.getElementById('diagnostics-drawer');
  const diagTypeText = document.getElementById('diag-type-text');
  const diagExplanation = document.getElementById('diag-explanation');
  const diagSnippet = document.getElementById('diag-snippet');
  const diagSuggestion = document.getElementById('diag-suggestion');
  const btnDiagAutoFix = document.getElementById('btn-diag-autofix');
  const btnCloseDiag = document.getElementById('btn-close-diag');

  // Telemetry DOM
  const telCursor = document.getElementById('tel-cursor');
  const telSelection = document.getElementById('tel-selection');
  const telSelCount = document.getElementById('tel-sel-count');
  const telLines = document.getElementById('tel-lines');
  const telSize = document.getElementById('tel-size');
  const telKeys = document.getElementById('tel-keys');

  // Inline Search Capsule DOM
  const inlineSearchCapsule = document.getElementById('inline-search-capsule');
  const searchInput = document.getElementById('search-input');
  const replaceInput = document.getElementById('replace-input');
  const searchCount = document.getElementById('search-count');
  const toggleCaseBtn = document.getElementById('toggle-case');
  const toggleRegexBtn = document.getElementById('toggle-regex');
  const btnToggleFind = document.getElementById('btn-toggle-find');
  const btnCloseFind = document.getElementById('btn-close-find');

  // Dropdowns DOM
  const btnToolsDropdown = document.getElementById('btn-tools-dropdown');
  const toolsMenu = document.getElementById('tools-menu');
  const btnTestsDropdown = document.getElementById('btn-tests-dropdown');
  const testsMenu = document.getElementById('tests-menu');

  let activeFilename = "sample.json";
  let foldedBlocks = new Map();
  let searchMatches = [];
  let rawSearchMatches = [];
  let currentSearchIdx = -1;
  let errorLine = null;
  let currentDiagnostic = null;
  let dragCounter = 0;

  let isCaseSensitive = false;
  let isRegex = false;

  // 1. Theme Configuration
  function applyTheme(isDark) {
    document.body.classList.toggle('dark-theme', isDark);
    document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
    document.getElementById('theme-label').textContent = isDark ? 'Grey Theme' : 'Dark Theme';
    localStorage.setItem('json_theme', isDark ? 'dark' : 'grey');
  }
  themeToggleBtn.addEventListener('click', () => {
    applyTheme(!document.body.classList.contains('dark-theme'));
  });
  applyTheme(localStorage.getItem('json_theme') === 'dark');

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setEditorValue(newVal, newFilename = null) {
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
    textarea.setRangeText(newVal, 0, textarea.value.length, 'end');
    if (newFilename) {
      activeFilename = newFilename;
      activeFilenameEl.textContent = `(${newFilename})`;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // 2. Token-Level Recursive-Descent JSON Diagnostic Linter (100% Deterministic)
  function getLineColAndSnippet(text, index) {
    const safeIdx = Math.max(0, Math.min(index, text.length));
    const lines = text.split('\n');
    let runningLength = 0;
    let targetLine = 1;
    let targetCol = 1;

    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length + 1;
      if (safeIdx < runningLength + lineLen) {
        targetLine = i + 1;
        targetCol = safeIdx - runningLength + 1;
        break;
      }
      runningLength += lineLen;
    }

    const prevLine = targetLine > 1 ? `Line ${(targetLine - 1).toString().padStart(2, ' ')} | ${lines[targetLine - 2]}\n` : '';
    const curLine = `Line ${targetLine.toString().padStart(2, ' ')} | ${lines[targetLine - 1] || ''}`;
    const pointerIndent = ' '.repeat(`Line ${targetLine.toString().padStart(2, ' ')} | `.length + Math.max(0, targetCol - 1));
    const pointerLine = `\n${pointerIndent}^`;
    const nextLine = targetLine < lines.length ? `\nLine ${(targetLine + 1).toString().padStart(2, ' ')} | ${lines[targetLine]}` : '';

    return {
      line: targetLine,
      col: targetCol,
      snippet: prevLine + curLine + pointerLine + nextLine
    };
  }

  function analyzeJSONDiagnostics(source) {
    if (!source || !source.trim()) return null;
    const text = source.replace(/\u00A0/g, ' ');
    const len = text.length;
    let pos = 0;

    function peek(offset = 0) {
      return pos + offset < len ? text[pos + offset] : '';
    }

    function createError(type, message, suggestion = '', autoFixable = false, errPos = pos) {
      const info = getLineColAndSnippet(text, errPos);
      return {
        success: false,
        type,
        message,
        line: info.line,
        col: info.col,
        snippet: info.snippet,
        suggestion,
        autoFixable
      };
    }

    function skipWhitespace() {
      while (pos < len) {
        const ch = text[pos];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          pos++;
        } else if (ch === '/' && peek(1) === '/') {
          return createError(
            "Comments Not Allowed",
            "Single-line comments (//) are not supported in standard JSON (RFC 8259).",
            "Remove the comment line."
          );
        } else if (ch === '/' && peek(1) === '*') {
          return createError(
            "Comments Not Allowed",
            "Block comments (/* */) are not supported in standard JSON (RFC 8259).",
            "Remove the block comment."
          );
        } else {
          break;
        }
      }
      return null;
    }

    function parseString() {
      const startPos = pos;
      const quoteChar = text[pos];

      if (quoteChar === "'") {
        pos++;
        while (pos < len && text[pos] !== "'") {
          if (text[pos] === '\\') pos++;
          pos++;
        }
        if (pos < len) pos++; // consume closing single quote
        return createError(
          "Single Quotes Used",
          "Property keys and string values must be enclosed in double quotes (\"). Single quotes (') are invalid in JSON.",
          "Replace single quotes (') with double quotes (\").",
          true,
          startPos
        );
      }

      if (quoteChar !== '"') return null;
      pos++; // consume opening quote

      while (pos < len) {
        const ch = text[pos];
        if (ch === '\n' || ch === '\r') {
          return createError(
            "Unterminated String Literal",
            "Unescaped newline found inside string literal before closing quote.",
            "Add a closing double quote (\") or escape the newline with \\n.",
            false,
            startPos
          );
        }
        if (ch === '\\') {
          pos++;
          if (pos >= len) break;
          const esc = text[pos];
          if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(esc)) {
            return createError(
              "Invalid Escape Sequence",
              `Invalid escape character \\${esc} inside string literal.`,
              "Valid escape sequences are \\\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t, and \\uXXXX."
            );
          }
          if (esc === 'u') {
            for (let h = 1; h <= 4; h++) {
              if (pos + h >= len || !/[0-9a-fA-F]/.test(text[pos + h])) {
                return createError(
                  "Invalid Unicode Escape",
                  "\\u escape sequence must be followed by exactly 4 hexadecimal digits.",
                  "Provide 4 valid hex characters, e.g. \\u0020."
                );
              }
            }
            pos += 4;
          }
        } else if (ch === '"') {
          pos++;
          return { ok: true };
        }
        pos++;
      }

      return createError(
        "Unclosed String Literal",
        "String was opened with double quotes (\") but never closed.",
        "Add a closing double quote (\") before end-of-file.",
        false,
        startPos
      );
    }

    function parseNumber() {
      const startPos = pos;
      if (text[pos] === '+') {
        return createError(
          "Invalid Number Format",
          "Explicit plus sign (+) is not permitted in JSON numbers.",
          "Remove the leading plus sign (+).",
          false,
          startPos
        );
      }

      let numStr = '';
      if (text[pos] === '-') {
        numStr += text[pos++];
      }

      if (text[pos] === '0') {
        numStr += text[pos++];
        if (pos < len && /[0-9]/.test(text[pos])) {
          return createError(
            "Leading Zero in Number",
            "Numbers with leading zeros (e.g. 0123) are not permitted in JSON.",
            "Remove the extraneous leading zero.",
            false,
            startPos
          );
        }
      } else if (/[1-9]/.test(text[pos])) {
        while (pos < len && /[0-9]/.test(text[pos])) {
          numStr += text[pos++];
        }
      } else if (text[pos] === '.') {
        return createError(
          "Invalid Decimal Number",
          "Numbers cannot start directly with a decimal point (.5).",
          "Add a leading zero: 0.5.",
          false,
          startPos
        );
      } else {
        return null;
      }

      if (pos < len && text[pos] === '.') {
        numStr += text[pos++];
        if (pos >= len || !/[0-9]/.test(text[pos])) {
          return createError(
            "Incomplete Decimal Point",
            "A decimal point (.) must be followed by at least one digit.",
            "Add digits after the decimal point (e.g., 4.0).",
            false,
            pos - 1
          );
        }
        while (pos < len && /[0-9]/.test(text[pos])) {
          numStr += text[pos++];
        }
      }

      if (pos < len && (text[pos] === 'e' || text[pos] === 'E')) {
        numStr += text[pos++];
        if (pos < len && (text[pos] === '+' || text[pos] === '-')) {
          numStr += text[pos++];
        }
        if (pos >= len || !/[0-9]/.test(text[pos])) {
          return createError(
            "Incomplete Exponent",
            "Exponent indicator (e/E) must be followed by one or more digits.",
            "Provide integer digits after the exponent."
          );
        }
        while (pos < len && /[0-9]/.test(text[pos])) {
          numStr += text[pos++];
        }
      }

      return { ok: true, val: parseFloat(numStr) };
    }

    function parseValue() {
      const err = skipWhitespace();
      if (err) return err;

      if (pos >= len) {
        return createError("Unexpected End of Input", "Expected a JSON value but reached end of file.");
      }

      const ch = text[pos];

      // A. Object
      if (ch === '{') return parseObject();
      // B. Array
      if (ch === '[') return parseArray();
      // C. String or Single-quote String
      if (ch === '"' || ch === "'") return parseString();
      // D. Number
      if (ch === '-' || ch === '+' || ch === '.' || /[0-9]/.test(ch)) {
        const numRes = parseNumber();
        if (numRes) return numRes;
      }
      // E. Literals
      if (text.startsWith('true', pos)) { pos += 4; return { ok: true }; }
      if (text.startsWith('false', pos)) { pos += 5; return { ok: true }; }
      if (text.startsWith('null', pos)) { pos += 4; return { ok: true }; }

      // F. Disallowed JS Literals & Identifiers
      const wordMatch = text.slice(pos).match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (wordMatch) {
        const word = wordMatch[1];
        if (word === 'undefined' || word === 'NaN' || word === 'Infinity') {
          return createError(
            "Invalid JavaScript Keyword",
            `\`${word}\` is a JavaScript token, not a valid JSON literal.`,
            `Replace \`${word}\` with \`null\` or a quoted string.`,
            false,
            pos
          );
        }
        return createError(
          "Unquoted Key or Identifier",
          `Unexpected identifier \`${word}\`. In JSON, all keys and strings must be double-quoted.`,
          `Wrap \`${word}\` in double quotes: \`"${word}"\`.`,
          true,
          pos
        );
      }

      return createError("Unexpected Token", `Unexpected character \`${ch}\` found.`, "Check for syntax errors.");
    }

    function parseObject() {
      const openPos = pos;
      pos++; // consume '{'

      let isFirst = true;

      while (pos < len) {
        let err = skipWhitespace();
        if (err) return err;

        if (pos >= len) {
          return createError("Unclosed Object", "Opening '{' was never closed before reaching end-of-file.", "Add a closing '}' at the end of the object.", false, openPos);
        }

        if (text[pos] === '}') {
          pos++;
          return { ok: true };
        }

        if (text[pos] === ',') {
          pos++;
          err = skipWhitespace();
          if (err) return err;
          if (text[pos] === '}') {
            return createError(
              "Trailing Comma Detected",
              "A trailing comma was found preceding closing delimiter '}'.",
              "Remove the extraneous trailing comma.",
              true,
              pos - 1
            );
          }
        } else if (!isFirst) {
          return createError(
            "Missing Comma",
            "Expected a comma (,) or closing brace (}) between object properties.",
            "Add a comma (,) to separate the properties.",
            false,
            pos
          );
        }

        isFirst = false;

        err = skipWhitespace();
        if (err) return err;

        // Key Expectation
        if (text[pos] === '}') {
          pos++;
          return { ok: true };
        }

        const keyStartPos = pos;
        if (text[pos] === '"' || text[pos] === "'") {
          const strRes = parseString();
          if (strRes && !strRes.ok) return strRes;
        } else if (/[a-zA-Z_$]/.test(text[pos])) {
          const idMatch = text.slice(pos).match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
          const idName = idMatch ? idMatch[1] : '';
          pos += idName.length;
          return createError(
            "Unquoted Property Key",
            `Property key \`${idName}\` is not wrapped in double quotes.`,
            `Wrap \`${idName}\` in double quotes: \`"${idName}":\`.`,
            true,
            keyStartPos
          );
        } else {
          return createError("Expected Property Name", `Expected double-quoted string key, found \`${text[pos]}\`.`, "Keys must be enclosed in double quotes.");
        }

        // Colon Expectation
        err = skipWhitespace();
        if (err) return err;

        if (text[pos] !== ':') {
          return createError(
            "Missing Colon",
            "Expected a colon (:) after property name.",
            "Insert a colon (:) between key and value.",
            false,
            pos
          );
        }
        pos++; // consume ':'

        // Value
        const valRes = parseValue();
        if (valRes && !valRes.ok) return valRes;
      }

      return createError("Unclosed Object", "Opening '{' was never closed.", "Add a closing '}'.", false, openPos);
    }

    function parseArray() {
      const openPos = pos;
      pos++; // consume '['

      let isFirst = true;

      while (pos < len) {
        let err = skipWhitespace();
        if (err) return err;

        if (pos >= len) {
          return createError("Unclosed Array", "Opening '[' was never closed before reaching end-of-file.", "Add a closing ']' at the end of the array.", false, openPos);
        }

        if (text[pos] === ']') {
          pos++;
          return { ok: true };
        }

        if (text[pos] === '}') {
          return createError(
            "Mismatched Delimiter Pair",
            "Found '}' attempting to close an Array opened with '['.",
            "Replace '}' with ']'.",
            false,
            pos
          );
        }

        if (text[pos] === ',') {
          pos++;
          err = skipWhitespace();
          if (err) return err;
          if (text[pos] === ']') {
            return createError(
              "Trailing Comma Detected",
              "A trailing comma was found preceding closing bracket ']'.",
              "Remove the extraneous trailing comma.",
              true,
              pos - 1
            );
          }
        } else if (!isFirst) {
          return createError(
            "Missing Comma",
            "Expected a comma (,) or closing bracket (]) between array items.",
            "Add a comma (,) to separate the array elements.",
            false,
            pos
          );
        }

        isFirst = false;

        err = skipWhitespace();
        if (err) return err;

        if (text[pos] === ']') {
          pos++;
          return { ok: true };
        }

        const valRes = parseValue();
        if (valRes && !valRes.ok) return valRes;
      }

      return createError("Unclosed Array", "Opening '[' was never closed.", "Add a closing ']'.", false, openPos);
    }

    // Top-Level Execution
    const rootRes = parseValue();
    if (rootRes && !rootRes.ok) return rootRes;

    const trailingErr = skipWhitespace();
    if (trailingErr) return trailingErr;

    if (pos < len) {
      return createError(
        "Trailing Root Content",
        `Unexpected content \`${text.slice(pos, pos + 10)}...\` found after top-level JSON value. JSON documents must contain exactly one root object or array.`,
        "Remove extra root objects or wrap elements in an outer array.",
        false,
        pos
      );
    }

    try {
      return { success: true, data: JSON.parse(text) };
    } catch {
      return { success: true, data: {} };
    }
  }

  // 3. String-Aware Active Bracket Finder
  function findActiveBracketPair(text, cursorPos) {
    // Only evaluate bracket matching when the textarea is actively focused
    if (document.activeElement !== textarea) return null;
    if (cursorPos < 0 || cursorPos > text.length || text.length === 0) return null;

    const brackets = ['{', '}', '[', ']'];
    let targetPos = -1;

    if (cursorPos > 0 && brackets.includes(text[cursorPos - 1])) {
      targetPos = cursorPos - 1;
    } else if (cursorPos < text.length && brackets.includes(text[cursorPos])) {
      targetPos = cursorPos;
    }

    if (targetPos === -1) return null;

    const stack = [];
    const pairs = new Map();
    let inStr = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        let slashes = 0;
        for (let b = i - 1; b >= 0 && text[b] === '\\'; b--) slashes++;
        if (slashes % 2 === 0) inStr = !inStr;
      }
      if (!inStr) {
        if (ch === '{' || ch === '[') {
          stack.push({ char: ch, pos: i });
        } else if (ch === '}' || ch === ']') {
          if (stack.length > 0) {
            const top = stack[stack.length - 1];
            if ((ch === '}' && top.char === '{') || (ch === ']' && top.char === '[')) {
              stack.pop();
              pairs.set(top.pos, i);
              pairs.set(i, top.pos);
            }
          }
        }
      }
    }

    if (pairs.has(targetPos)) {
      return { from: targetPos, to: pairs.get(targetPos) };
    }
    return null;
  }

  // 4. String-Aware Lexer & Block Folding Range Scanner
  function parseEditorLines(rawText) {
    const lines = rawText.split('\n');
    const lineStructures = [];
    const stack = [];
    const foldRanges = [];
    const activePair = findActiveBracketPair(rawText, textarea.selectionStart);

    let charAccumulator = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let inStr = false;

      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '"') {
          let slashes = 0;
          for (let b = c - 1; b >= 0 && line[b] === '\\'; b--) slashes++;
          if (slashes % 2 === 0) inStr = !inStr;
        }
        if (!inStr) {
          if (char === '{' || char === '[') {
            stack.push({ line: i, char });
          } else if (char === '}' || char === ']') {
            if (stack.length > 0) {
              const top = stack[stack.length - 1];
              if ((char === '}' && top.char === '{') || (char === ']' && top.char === '[')) {
                const start = stack.pop();
                if (start.line !== i) {
                  foldRanges.push({ start: start.line, end: i, type: start.char === '{' ? 'Object' : 'Array' });
                }
              }
            }
          }
        }
      }

      const tokenRegex = /("(?:[^"\\]|\\.)*"(?:\s*:)?|"(?:[^"\\]|\\.)*$|\b(?:true|false|null)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:])/g;
      let formattedHtml = '';
      let lastIndex = 0;
      let match;

      while ((match = tokenRegex.exec(line)) !== null) {
        const token = match[0];
        const tokenOffset = charAccumulator + match.index;
        formattedHtml += escapeHtml(line.substring(lastIndex, match.index));

        if (token.startsWith('"') && token.endsWith(':')) {
          const colonIdx = token.lastIndexOf(':');
          const keyPart = token.slice(0, colonIdx);
          formattedHtml += `<span class="key">${escapeHtml(keyPart)}</span><span class="colon">:</span>`;
        } else if (token.startsWith('"')) {
          formattedHtml += `<span class="str">${escapeHtml(token)}</span>`;
        } else if (token === 'true' || token === 'false') {
          formattedHtml += `<span class="bool">${token}</span>`;
        } else if (token === 'null') {
          formattedHtml += `<span class="null">${token}</span>`;
        } else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
          formattedHtml += `<span class="num">${token}</span>`;
        } else if (token === '{' || token === '}' || token === '[' || token === ']') {
          const isMatched = activePair && (tokenOffset === activePair.from || tokenOffset === activePair.to);
          formattedHtml += `<span class="bracket ${isMatched ? 'bracket-match' : ''}">${escapeHtml(token)}</span>`;
        } else if (token === ':') {
          formattedHtml += `<span class="colon">:</span>`;
        } else if (token === ',') {
          formattedHtml += `<span class="comma">,</span>`;
        } else {
          formattedHtml += escapeHtml(token);
        }
        lastIndex = tokenRegex.lastIndex;
      }
      formattedHtml += escapeHtml(line.substring(lastIndex));

      lineStructures.push({ raw: line, html: formattedHtml || '&nbsp;' });
      charAccumulator += line.length + 1;
    }

    return { lineStructures, foldRanges };
  }

  // 5. Validation Engine
  function validate() {
    const diag = analyzeJSONDiagnostics(textarea.value);
    currentDiagnostic = diag;

    if (!diag || diag.success) {
      errorLine = null;
      diagnosticBadge.className = 'diagnostic-badge valid';
      diagnosticText.textContent = !diag ? 'Empty Document' : 'Valid JSON';
      
      // Explicitly reset, wipe, and hide diagnostics drawer
      diagnosticsDrawer.classList.remove('show');
      diagTypeText.textContent = '';
      diagExplanation.textContent = '';
      diagSnippet.textContent = '';
      diagSuggestion.innerHTML = '';
      btnDiagAutoFix.style.display = 'none';

      if (!diag) {
        telKeys.innerHTML = '<span>0</span> keys';
      } else {
        let keyCount = 0;
        function countKeys(obj, depth = 0) {
          if (!obj || typeof obj !== 'object' || depth > 20) return;
          if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) countKeys(obj[i], depth + 1);
          } else {
            const keys = Object.keys(obj);
            keyCount += keys.length;
            for (let i = 0; i < keys.length; i++) countKeys(obj[keys[i]], depth + 1);
          }
        }
        countKeys(diag.data);
        telKeys.innerHTML = `<span>${keyCount}</span> keys`;
      }
    } else {
      errorLine = diag.line;
      diagnosticBadge.className = 'diagnostic-badge error';
      diagnosticText.textContent = `${diag.type} (Line ${diag.line}, Col ${diag.col}) — Details (F8)`;
      telKeys.innerHTML = '<span>—</span> keys';

      diagTypeText.textContent = `${diag.type} (Line ${diag.line}, Column ${diag.col})`;
      diagExplanation.textContent = diag.message;
      diagSnippet.textContent = diag.snippet;
      diagSuggestion.innerHTML = `<strong>Suggested Action:</strong> ${diag.suggestion}`;
      
      btnDiagAutoFix.style.display = diag.autoFixable ? 'inline-block' : 'none';

      const zeroBasedErr = errorLine - 1;
      for (const [start, end] of foldedBlocks.entries()) {
        if (zeroBasedErr >= start && zeroBasedErr <= end) {
          foldedBlocks.delete(start);
        }
      }
    }
  }

  // 6. Live Telemetry Update
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

    // Count exactly what is parsed in lineStructures, avoiding ghost trailing lines
    const totalLines = val.length === 0 ? 0 : val.split('\n').length;
    telLines.innerHTML = `<span>${totalLines}</span> lines`;

    const bytes = new Blob([val]).size;
    let formattedSize = bytes + ' B';
    if (bytes >= 1024 * 1024) {
      formattedSize = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    } else if (bytes >= 1024) {
      formattedSize = (bytes / 1024).toFixed(1) + ' KB';
    }
    telSize.innerHTML = `<span>${formattedSize}</span>`;
  }

  // 7. Render Engine & True 1:1 Synchronized Layout
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
            ${foldInfo ? `<span class="fold-btn ${isFolded ? 'folded' : ''}" data-start="${idx}" data-end="${foldInfo.end}">▼</span>` : '<span style="width:14px"></span>'}
          </div>
        `;

        let foldBadge = '';
        if (isFolded && foldInfo) {
          const count = foldInfo.end - foldInfo.start;
          foldBadge = `<span class="fold-badge" data-start="${idx}" data-end="${foldInfo.end}">... ${count} lines hidden ${foldInfo.type === 'Object' ? '}' : ']'}</span>`;
        }

        editorHtml += `<div class="code-line" id="code-line-${idx}">${l.html}${foldBadge}</div>`;
      }
    });

    const maxDigits = String(lineStructures.length).length;
    const dynamicGutterWidth = Math.max(52, maxDigits * 8 + 26);
    gutter.style.width = `${dynamicGutterWidth}px`;

    gutterContent.innerHTML = gutterHtml;
    editorLayer.innerHTML = editorHtml;

    textarea.style.width = '100%';
    textarea.style.height = '100%';
    editorLayer.style.width = '100%';
    editorLayer.style.height = '100%';

    const totalLines = foldedBlocks.size > 0 ? visibleLineCount : lineStructures.length;
    const exactContentHeight = totalLines * 22 + 24;
    const isOverflowY = exactContentHeight > viewport.clientHeight;
    const targetHeight = isOverflowY ? exactContentHeight : viewport.clientHeight;

    const isOverflowX = editorLayer.scrollWidth > viewport.clientWidth;
    const targetWidth = isOverflowX ? editorLayer.scrollWidth : viewport.clientWidth;

    textarea.style.height = `${targetHeight}px`;
    textarea.style.width = `${targetWidth}px`;
    editorLayer.style.width = `${targetWidth}px`;
    gutterContent.style.height = `${targetHeight}px`;

    const hScrollHeight = viewport.offsetHeight - viewport.clientHeight;
    gutter.style.paddingBottom = isOverflowX ? `${hScrollHeight}px` : '0px';

    gutter.scrollTop = viewport.scrollTop;

    updateTelemetry();
    applySearch();
  }

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(viewport);

  function toggleFold(start, end) {
    if (foldedBlocks.has(start)) {
      foldedBlocks.delete(start);
    } else {
      foldedBlocks.set(start, end);
    }
    render();
  }

  gutter.addEventListener('click', (e) => {
    const foldBtn = e.target.closest('.fold-btn');
    if (foldBtn && foldBtn.dataset.start !== undefined) {
      toggleFold(parseInt(foldBtn.dataset.start, 10), parseInt(foldBtn.dataset.end, 10));
    }
  });

  editorLayer.addEventListener('click', (e) => {
    const badge = e.target.closest('.fold-badge');
    if (badge && badge.dataset.start !== undefined) {
      toggleFold(parseInt(badge.dataset.start, 10), parseInt(badge.dataset.end, 10));
    }
  });

  viewport.addEventListener('scroll', () => {
    gutter.scrollTop = viewport.scrollTop;
  }, { passive: true });

  textarea.addEventListener('scroll', () => {
    if (textarea.scrollTop !== 0 || textarea.scrollLeft !== 0) {
      viewport.scrollTop += textarea.scrollTop;
      viewport.scrollLeft += textarea.scrollLeft;
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
      gutter.scrollTop = viewport.scrollTop;
    }
  });

  gutter.addEventListener('wheel', (e) => {
    e.preventDefault();
    let deltaY = e.deltaY;
    let deltaX = e.deltaX;

    if (e.deltaMode === 1) {
      deltaY *= 22;
      deltaX *= 22;
    } else if (e.deltaMode === 2) {
      deltaY *= viewport.clientHeight;
      deltaX *= viewport.clientWidth;
    }

    viewport.scrollTop += deltaY;
    viewport.scrollLeft += deltaX;
    gutter.scrollTop = viewport.scrollTop;
  }, { passive: false });

  function toggleDiagnosticsDrawer() {
    if (!currentDiagnostic || currentDiagnostic.success) return;
    diagnosticsDrawer.classList.toggle('show');
    jumpToErrorLine();
  }

  function jumpToErrorLine() {
    if (!errorLine) return;
    const zeroBased = errorLine - 1;

    let modified = false;
    for (const [start, end] of foldedBlocks.entries()) {
      if (zeroBased >= start && zeroBased <= end) {
        foldedBlocks.delete(start);
        modified = true;
      }
    }
    if (modified) render();

    const lines = textarea.value.split('\n');
    let charPos = 0;
    for (let i = 0; i < zeroBased && i < lines.length; i++) {
      charPos += lines[i].length + 1;
    }
    const lineLen = (lines[zeroBased] || '').length;

    textarea.focus();
    textarea.setSelectionRange(charPos, charPos + lineLen);

    const targetTop = (zeroBased * 22) - (viewport.clientHeight / 2);
    viewport.scrollTo({ top: Math.max(0, targetTop), left: 0, behavior: 'smooth' });

    const targetCodeLine = document.getElementById(`code-line-${zeroBased}`);
    if (targetCodeLine) {
      targetCodeLine.classList.remove('error-target-pulse');
      void targetCodeLine.offsetWidth;
      targetCodeLine.classList.add('error-target-pulse');
    }
  }

  diagnosticBadge.addEventListener('click', () => {
    if (diagnosticBadge.classList.contains('error')) {
      toggleDiagnosticsDrawer();
    }
  });

  btnCloseDiag.addEventListener('click', () => {
    diagnosticsDrawer.classList.remove('show');
  });

  btnDiagAutoFix.addEventListener('click', () => {
    const raw = textarea.value;
    const fixed = raw
      .replace(/'([^'\n]*)'/g, '"$1"')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/(?:[{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, (m, k) => m.replace(k, `"${k}"`));

    setEditorValue(fixed);
    diagnosticsDrawer.classList.remove('show');
    validate();
    render();
  });

  function handleSmartCaretNavigation(key) {
    if (foldedBlocks.size === 0) return;
    const cursorPos = textarea.selectionStart;
    const lines = textarea.value.slice(0, cursorPos).split('\n');
    const currentLineIdx = lines.length - 1;

    if (key === 'ArrowDown') {
      for (const [start, end] of foldedBlocks.entries()) {
        if (currentLineIdx === start) {
          const allLines = textarea.value.split('\n');
          const targetLineIdx = Math.min(end + 1, allLines.length - 1);
          let newPos = 0;
          for (let i = 0; i < targetLineIdx; i++) newPos += allLines[i].length + 1;
          textarea.setSelectionRange(newPos, newPos);
          break;
        }
      }
    }
  }

  // 8. Utility Transformations Engine
  function sortKeysRecursive(data, direction = 'asc') {
    if (data === null || typeof data !== 'object') return data;
    if (Array.isArray(data)) {
      return data.map(item => sortKeysRecursive(item, direction));
    }
    const sortedKeys = Object.keys(data).sort((a, b) => {
      return direction === 'asc'
        ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        : b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
    });
    const result = {};
    for (const k of sortedKeys) {
      result[k] = sortKeysRecursive(data[k], direction);
    }
    return result;
  }

  function toCamelCaseKey(str) {
    const prefix = str.match(/^[@$_\s]+/)?.[0] || '';
    const core = str.slice(prefix.length);
    if (!core) return str;
    const camel = core
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, c => c.toLowerCase());
    return prefix + camel;
  }

  function toSnakeCaseKey(str) {
    const prefix = str.match(/^[@$_\s]+/)?.[0] || '';
    const core = str.slice(prefix.length);
    if (!core) return str;
    const snake = core
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[-.\s]+/g, '_')
      .toLowerCase();
    return prefix + snake;
  }

  function transformKeysRecursive(data, transformFn) {
    if (data === null || typeof data !== 'object') return data;
    if (Array.isArray(data)) {
      return data.map(item => transformKeysRecursive(item, transformFn));
    }
    const result = {};
    for (const key of Object.keys(data)) {
      result[transformFn(key)] = transformKeysRecursive(data[key], transformFn);
    }
    return result;
  }

  function executeTransformation(transformFn) {
    toolsMenu.classList.remove('show');
    const diag = analyzeJSONDiagnostics(textarea.value);
    if (diag && diag.success) {
      const transformed = transformFn(diag.data);
      setEditorValue(JSON.stringify(transformed, null, 2));
      foldedBlocks.clear();
      validate();
      render();
    } else {
      validate();
      toggleDiagnosticsDrawer();
    }
  }

  btnToolsDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    testsMenu.classList.remove('show');
    toolsMenu.classList.toggle('show');
  });

  btnTestsDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    toolsMenu.classList.remove('show');
    testsMenu.classList.toggle('show');
  });

  window.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-container')) {
      toolsMenu.classList.remove('show');
      testsMenu.classList.remove('show');
    }
  });

  // Test Case Ingestion Listeners
  document.querySelectorAll('#tests-menu .dropdown-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const testKey = btn.getAttribute('data-test');
      if (testFixtures[testKey]) {
        setEditorValue(testFixtures[testKey], `${testKey}.json`);
        testsMenu.classList.remove('show');
        validate();
        render();
        toggleDiagnosticsDrawer();
      }
    });
  });

  document.getElementById('tool-sort-asc').addEventListener('click', () => {
    executeTransformation(data => sortKeysRecursive(data, 'asc'));
  });

  document.getElementById('tool-sort-desc').addEventListener('click', () => {
    executeTransformation(data => sortKeysRecursive(data, 'desc'));
  });

  document.getElementById('tool-to-camel').addEventListener('click', () => {
    executeTransformation(data => transformKeysRecursive(data, toCamelCaseKey));
  });

  document.getElementById('tool-to-snake').addEventListener('click', () => {
    executeTransformation(data => transformKeysRecursive(data, toSnakeCaseKey));
  });

  // 9. File I/O & Clipboard Handlers
  function saveEditorContent() {
    const content = textarea.value;
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFilename || 'data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById('btn-open').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setEditorValue(evt.target.result, file.name);
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-save').addEventListener('click', saveEditorContent);

  document.getElementById('btn-copy').addEventListener('click', async () => {
    const copyBtn = document.getElementById('btn-copy');
    const originalSvg = copyBtn.innerHTML;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textarea.value);
      } else {
        const temp = document.createElement('textarea');
        temp.value = textarea.value;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      copyBtn.innerHTML = '<span style="font-size: 11px; font-weight: bold; color: #34d399;">✓</span>';
      setTimeout(() => { copyBtn.innerHTML = originalSvg; }, 1600);
    } catch {
      copyBtn.innerHTML = '<span style="font-size: 11px; font-weight: bold; color: #f87171;">✕</span>';
      setTimeout(() => { copyBtn.innerHTML = originalSvg; }, 1600);
    }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  const mainView = document.getElementById('main-view');
  mainView.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
  });

  mainView.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('active');
    }
  });

  mainView.addEventListener('dragover', (e) => e.preventDefault());

  mainView.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setEditorValue(evt.target.result, file.name);
      };
      reader.readAsText(file);
    }
  });

  // Heuristic Formatter for Malformed / Invalid JSON
function formatMalformedJson(raw) {
  let indentLevel = 0;
  const tab = '  ';
  let formatted = '';
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (inString) {
      formatted += char;
      if (char === '\\' && !isEscaped) {
        isEscaped = true;
      } else {
        if (char === '"' && !isEscaped) inString = false;
        isEscaped = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      formatted += char;
    } else if (char === '{' || char === '[') {
      indentLevel++;
      formatted += char + '\n' + tab.repeat(indentLevel);
    } else if (char === '}' || char === ']') {
      indentLevel = Math.max(0, indentLevel - 1);
      formatted = formatted.trimEnd() + '\n' + tab.repeat(indentLevel) + char;
    } else if (char === ',') {
      formatted += char + '\n' + tab.repeat(indentLevel);
    } else if (char === ':') {
      formatted += ': ';
    } else if (char === '\n' || char === '\r') {
      // Collapse excessive blank lines
      if (!formatted.endsWith('\n' + tab.repeat(indentLevel))) {
        formatted += '\n' + tab.repeat(indentLevel);
      }
    } else if (char === ' ' || char === '\t') {
      if (formatted.length > 0 && !/\s$/.test(formatted)) {
        formatted += ' ';
      }
    } else {
      formatted += char;
    }
  }

  // Clean trailing spaces and normalize lines
  return formatted
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

// Updated Format Button Listener in index.js
document.getElementById('btn-format').addEventListener('click', () => {
  const raw = textarea.value.trim();
  if (!raw) return;

  const diag = analyzeJSONDiagnostics(raw);
  if (diag && diag.success) {
    // Valid JSON: Standard strict format
    setEditorValue(JSON.stringify(diag.data, null, 2));
  } else {
    // Invalid JSON: Fault-tolerant heuristic beautifier
    const formatted = formatMalformedJson(raw);
    setEditorValue(formatted);
  }
  foldedBlocks.clear();
  validate();
  render();
});

  document.getElementById('btn-minify').addEventListener('click', () => {
    const diag = analyzeJSONDiagnostics(textarea.value);
    if (diag && diag.success) {
      setEditorValue(JSON.stringify(diag.data));
      foldedBlocks.clear();
      validate();
      render();
    } else {
      validate();
      toggleDiagnosticsDrawer();
    }
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    setEditorValue('', 'untitled.json');
    foldedBlocks.clear();
    closeSearch();
    validate();
    render();
  });

  document.getElementById('btn-expand-all').addEventListener('click', () => {
    foldedBlocks.clear();
    render();
  });

  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    const { foldRanges } = parseEditorLines(textarea.value);
    foldRanges.forEach(f => foldedBlocks.set(f.start, f.end));
    render();
  });

  // 10. Inline Search Capsule Engine
  function openSearch(focusReplace = false) {
    inlineSearchCapsule.classList.add('active');
    btnToggleFind.classList.add('active');
    if (focusReplace) {
      replaceInput.focus();
      replaceInput.select();
    } else {
      searchInput.focus();
      searchInput.select();
    }
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
      if (isRegex) {
        searchInput.style.color = 'var(--text)';
        return new RegExp(query, flags);
      } else {
        searchInput.style.color = 'var(--text)';
        return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      }
    } catch (err) {
      searchInput.style.color = '#ef4444';
      searchCount.textContent = 'Err';
      return null;
    }
  }

  function applySearch() {
    const regexGlobal = getSearchRegExp(true);
    const regexTest = getSearchRegExp(false);

    if (!regexGlobal || !regexTest) {
      if (searchInput.style.color !== 'rgb(239, 68, 68)') {
        searchCount.textContent = '0/0';
      }
      searchMatches = [];
      rawSearchMatches = [];
      return;
    }

    const rawVal = textarea.value;
    rawSearchMatches = [];
    let match;

    while ((match = regexGlobal.exec(rawVal)) !== null) {
      if (match[0].length === 0) {
        if (regexGlobal.lastIndex === match.index) regexGlobal.lastIndex++;
        continue;
      }
      rawSearchMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
    }

    const { lineStructures } = parseEditorLines(rawVal);
    let needsReRender = false;

    lineStructures.forEach((l, idx) => {
      if (regexTest.test(l.raw)) {
        for (const [start, end] of foldedBlocks.entries()) {
          if (idx >= start && idx <= end) {
            foldedBlocks.delete(start);
            needsReRender = true;
          }
        }
      }
    });

    if (needsReRender) {
      render();
      return;
    }

    const lines = editorLayer.querySelectorAll('.code-line');
    searchMatches = [];

    lines.forEach(line => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, null, false);
      const textNodes = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.closest('.fold-badge')) {
          textNodes.push(walker.currentNode);
        }
      }

      textNodes.forEach(node => {
        const val = node.nodeValue;
        if (!regexTest.test(val)) return;

        const frag = document.createDocumentFragment();
        let last = 0;
        const lineReplaceRegex = getSearchRegExp(true);

        val.replace(lineReplaceRegex, (mText, offset) => {
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
      updateActiveSearchMatch();
    } else {
      searchCount.textContent = '0/0';
    }
  }

  function updateActiveSearchMatch() {
    searchMatches.forEach((m, i) => {
      if (i === currentSearchIdx) {
        m.classList.add('active-match');

        const elRect = m.getBoundingClientRect();
        const vpRect = viewport.getBoundingClientRect();

        const deltaX = elRect.left - vpRect.left;
        const deltaY = elRect.top - vpRect.top;

        const targetLeft = viewport.scrollLeft + deltaX - (viewport.clientWidth / 2) + (elRect.width / 2);
        const targetTop = viewport.scrollTop + deltaY - (viewport.clientHeight / 2) + (elRect.height / 2);

        viewport.scrollTo({
          left: Math.max(0, targetLeft),
          top: Math.max(0, targetTop),
          behavior: 'smooth'
        });
      } else {
        m.classList.remove('active-match');
      }
    });
    searchCount.textContent = `${currentSearchIdx + 1}/${searchMatches.length}`;
  }

  function stepSearch(dir) {
    if (!searchMatches.length) return;
    currentSearchIdx = (currentSearchIdx + dir + searchMatches.length) % searchMatches.length;
    updateActiveSearchMatch();
  }

  function replaceCurrentMatch() {
    if (currentSearchIdx < 0 || currentSearchIdx >= rawSearchMatches.length) return;
    const target = rawSearchMatches[currentSearchIdx];
    const replaceVal = replaceInput.value;
    const regexTest = getSearchRegExp(false);

    let finalReplacement = replaceVal;
    if (isRegex && regexTest) {
      finalReplacement = target.text.replace(regexTest, replaceVal);
    }

    textarea.focus();
    textarea.setSelectionRange(target.start, target.end);
    textarea.setRangeText(finalReplacement, target.start, target.end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    applySearch();
  }

  function replaceAllMatches() {
    const regexGlobal = getSearchRegExp(true);
    if (!regexGlobal) return;

    const replaceVal = replaceInput.value;
    const original = textarea.value;
    const updated = original.replace(regexGlobal, replaceVal);

    if (original !== updated) {
      setEditorValue(updated);
    }
  }

  toggleCaseBtn.addEventListener('click', () => {
    isCaseSensitive = !isCaseSensitive;
    toggleCaseBtn.classList.toggle('active', isCaseSensitive);
    applySearch();
  });

  toggleRegexBtn.addEventListener('click', () => {
    isRegex = !isRegex;
    toggleRegexBtn.classList.toggle('active', isRegex);
    applySearch();
  });

  btnToggleFind.addEventListener('click', () => {
    if (inlineSearchCapsule.classList.contains('active')) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  btnCloseFind.addEventListener('click', closeSearch);

  searchInput.addEventListener('input', () => {
    currentSearchIdx = 0;
    render();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      stepSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceCurrentMatch();
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  document.getElementById('search-next').addEventListener('click', () => stepSearch(1));
  document.getElementById('search-prev').addEventListener('click', () => stepSearch(-1));
  document.getElementById('btn-replace').addEventListener('click', replaceCurrentMatch);
  document.getElementById('btn-replace-all').addEventListener('click', replaceAllMatches);

  // Global Shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveEditorContent();
    } else if (e.key === 'F8') {
      e.preventDefault();
      toggleDiagnosticsDrawer();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch(false);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      openSearch(true);
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (!inlineSearchCapsule.classList.contains('active')) openSearch(false);
      stepSearch(e.shiftKey ? -1 : 1);
    }
  });

  // 11. Smart Typing Assist & Indentation Engine
  textarea.addEventListener('input', () => {
    validate();
    render();
  });

  ['click', 'keyup', 'focus', 'select'].forEach(evt => {
    textarea.addEventListener(evt, () => {
      updateTelemetry();
      render();
    });
  });

  textarea.addEventListener('keydown', (e) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;

    if (e.key === 'Escape') {
      if (diagnosticsDrawer.classList.contains('show')) {
        diagnosticsDrawer.classList.remove('show');
        return;
      }
      if (inlineSearchCapsule.classList.contains('active')) {
        closeSearch();
        return;
      }
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      handleSmartCaretNavigation(e.key);
    }

    const openPairs = { '{': '}', '[': ']', '"': '"' };

    if (openPairs[e.key]) {
      if (start !== end) {
        e.preventDefault();
        const selectedText = val.substring(start, end);
        const wrapped = e.key + selectedText + openPairs[e.key];
        textarea.setRangeText(wrapped, start, end, 'select');
        textarea.selectionStart = start + 1;
        textarea.selectionEnd = end + 1;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } else if (e.key === '"' && val[start] === '"') {
        e.preventDefault();
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        render();
        return;
      } else {
        e.preventDefault();
        const pair = e.key + openPairs[e.key];
        textarea.setRangeText(pair, start, end, 'end');
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    if ((e.key === '}' || e.key === ']') && start === end && val[start] === e.key) {
      e.preventDefault();
      textarea.selectionStart = textarea.selectionEnd = start + 1;
      render();
      return;
    }

    if ((e.key === '}' || e.key === ']') && start === end) {
      const before = val.substring(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineBeforeCursor = before.substring(lineStart);
      if (/^\s+$/.test(lineBeforeCursor) && lineBeforeCursor.endsWith('  ')) {
        e.preventDefault();
        const unindented = lineBeforeCursor.slice(0, -2) + e.key;
        textarea.setSelectionRange(lineStart, start);
        textarea.setRangeText(unindented, lineStart, start, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    if (e.key === 'Backspace' && start === end && start > 0) {
      const prev = val[start - 1];
      const next = val[start];
      if ((prev === '{' && next === '}') || (prev === '[' && next === ']') || (prev === '"' && next === '"')) {
        e.preventDefault();
        textarea.setSelectionRange(start - 1, start + 1);
        textarea.setRangeText('', start - 1, start + 1, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const before = val.substring(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const currentLine = before.substring(lineStart);
      const indentMatch = currentLine.match(/^\s*/);
      const currentIndent = indentMatch ? indentMatch[0] : '';

      const prevChar = val[start - 1];
      const nextChar = val[start];

      if ((prevChar === '{' && nextChar === '}') || (prevChar === '[' && nextChar === ']')) {
        const insertText = '\n' + currentIndent + '  \n' + currentIndent;
        textarea.setRangeText(insertText, start, end, 'end');
        const newCursorPos = start + 1 + currentIndent.length + 2;
        textarea.selectionStart = textarea.selectionEnd = newCursorPos;
      } else if (prevChar === '{' || prevChar === '[') {
        const insertText = '\n' + currentIndent + '  ';
        textarea.setRangeText(insertText, start, end, 'end');
      } else {
        const insertText = '\n' + currentIndent;
        textarea.setRangeText(insertText, start, end, 'end');
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (start === end && !e.shiftKey) {
        textarea.setRangeText('  ', start, end, 'end');
      } else {
        const before = val.substring(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const fullSelection = val.substring(lineStart, end);
        const lines = fullSelection.split('\n');

        let modified;
        if (e.shiftKey) {
          modified = lines.map(l => l.startsWith('  ') ? l.substring(2) : (l.startsWith(' ') ? l.substring(1) : l)).join('\n');
        } else {
          modified = lines.map(l => '  ' + l).join('\n');
        }

        textarea.setSelectionRange(lineStart, end);
        textarea.setRangeText(modified, lineStart, end, 'select');
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
  });

  textarea.addEventListener('blur', () => render());

  // Only execute editor initialization if json-textarea exists on the current page
  if (document.getElementById('json-textarea')) {
    validate();
    render();
  }