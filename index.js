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
// const activeFilenameEl = document.getElementById('active-filename');
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
let isRendering = false;

let isCaseSensitive = false;
let isRegex = false;

// Debouncing and scheduling handles
let validationDebounceTimer = null;
let renderDebounceTimer = null;
let renderFrame = null;
let caretFrame = null;
const textEncoder = new TextEncoder();

if (!document.getElementById('caret-blink-style')) {
  const style = document.createElement('style');
  style.id = 'caret-blink-style';
  style.textContent = `
    @keyframes editorCaretBlink {
      0%, 45% { opacity: 1; }
      50%, 95% { opacity: 0; }
      100% { opacity: 1; }
    }
    .custom-editor-caret {
      position: absolute;
      width: 2px;
      background-color: var(--text);
      pointer-events: none;
      z-index: 5;
      display: none;
      border-radius: 1px;
      animation: editorCaretBlink 1.05s infinite;
    }
  `;
  document.head.appendChild(style);
}

function applyTheme(isDark) {
  document.body.classList.toggle('dark-theme', isDark);
  document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('json_theme', isDark ? 'dark' : 'grey');
}
themeToggleBtn.addEventListener('click', () => {
  applyTheme(!document.body.classList.contains('dark-theme'));
});
applyTheme(localStorage.getItem('json_theme') === 'dark');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeNewlines(str) {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function setEditorValue(newVal, newFilename = null) {
  const cleanVal = normalizeNewlines(newVal).replace(/\u00A0/g, ' ');
  textarea.focus();
  textarea.setSelectionRange(0, textarea.value.length);
  textarea.setRangeText(cleanVal, 0, textarea.value.length, 'end');
  // if (newFilename) {
  //   activeFilename = newFilename;
  //   activeFilenameEl.textContent = `(${newFilename})`;
  // }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function clearSelectionHighlight() {
  if (textarea.selectionStart !== textarea.selectionEnd) {
    const pos = textarea.selectionStart;
    textarea.setSelectionRange(pos, pos);
    updateTelemetry();
  }
}

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
  const text = source;
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u00A0') {
        pos++;
      } else if (ch === '/' && peek(1) === '/') {
        const commentStart = pos;
        return createError(
          "Comments Not Allowed",
          "Single-line comments (//) are not supported in standard JSON (RFC 8259).",
          "Remove the comment.",
          true,
          commentStart
        );
      } else if (ch === '/' && peek(1) === '*') {
        const commentStart = pos;
        return createError(
          "Comments Not Allowed",
          "Block comments (/* */) are not supported in standard JSON (RFC 8259).",
          "Remove the block comment.",
          true,
          commentStart
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
      if (pos < len) pos++;
      return createError(
        "Single Quotes Used",
        "Property keys and string values must be enclosed in double quotes (\"). Single quotes (') are invalid in JSON.",
        "Replace single quotes (') with double quotes (\").",
        true,
        startPos
      );
    }

    if (quoteChar !== '"') return null;
    pos++;

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
        const backslashPos = pos;
        pos++;
        if (pos >= len) {
          return createError(
            "Unclosed String Literal",
            "String literal ended with an unescaped trailing backslash.",
            "Complete escape sequence or remove trailing backslash.",
            false,
            backslashPos
          );
        }
        const esc = text[pos];
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(esc)) {
          return createError(
            "Invalid Escape Sequence",
            `Invalid escape character \\${esc} inside string literal.`,
            "Valid escape sequences are \\\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t, and \\uXXXX.",
            false,
            backslashPos
          );
        }
        if (esc === 'u') {
          for (let h = 1; h <= 4; h++) {
            if (pos + h >= len || !/[0-9a-fA-F]/.test(text[pos + h])) {
              return createError(
                "Invalid Unicode Escape",
                "\\u escape sequence must be followed by exactly 4 hexadecimal digits.",
                "Provide 4 valid hex characters, e.g. \\u0020.",
                false,
                backslashPos
              );
            }
          }
          pos += 4;
        }
        pos++;
        continue;
      }
      
      if (ch === '"') {
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
    const initialPos = pos;

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

    if (pos >= len) {
      pos = initialPos;
      return null;
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
      pos = initialPos;
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
          "Provide integer digits after the exponent.",
          false,
          pos - 1
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

    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"' || ch === "'") return parseString();
    
    if (ch === '-' || ch === '+' || ch === '.' || /[0-9]/.test(ch)) {
      const numRes = parseNumber();
      if (numRes) return numRes;
    }

    if (text.startsWith('true', pos)) { pos += 4; return { ok: true }; }
    if (text.startsWith('false', pos)) { pos += 5; return { ok: true }; }
    if (text.startsWith('null', pos)) { pos += 4; return { ok: true }; }

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
    pos++;

    let isFirst = true;
    let lastValueEndPos = pos;

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
          true,
          lastValueEndPos
        );
      }

      isFirst = false;

      err = skipWhitespace();
      if (err) return err;

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
      pos++;

      const valRes = parseValue();
      if (valRes && !valRes.ok) return valRes;
      lastValueEndPos = pos;
    }

    return createError("Unclosed Object", "Opening '{' was never closed.", "Add a closing '}'.", false, openPos);
  }

  function parseArray() {
    const openPos = pos;
    pos++;

    let isFirst = true;
    let lastValueEndPos = pos;

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
          true,
          lastValueEndPos
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
      lastValueEndPos = pos;
    }

    return createError("Unclosed Array", "Opening '[' was never closed.", "Add a closing ']'.", false, openPos);
  }

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

function findActiveBracketPair(text, cursorPos) {
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
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && (inDouble || inSingle)) {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (!inDouble && !inSingle) {
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

function isInsideString(text, pos) {
  let inStr = false;
  for (let i = 0; i < pos; i++) {
    if (text[i] === '\\' && inStr) {
      i++;
      continue;
    }
    if (text[i] === '"') {
      inStr = !inStr;
    }
  }
  return inStr;
}

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

    // Scan for folding scopes
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '\\' && inStr) {
        c++;
        continue;
      }
      if (char === '"') {
        inStr = !inStr;
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

    // High-volume line guard: bypass regex tokenizer on enormous single lines
    if (line.length > 4000) {
      lineStructures.push({ raw: line, html: escapeHtml(line) || '&nbsp;' });
      charAccumulator += line.length + 1;
      continue;
    }

    const tokenRegex = /("(?:[^"\\]|\\.)*"(?:\s*:)?|"(?:[^"\\]|\\.)*$|'(?:[^'\\]|\\.)*'(?:\s*:)?|\b(?:true|false|null)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:])/g;
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
      } else if (token.startsWith('"') || token.startsWith("'")) {
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

// Stack-safe, iterative key counter (no recursion limits)
function countKeysIterative(root) {
  if (!root || typeof root !== 'object') return 0;
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const curr = stack.pop();
    if (Array.isArray(curr)) {
      for (let i = 0; i < curr.length; i++) {
        if (curr[i] && typeof curr[i] === 'object') stack.push(curr[i]);
      }
    } else {
      const keys = Object.keys(curr);
      count += keys.length;
      for (let i = 0; i < keys.length; i++) {
        const val = curr[keys[i]];
        if (val && typeof val === 'object') stack.push(val);
      }
    }
  }
  return count;
}

function validate() {
  const diag = analyzeJSONDiagnostics(textarea.value);
  currentDiagnostic = diag;

  if (!diag || diag.success) {
    errorLine = null;
    diagnosticBadge.className = 'diagnostic-badge valid';
    diagnosticText.textContent = !diag ? 'Empty Document' : 'Valid JSON';
    
    diagnosticsDrawer.classList.remove('show');
    diagTypeText.textContent = '';
    diagExplanation.textContent = '';
    diagSnippet.textContent = '';
    diagSuggestion.innerHTML = '';
    btnDiagAutoFix.style.display = 'none';

    if (!diag) {
      telKeys.innerHTML = '<span>0</span> keys';
    } else {
      const totalKeys = countKeysIterative(diag.data);
      telKeys.innerHTML = `<span>${totalKeys}</span> keys`;
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

function scheduleValidation() {
  clearTimeout(validationDebounceTimer);
  validationDebounceTimer = setTimeout(() => {
    validate();
  }, 220);
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

  const totalLines = val.length === 0 ? 0 : val.split('\n').length;
  telLines.innerHTML = `<span>${totalLines}</span> lines`;

  const bytes = textEncoder.encode(val).length;
  let formattedSize = bytes + ' B';
  if (bytes >= 1024 * 1024) {
    formattedSize = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  } else if (bytes >= 1024) {
    formattedSize = (bytes / 1024).toFixed(1) + ' KB';
  }
  telSize.innerHTML = `<span>${formattedSize}</span>`;

  scheduleCustomCaret();
}

function computeHiddenLines() {
  const hidden = new Set();
  const sortedFolds = Array.from(foldedBlocks.entries()).sort((a, b) => a[0] - b[0]);
  for (const [start, end] of sortedFolds) {
    if (hidden.has(start)) continue;
    for (let i = start + 1; i <= end; i++) {
      hidden.add(i);
    }
  }
  return hidden;
}

function scheduleCustomCaret() {
  cancelAnimationFrame(caretFrame);
  caretFrame = requestAnimationFrame(updateCustomCaret);
}

function updateCustomCaret() {
  let caretEl = document.getElementById('custom-caret');
  if (!caretEl) {
    caretEl = document.createElement('div');
    caretEl.id = 'custom-caret';
    caretEl.className = 'custom-editor-caret';
    editorLayer.appendChild(caretEl);
  }

  if (foldedBlocks.size === 0) {
    textarea.style.caretColor = 'var(--text)';
    caretEl.style.display = 'none';
    return;
  }

  textarea.style.caretColor = 'transparent';

  if (document.activeElement !== textarea || textarea.selectionStart !== textarea.selectionEnd) {
    caretEl.style.display = 'none';
    return;
  }

  const cursorPos = textarea.selectionStart;
  const val = textarea.value;
  const linesBefore = val.slice(0, cursorPos).split('\n');
  const curRawLine = linesBefore.length - 1;
  const curCol = linesBefore[linesBefore.length - 1].length;

  const hiddenLines = computeHiddenLines();
  let targetDisplayLine = curRawLine;

  if (hiddenLines.has(curRawLine)) {
    for (const [start, end] of foldedBlocks.entries()) {
      if (curRawLine >= start && curRawLine <= end) {
        targetDisplayLine = start;
        break;
      }
    }
  }

  const lineEl = document.getElementById(`code-line-${targetDisplayLine}`);
  if (!lineEl) {
    caretEl.style.display = 'none';
    return;
  }

  const layerRect = editorLayer.getBoundingClientRect();
  const lineRect = lineEl.getBoundingClientRect();

  let targetNode = null;
  let targetOffset = 0;
  let accumulatedChars = 0;

  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null, false);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement && node.parentElement.closest('.fold-badge')) continue;
    const len = node.nodeValue.length;
    if (accumulatedChars + len >= curCol) {
      targetNode = node;
      targetOffset = curCol - accumulatedChars;
      break;
    }
    accumulatedChars += len;
    targetNode = node;
    targetOffset = len;
  }

  let caretX = 12;
  let caretY = lineRect.top - layerRect.top;
  let caretHeight = 22;

  if (targetNode && targetNode.nodeValue.length > 0) {
    const range = document.createRange();
    const safeOffset = Math.min(targetOffset, targetNode.nodeValue.length);
    range.setStart(targetNode, safeOffset);
    range.setEnd(targetNode, safeOffset);
    const rect = range.getBoundingClientRect();

    if (rect.left > 0) {
      caretX = rect.left - layerRect.left;
    } else {
      caretX = lineRect.left - layerRect.left + 12;
    }

    if (rect.top > 0) {
      caretY = rect.top - layerRect.top;
    }
    if (rect.height > 0) {
      caretHeight = rect.height;
    }
  }

  caretEl.style.left = `${Math.max(12, caretX)}px`;
  caretEl.style.top = `${caretY}px`;
  caretEl.style.height = `${caretHeight}px`;
  caretEl.style.display = 'block';
}

// Synchronize gutter row heights with code-line heights for accurate visual alignment[cite: 1]
function syncGutterHeights() {
  const codeLines = editorLayer.querySelectorAll('.code-line');
  const gutterRows = gutterContent.querySelectorAll('.gutter-row');
  const actualHeight = Math.max(editorLayer.scrollHeight, viewport.clientHeight);

  // Exact 1:1 match to guarantee gutter row height matches wrapped code lines[cite: 1]
  const len = Math.min(codeLines.length, gutterRows.length);
  const heights = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    heights[i] = codeLines[i].getBoundingClientRect().height;
  }
  for (let i = 0; i < len; i++) {
    // Only mutate if different to prevent unnecessary layout invalidation
    const h = `${heights[i]}px`;
    if (gutterRows[i].style.height !== h) {
      gutterRows[i].style.height = h;
    }
  }

  textarea.style.height = `${actualHeight}px`;
  gutterContent.style.height = `${actualHeight}px`;
}

function render() {
  if (isRendering) return;
  isRendering = true;

  const raw = textarea.value;
  const { lineStructures, foldRanges } = parseEditorLines(raw);

  const activeStartLines = new Map(foldRanges.map(f => [f.start, f.end]));
  for (const [start, end] of foldedBlocks.entries()) {
    if (!activeStartLines.has(start) || activeStartLines.get(start) !== end) {
      foldedBlocks.delete(start);
    }
  }

  const foldMap = new Map();
  foldRanges.forEach(f => foldMap.set(f.start, f));

  const hiddenLines = computeHiddenLines();

  let gutterHtml = '';
  let editorHtml = '';

  lineStructures.forEach((l, idx) => {
    const isFolded = foldedBlocks.has(idx);
    const isHidden = hiddenLines.has(idx);
    const foldInfo = foldMap.get(idx);
    const isErr = errorLine === (idx + 1);

    if (!isHidden) {
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
  textarea.style.maxWidth = '100%';
  editorLayer.style.width = '100%';
  editorLayer.style.maxWidth = '100%';

  // Sync row heights on next paint without blocking typing
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(syncGutterHeights);

  gutter.style.paddingBottom = '0px';
  viewport.scrollLeft = 0;
  textarea.scrollLeft = 0;

  gutter.scrollTop = viewport.scrollTop;

  updateTelemetry();
  if (inlineSearchCapsule.classList.contains('active')) {
    applySearch();
  }
  isRendering = false;
}

const resizeObserver = new ResizeObserver(() => {
  if (!isRendering) {
    // When window resizes, line wrap points change; immediately resync heights[cite: 1]
    syncGutterHeights();
  }
});
resizeObserver.observe(viewport);

function toggleFold(start, end) {
  clearSelectionHighlight();
  if (foldedBlocks.has(start)) {
    foldedBlocks.delete(start);
  } else {
    foldedBlocks.set(start, end);
  }
  render();
}

gutter.addEventListener('mousedown', (e) => {
  clearSelectionHighlight();
  if (e.target.closest('.fold-btn') || e.target.closest('.gutter-row')) {
    e.preventDefault();
  }
});

gutter.addEventListener('click', (e) => {
  const row = e.target.closest('.gutter-row');
  const foldBtn = e.target.closest('.fold-btn') || (row ? row.querySelector('.fold-btn') : null);
  if (foldBtn && foldBtn.dataset.start !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    const start = parseInt(foldBtn.dataset.start, 10);
    const end = parseInt(foldBtn.dataset.end, 10);
    toggleFold(start, end);
  }
});

viewport.addEventListener('scroll', () => {
  gutter.scrollTop = viewport.scrollTop;
  scheduleCustomCaret();
}, { passive: true });

textarea.addEventListener('scroll', () => {
  if (textarea.scrollTop !== 0 || textarea.scrollLeft !== 0) {
    viewport.scrollTop += textarea.scrollTop;
    viewport.scrollLeft += textarea.scrollLeft;
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;
  }
  gutter.scrollTop = viewport.scrollTop;
  scheduleCustomCaret();
});

textarea.addEventListener('wheel', (e) => {
  viewport.scrollTop += e.deltaY;
  viewport.scrollLeft += e.deltaX;
  gutter.scrollTop = viewport.scrollTop;
  scheduleCustomCaret();
  e.preventDefault();
}, { passive: false });

gutter.addEventListener('wheel', (e) => {
  viewport.scrollTop += e.deltaY;
  viewport.scrollLeft += e.deltaX;
  gutter.scrollTop = viewport.scrollTop;
  scheduleCustomCaret();
  e.preventDefault();
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

function autoFixJSON(raw) {
  let output = '';
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const ch = raw[i];

    if (ch === '/' && raw[i + 1] === '/') {
      i += 2;
      while (i < n && raw[i] !== '\n' && raw[i] !== '\r') i++;
      continue;
    }

    if (ch === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < n && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (ch === '"') {
      output += ch;
      i++;
      while (i < n) {
        if (raw[i] === '\\') {
          output += raw[i];
          i++;
          if (i < n) {
            output += raw[i];
            i++;
          }
          continue;
        }
        if (raw[i] === '"') {
          output += raw[i];
          i++;
          break;
        }
        output += raw[i];
        i++;
      }
      continue;
    }

    if (ch === "'") {
      output += '"';
      i++;
      while (i < n) {
        if (raw[i] === '\\') {
          i++;
          if (i < n) {
            if (raw[i] === "'") {
              output += "'";
            } else if (raw[i] === '"') {
              output += '\\"';
            } else {
              output += '\\' + raw[i];
            }
            i++;
          }
          continue;
        }
        if (raw[i] === "'") {
          output += '"';
          i++;
          break;
        }
        if (raw[i] === '"') {
          output += '\\"';
        } else {
          output += raw[i];
        }
        i++;
      }
      continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      let id = '';
      while (i < n && /[a-zA-Z0-9_$.\-]/.test(raw[i])) {
        id += raw[i];
        i++;
      }
      let lookahead = i;
      while (lookahead < n && /\s/.test(raw[lookahead])) lookahead++;
      if (lookahead < n && raw[lookahead] === ':') {
        output += `"${id}"`;
      } else {
        output += id;
      }
      continue;
    }

    if (ch === ',') {
      let lookahead = i + 1;
      while (lookahead < n && /\s/.test(raw[lookahead])) lookahead++;
      if (lookahead < n && (raw[lookahead] === '}' || raw[lookahead] === ']')) {
        i++;
        continue;
      }
    }

    output += ch;
    i++;
  }

  return output;
}

btnDiagAutoFix.addEventListener('click', () => {
  const raw = textarea.value;
  const fixed = autoFixJSON(raw);

  setEditorValue(fixed);
  diagnosticsDrawer.classList.remove('show');
  validate();
  render();
});

function handleSmartCaretNavigation(key) {
  if (foldedBlocks.size === 0) return;
  const cursorPos = textarea.selectionStart;
  const val = textarea.value;
  const lines = val.slice(0, cursorPos).split('\n');
  const currentLineIdx = lines.length - 1;
  const allLines = val.split('\n');

  if (key === 'ArrowDown') {
    for (const [start, end] of foldedBlocks.entries()) {
      if (currentLineIdx === start) {
        let targetLineIdx = end + 1;
        while (targetLineIdx < allLines.length) {
          const innerFold = foldedBlocks.get(targetLineIdx);
          if (innerFold !== undefined) {
            targetLineIdx = innerFold + 1;
          } else {
            break;
          }
        }
        if (targetLineIdx < allLines.length) {
          let newPos = 0;
          for (let i = 0; i < targetLineIdx; i++) newPos += allLines[i].length + 1;
          textarea.setSelectionRange(newPos, newPos);
        }
        break;
      }
    }
  } else if (key === 'ArrowUp') {
    const hiddenLines = computeHiddenLines();
    if (currentLineIdx > 0) {
      let targetLineIdx = currentLineIdx - 1;
      while (targetLineIdx >= 0 && hiddenLines.has(targetLineIdx)) {
        targetLineIdx--;
      }
      if (targetLineIdx >= 0 && targetLineIdx !== currentLineIdx - 1) {
        let newPos = 0;
        for (let i = 0; i < targetLineIdx; i++) newPos += allLines[i].length + 1;
        newPos += Math.min(lines[lines.length - 1].length, allLines[targetLineIdx].length);
        textarea.setSelectionRange(newPos, newPos);
      }
    }
  }
}

// Stack-safe, iterative key sorting (zero call stack recursion)
function sortKeysIterative(data, direction = 'asc') {
  if (data === null || typeof data !== 'object') return data;
  const isArr = Array.isArray(data);
  const rootResult = isArr ? [] : {};
  const stack = [{ src: data, dest: rootResult, isArray: isArr }];

  while (stack.length > 0) {
    const { src, dest, isArray } = stack.pop();

    if (isArray) {
      for (let i = 0; i < src.length; i++) {
        const item = src[i];
        if (item !== null && typeof item === 'object') {
          const subDest = Array.isArray(item) ? [] : {};
          dest[i] = subDest;
          stack.push({ src: item, dest: subDest, isArray: Array.isArray(item) });
        } else {
          dest[i] = item;
        }
      }
    } else {
      const sortedKeys = Object.keys(src).sort((a, b) => {
        return direction === 'asc'
          ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
          : b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
      });

      for (const k of sortedKeys) {
        const item = src[k];
        if (item !== null && typeof item === 'object') {
          const subDest = Array.isArray(item) ? [] : {};
          dest[k] = subDest;
          stack.push({ src: item, dest: subDest, isArray: Array.isArray(item) });
        } else {
          dest[k] = item;
        }
      }
    }
  }

  return rootResult;
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

// Stack-safe, iterative key case transforming (zero call stack recursion)
function transformKeysIterative(data, transformFn) {
  if (data === null || typeof data !== 'object') return data;
  const isArr = Array.isArray(data);
  const rootResult = isArr ? [] : {};
  const stack = [{ src: data, dest: rootResult, isArray: isArr }];

  while (stack.length > 0) {
    const { src, dest, isArray } = stack.pop();

    if (isArray) {
      for (let i = 0; i < src.length; i++) {
        const item = src[i];
        if (item !== null && typeof item === 'object') {
          const subDest = Array.isArray(item) ? [] : {};
          dest[i] = subDest;
          stack.push({ src: item, dest: subDest, isArray: Array.isArray(item) });
        } else {
          dest[i] = item;
        }
      }
    } else {
      for (const k of Object.keys(src)) {
        const newKey = transformFn(k);
        const item = src[k];
        if (item !== null && typeof item === 'object') {
          const subDest = Array.isArray(item) ? [] : {};
          dest[newKey] = subDest;
          stack.push({ src: item, dest: subDest, isArray: Array.isArray(item) });
        } else {
          dest[newKey] = item;
        }
      }
    }
  }

  return rootResult;
}

function executeTransformation(transformFn) {
  toolsMenu.classList.remove('show');
  const diag = analyzeJSONDiagnostics(textarea.value);
  if (diag && diag.success) {
    const transformed = transformFn(diag.data);
    setEditorValue(JSON.stringify(transformed, null, 2));
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

document.querySelectorAll('#tests-menu .dropdown-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const testKey = btn.getAttribute('data-test');
    if (testFixtures[testKey]) {
      setEditorValue(testFixtures[testKey], `${testKey}.json`);
      testsMenu.classList.remove('show');
      foldedBlocks.clear();
      validate();
      render();
      toggleDiagnosticsDrawer();
    }
  });
});

document.getElementById('tool-sort-asc').addEventListener('click', () => {
  executeTransformation(data => sortKeysIterative(data, 'asc'));
});

document.getElementById('tool-sort-desc').addEventListener('click', () => {
  executeTransformation(data => sortKeysIterative(data, 'desc'));
});

document.getElementById('tool-to-camel').addEventListener('click', () => {
  executeTransformation(data => transformKeysIterative(data, toCamelCaseKey));
});

document.getElementById('tool-to-snake').addEventListener('click', () => {
  executeTransformation(data => transformKeysIterative(data, toSnakeCaseKey));
});

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

function formatMalformedJson(raw) {
  let indentLevel = 0;
  const tab = '  ';
  let formatted = '';
  let inString = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (char === '"') {
      let slashes = 0;
      for (let b = i - 1; b >= 0 && raw[b] === '\\'; b--) slashes++;
      if (slashes % 2 === 0) {
        inString = !inString;
      }
      formatted += char;
      continue;
    }

    if (inString) {
      formatted += char;
      continue;
    }

    if (char === '{' || char === '[') {
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

  return formatted
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

document.getElementById('btn-format').addEventListener('click', () => {
  const raw = textarea.value.trim();
  if (!raw) return;

  const diag = analyzeJSONDiagnostics(raw);
  if (diag && diag.success) {
    setEditorValue(JSON.stringify(diag.data, null, 2));
  } else {
    const formatted = formatMalformedJson(raw);
    setEditorValue(formatted);
  }
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
  if (!inlineSearchCapsule.classList.contains('active') || !searchInput.value.trim()) {
    searchMatches = [];
    rawSearchMatches = [];
    if (searchCount) searchCount.textContent = '0/0';
    return;
  }
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
      regexGlobal.lastIndex = match.index + 1;
      continue;
    }
    rawSearchMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0]
    });
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
  searchMatches = Array.from(editorLayer.querySelectorAll('mark.highlight'));
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
  searchCount.textContent = `${searchMatches.length ? currentSearchIdx + 1 : 0}/${searchMatches.length}`;
}

function stepSearch(dir) {
  if (!rawSearchMatches.length) return;
  currentSearchIdx = (currentSearchIdx + dir + rawSearchMatches.length) % rawSearchMatches.length;
  
  const target = rawSearchMatches[currentSearchIdx];
  const targetLine = textarea.value.slice(0, target.start).split('\n').length - 1;
  let needsRender = false;
  for (const [start, end] of foldedBlocks.entries()) {
    if (targetLine >= start && targetLine <= end) {
      foldedBlocks.delete(start);
      needsRender = true;
    }
  }
  if (needsRender) {
    render();
  }
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

function expandFoldsAtLine(lineIdx) {
  let needsRender = false;
  for (const [start, end] of foldedBlocks.entries()) {
    if (lineIdx > start && lineIdx <= end) {
      foldedBlocks.delete(start);
      needsRender = true;
    }
  }
  if (needsRender) {
    render();
  }
}

textarea.addEventListener('pointerdown', (e) => {
  const clickX = e.clientX;
  const clickY = e.clientY;

  const elementsUnderPoint = document.elementsFromPoint(clickX, clickY);
  const badgeUnderClick = elementsUnderPoint.find(el => el.classList && el.classList.contains('fold-badge'));
  if (badgeUnderClick && badgeUnderClick.dataset.start !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    clearSelectionHighlight();
    const start = parseInt(badgeUnderClick.dataset.start, 10);
    foldedBlocks.delete(start);
    render();
    return;
  }

  if (foldedBlocks.size === 0) return;

  const handlePointerUp = (upEvt) => {
    window.removeEventListener('pointerup', handlePointerUp);
    
    const distance = Math.hypot(upEvt.clientX - clickX, upEvt.clientY - clickY);
    if (distance > 4) return;

    const codeLines = Array.from(editorLayer.querySelectorAll('.code-line'));
    let matchedRawIndex = null;

    for (const lineEl of codeLines) {
      const box = lineEl.getBoundingClientRect();
      if (clickY >= box.top - 2 && clickY <= box.bottom + 2) {
        matchedRawIndex = parseInt(lineEl.id.replace('code-line-', ''), 10);
        break;
      }
    }

    if (matchedRawIndex !== null) {
      const lines = textarea.value.split('\n');
      let charPos = 0;
      for (let i = 0; i < matchedRawIndex && i < lines.length; i++) {
        charPos += lines[i].length + 1;
      }
      textarea.setSelectionRange(charPos, charPos);
      updateTelemetry();
    }
  };

  window.addEventListener('pointerup', handlePointerUp);
});

let isSelecting = false;

textarea.addEventListener('mousedown', () => {
  isSelecting = true;
});

window.addEventListener('mouseup', () => {
  if (isSelecting) {
    isSelecting = false;
    updateTelemetry();
  }
});

textarea.addEventListener('select', () => {
  updateTelemetry();
});

textarea.addEventListener('input', () => {
  const cursorPos = textarea.selectionStart;
  const linesBefore = textarea.value.slice(0, cursorPos).split('\n');
  expandFoldsAtLine(linesBefore.length - 1);

  scheduleValidation();

  if (renderDebounceTimer) cancelAnimationFrame(renderDebounceTimer);
  renderDebounceTimer = requestAnimationFrame(() => {
    render();
  });
});

['click', 'keyup', 'focus'].forEach(evt => {
  textarea.addEventListener(evt, () => {
    updateTelemetry();
  });
});

textarea.addEventListener('blur', () => {
  const caretEl = document.getElementById('custom-caret');
  if (caretEl) caretEl.style.display = 'none';
});

textarea.addEventListener('keydown', (e) => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;

  const nonModifyingKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Control', 'Shift', 'Alt', 'Meta'];
  if (foldedBlocks.size > 0 && !nonModifyingKeys.includes(e.key) && !e.ctrlKey && !e.metaKey) {
    const linesBefore = val.slice(0, start).split('\n');
    expandFoldsAtLine(linesBefore.length - 1);
  }

  if (e.key === 'Escape') {
    clearSelectionHighlight();
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
    if (e.key !== '"' && isInsideString(val, start)) {
      return;
    }

    if (start !== end) {
      e.preventDefault();
      const selectedText = val.substring(start, end);
      const wrapped = e.key + selectedText + openPairs[e.key];
      textarea.setRangeText(wrapped, start, end, 'select');
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = end + 1;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    } 
    
    if (e.key === '"' && val[start] === '"') {
      e.preventDefault();
      textarea.selectionStart = textarea.selectionEnd = start + 1;
      scheduleCustomCaret();
      return;
    }

    if (e.key === '"' && start > 0 && /[a-zA-Z0-9\\"]/.test(val[start - 1])) {
      return;
    }

    e.preventDefault();
    const pair = e.key + openPairs[e.key];
    textarea.setRangeText(pair, start, end, 'end');
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if ((e.key === '}' || e.key === ']') && start === end && val[start] === e.key) {
    e.preventDefault();
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    scheduleCustomCaret();
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

if (document.getElementById('json-textarea')) {
  validate();
  render();
}