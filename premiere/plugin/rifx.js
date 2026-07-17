/* RIFX (.aep) patcher — JS port of tools/rifx_patch.py (validated offline:
   byte-identical rebuild + After Effects opens the patched project and reads
   back the new values). Premiere ignores definition.json for AE-authored
   capsules and exposes no EGP params in its UXP DOM, so the panel patches the
   embedded AE project itself:
     Utf8[control GUID] → CTyp[type] → CVal/CDef (fixed size: bool/f64/i32)
                                     → Utf8 value+default (text, variable size)
   plus the rendered text-engine strings "(\xfe\xff" + UTF-16BE + ")".
   All sizes big-endian; chunks pad to even; AE appends an XMP trailer AFTER
   the RIFX root which must be carried verbatim. */

const CONTAINERS = ["RIFX", "LIST"];

function fourcc(u8, i) { return String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]); }
function u32(u8, i) { return (u8[i] << 24 | u8[i + 1] << 16 | u8[i + 2] << 8 | u8[i + 3]) >>> 0; }
function pu32(n) { return new Uint8Array([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]); }
function str2u8(s) { const b = []; for (const ch of s) { const c = ch.codePointAt(0); if (c < 128) b.push(c); else for (const x of unescape(encodeURIComponent(ch))) b.push(x.charCodeAt(0)); } return new Uint8Array(b); }
function u82str(u8) { let s = ""; for (const b of u8) s += String.fromCharCode(b); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }
function utf16be(s) { const out = []; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out.push(c >> 8, c & 255); } return new Uint8Array(out); }

function parse(data) {
  function parseChunks(start, end) {
    const out = [];
    let i = start;
    while (i + 8 <= end) {
      const four = fourcc(data, i), size = u32(data, i + 4);
      if (i + 8 + size > end) { out.push(["_RAW", null, data.slice(i, end)]); break; }
      const body = data.slice(i + 8, i + 8 + size);
      if (CONTAINERS.includes(four) && size >= 4)
        out.push([four, fourcc(body, 0), parseChunks(i + 12, i + 8 + size)]);
      else
        out.push([four, null, body]);
      i += 8 + size + (size & 1);
    }
    return out;
  }
  if (fourcc(data, 0) !== "RIFX") throw new Error("not a RIFX file");
  const rootSize = u32(data, 4), end = 8 + rootSize;
  return { tree: [["RIFX", fourcc(data, 8), parseChunks(12, end)]], trailer: data.slice(end) };
}

function build(tree, trailer) {
  function buildNodes(ns) {
    const parts = [];
    let len = 0;
    for (const [four, sub, body] of ns) {
      if (four === "_RAW") { parts.push(body); len += body.length; continue; }
      const payload = CONTAINERS.includes(four)
        ? concat([str2u8(sub), buildNodes(body)])
        : body;
      parts.push(str2u8(four), pu32(payload.length), payload);
      len += 8 + payload.length;
      if (payload.length & 1) { parts.push(new Uint8Array(1)); len += 1; }
    }
    return concat(parts, len);
  }
  return concat([buildNodes(tree), trailer || new Uint8Array(0)]);
}

function concat(arrs, total) {
  if (total == null) total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function leaves(nodes, out) {
  out = out || [];
  for (let idx = 0; idx < nodes.length; idx++) {
    const [four, , body] = nodes[idx];
    if (CONTAINERS.includes(four)) leaves(body, out);
    else out.push({ siblings: nodes, idx });
  }
  return out;
}

/* controls: { "<guid>": value }  — string→text, boolean/number→CVal+CDef */
function patchControls(tree, controls) {
  const done = [];
  for (const { siblings, idx } of leaves(tree)) {
    const [four, , body] = siblings[idx];
    if (four !== "Utf8") continue;
    const guid = u82str(body);
    if (!(guid in controls)) continue;
    const val = controls[guid];
    let ctyp = null;
    const upTo = Math.min(idx + 8, siblings.length);
    for (let j = idx + 1; j < upTo; j++)
      if (siblings[j][0] === "CTyp") { ctyp = u32(siblings[j][2], 0); break; }
    if (ctyp === null) continue;
    if (ctyp === 6) {                                  // text: next two Utf8 siblings
      let replaced = 0;
      for (let j = idx + 1; j < upTo && replaced < 2; j++)
        if (siblings[j][0] === "Utf8") { siblings[j][2] = str2u8(String(val)); replaced++; }
      if (replaced) done.push(guid.slice(0, 8) + ":text");
    } else {
      for (let j = idx + 1; j < upTo; j++) {
        const f2 = siblings[j][0];
        if (f2 === "CVal" || f2 === "CDef") {
          const b2 = siblings[j][2];
          if (b2.length === 1) siblings[j][2] = new Uint8Array([val ? 1 : 0]);
          else if (b2.length === 8) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, Number(val), false); siblings[j][2] = b; }
          else if (b2.length === 4) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, Number(val) | 0, false); siblings[j][2] = b; }
        }
        if (f2 === "Utf8") break;                      // next control starts
      }
      done.push(guid.slice(0, 8) + ":v=" + val);
    }
  }
  return done;
}

function psEscape(u8) {
  const out = [];
  for (const x of u8) { if (x === 0x28 || x === 0x29 || x === 0x5c) out.push(0x5c); out.push(x); }
  return new Uint8Array(out);
}

function indexOfBytes(hay, needle, from) {
  outer: for (let i = from || 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/* texts: { "old default": "new text" } — rendered text-engine strings */
function patchTexts(tree, texts) {
  const done = [];
  for (const { siblings, idx } of leaves(tree)) {
    let body = siblings[idx][2];
    let changed = false;
    for (const [oldS, newS] of Object.entries(texts)) {
      if (!oldS) continue;
      const oldB = concat([str2u8("("), new Uint8Array([0xfe, 0xff]), psEscape(utf16be(oldS))]);
      const newB = concat([str2u8("("), new Uint8Array([0xfe, 0xff]), psEscape(utf16be(newS))]);
      let at = indexOfBytes(body, oldB, 0);
      while (at >= 0) {
        body = concat([body.slice(0, at), newB, body.slice(at + oldB.length)]);
        changed = true;
        done.push(oldS.slice(0, 16) + "→" + String(newS).slice(0, 16));
        at = indexOfBytes(body, oldB, at + newB.length);
      }
    }
    if (changed) siblings[idx][2] = body;
  }
  return done;
}

module.exports = { parse, build, patchControls, patchTexts };
