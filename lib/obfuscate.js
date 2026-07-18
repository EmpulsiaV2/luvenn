// luvenn's built-in Lua obfuscator.
//
// This is entirely self-contained (no third-party APIs/services) and runs
// server-side whenever a script is published or edited. It never sends
// source code anywhere external.
//
// Layers applied:
//   1. Comment stripping + whitespace minification (hand-rolled Lua tokenizer,
//      correctly aware of short strings, long strings [[ ]] / [=[ ]=], and
//      both line (--) and long (--[[ ]]) comments, so it won't mangle strings
//      that happen to contain lua-looking syntax).
//   2. Every string literal is replaced with a string.char(...) byte
//      reconstruction, so no literal text (URLs, key names, messages, etc.)
//      is visible anywhere in the shipped file.
//   3. The entire resulting source is XOR-encrypted with a random per-script
//      key and base64-encoded.
//   4. A small bootstrap loader — with randomized local variable names
//      generated fresh on every publish/edit, so no two protected outputs
//      look alike — decodes and executes it at runtime via loadstring().
//
// Known limitation: Luau's backtick string-interpolation syntax and
// explicit high-byte (\xNN / \221-style) escapes above 0x7F aren't
// byte-perfect round tripped through this encoder (rare in practice for
// typical scripts) — everything else round-trips exactly, which is
// verified in test/obfuscate.test.js against a real Lua interpreter.

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function isLongBracketStart(src, pos) {
  if (src[pos] !== '[') return -1;
  let j = pos + 1;
  let level = 0;
  while (src[j] === '=') { level++; j++; }
  return src[j] === '[' ? level : -1;
}

function readLongBracket(src, pos, level) {
  const n = src.length;
  let start = pos + 2 + level;
  if (src[start] === '\r' && src[start + 1] === '\n') start += 2;
  else if (src[start] === '\n' || src[start] === '\r') start += 1;
  const closer = ']' + '='.repeat(level) + ']';
  const closeIdx = src.indexOf(closer, start);
  const end = closeIdx === -1 ? n : closeIdx + closer.length;
  const content = src.slice(start, closeIdx === -1 ? n : closeIdx);
  return { content, end };
}

function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let codeBuf = '';

  const flushCode = () => {
    if (codeBuf) { tokens.push({ type: 'code', value: codeBuf }); codeBuf = ''; }
  };

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      flushCode();
      tokens.push({ type: 'ws' });
      i = j;
      continue;
    }

    if (c === '-' && src[i + 1] === '-') {
      flushCode();
      const lvl = isLongBracketStart(src, i + 2);
      if (lvl >= 0) {
        const { end } = readLongBracket(src, i + 2, lvl);
        tokens.push({ type: 'comment' });
        i = end;
      } else {
        let j = i + 2;
        while (j < n && src[j] !== '\n') j++;
        tokens.push({ type: 'comment' });
        i = j;
      }
      continue;
    }

    if (c === '[') {
      const lvl = isLongBracketStart(src, i);
      if (lvl >= 0) {
        flushCode();
        const { content, end } = readLongBracket(src, i, lvl);
        tokens.push({ type: 'string', decoded: content });
        i = end;
        continue;
      }
    }

    if (c === '"' || c === "'") {
      flushCode();
      const quote = c;
      let j = i + 1;
      let decoded = '';
      while (j < n) {
        const ch = src[j];
        if (ch === quote) { j++; break; }
        if (ch === '\\') {
          const esc = src[j + 1];
          if (esc === 'n') { decoded += '\n'; j += 2; }
          else if (esc === 't') { decoded += '\t'; j += 2; }
          else if (esc === 'r') { decoded += '\r'; j += 2; }
          else if (esc === 'a') { decoded += String.fromCharCode(7); j += 2; }
          else if (esc === 'b') { decoded += '\b'; j += 2; }
          else if (esc === 'f') { decoded += '\f'; j += 2; }
          else if (esc === 'v') { decoded += String.fromCharCode(11); j += 2; }
          else if (esc === '\\') { decoded += '\\'; j += 2; }
          else if (esc === '"') { decoded += '"'; j += 2; }
          else if (esc === "'") { decoded += "'"; j += 2; }
          else if (esc === '\n') { decoded += '\n'; j += 2; }
          else if (esc === 'x') {
            const hex = src.slice(j + 2, j + 4);
            decoded += String.fromCharCode(parseInt(hex, 16) || 0);
            j += 4;
          } else if (esc >= '0' && esc <= '9') {
            let k = j + 1, digits = '';
            while (k < n && digits.length < 3 && src[k] >= '0' && src[k] <= '9') { digits += src[k]; k++; }
            decoded += String.fromCharCode(parseInt(digits, 10) & 0xff);
            j = k;
          } else if (esc === 'z') {
            j += 2;
            while (j < n && /\s/.test(src[j])) j++;
          } else {
            decoded += esc;
            j += 2;
          }
        } else {
          decoded += ch;
          j++;
        }
      }
      tokens.push({ type: 'string', decoded });
      i = j;
      continue;
    }

    codeBuf += c;
    i++;
  }
  flushCode();
  return tokens;
}

// ---------------------------------------------------------------------------
// Stage 1: minify + encode string literals
// ---------------------------------------------------------------------------

function bytesToLuaCharExpr(bytes) {
  if (bytes.length === 0) return '""';
  const chunkSize = 40;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(`string.char(${bytes.slice(i, i + chunkSize).join(',')})`);
  }
  return '(' + parts.join('..') + ')';
}

function stage1Minify(source) {
  const tokens = tokenize(source);
  let out = '';
  for (const t of tokens) {
    if (t.type === 'ws') out += ' ';
    else if (t.type === 'comment') out += ' ';
    else if (t.type === 'code') out += t.value;
    else if (t.type === 'string') {
      const bytes = Array.from(Buffer.from(t.decoded, 'utf8'));
      out += bytesToLuaCharExpr(bytes);
    }
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Stage 2: XOR + base64 bootstrap loader
// ---------------------------------------------------------------------------

const NAME_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NAME_ALNUM = NAME_LETTERS + '0123456789';

function randomName(len = 8) {
  let s = '_' + NAME_LETTERS[crypto.randomInt(NAME_LETTERS.length)];
  for (let i = 1; i < len; i++) s += NAME_ALNUM[crypto.randomInt(NAME_ALNUM.length)];
  return s;
}

function buildLoader(stage1Source) {
  const keyLen = 4 + crypto.randomInt(5); // 4-8 byte rolling key
  const key = Array.from(crypto.randomBytes(keyLen));
  const srcBytes = Buffer.from(stage1Source, 'utf8');
  const xored = Buffer.alloc(srcBytes.length);
  for (let i = 0; i < srcBytes.length; i++) xored[i] = srcBytes[i] ^ key[i % key.length];
  const b64 = xored.toString('base64');

  const nAlpha = randomName();
  const nDecode = randomName();
  const nXor = randomName();
  const nKey = randomName();
  const nEnc = randomName();
  const nDec = randomName();
  const nOut = randomName();
  const nSrc = randomName();
  const nFn = randomName();
  const nI = randomName(5);
  const nKb = randomName(5);

  const keyLua = '{' + key.join(',') + '}';

  return [
    `local ${nAlpha}="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="`,
    `local function ${nDecode}(data)`,
    `data=string.gsub(data,'[^'..${nAlpha}..'=]','')`,
    `return (data:gsub('.',function(x)`,
    `if x=='=' then return '' end`,
    `local r,f='',(${nAlpha}):find(x,1,true)`,
    `f=f-1`,
    `for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end`,
    `return r`,
    `end):gsub('%d%d%d?%d?%d?%d?%d?%d?',function(x)`,
    `if #x~=8 then return '' end`,
    `local c=0`,
    `for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end`,
    `return string.char(c)`,
    `end))`,
    `end`,
    `local function ${nXor}(a,b)`,
    `local p,c=1,0`,
    `while a>0 or b>0 do`,
    `local ra,rb=a%2,b%2`,
    `if ra~=rb then c=c+p end`,
    `a=(a-ra)/2`,
    `b=(b-rb)/2`,
    `p=p*2`,
    `end`,
    `return c`,
    `end`,
    `local ${nKey}=${keyLua}`,
    `local ${nEnc}="${b64}"`,
    `local ${nDec}=${nDecode}(${nEnc})`,
    `local ${nOut}={}`,
    `for ${nI}=1,#${nDec} do`,
    `local ${nKb}=${nKey}[((${nI}-1) % #${nKey})+1]`,
    `${nOut}[${nI}]=string.char(${nXor}(string.byte(${nDec},${nI}),${nKb}))`,
    `end`,
    `local ${nSrc}=table.concat(${nOut})`,
    `local ${nFn}=loadstring(${nSrc})`,
    `if ${nFn} then ${nFn}() end`,
  ].join('\n');
}

/**
 * Runs the full obfuscation pipeline on raw Lua source and returns the
 * protected output that gets served to executors. Original source is kept
 * separately by the caller (for the owner's own edit form) — this function
 * is pure and has no side effects.
 */
function obfuscate(source) {
  const stage1 = stage1Minify(String(source || ''));
  return buildLoader(stage1);
}

module.exports = { obfuscate, stage1Minify, tokenize };
