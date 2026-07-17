#!/usr/bin/env python3
"""
Prototype: patch OCHA .mogrt capsule values at the AEP (RIFX) level.

Premiere ignores definition.json values for AE-authored capsules and its UXP
DOM exposes no Essential Graphics params (verified live: component chain =
Motion+Opacity only). But the capsule embeds the full AE project:

  capsule.mogrt (zip)
    project.aegraphic (zip)
      <name>.aep (RIFX big-endian)
        ... Utf8[control GUID] CTyp[type] then:
              type 1 checkbox : CVal[1]=00/01 CDef[1]
              type 2 slider   : CVal[8]=f64be CDef[8]
              type 13 dropdown: CVal[?]=index  CDef[?]
              type 6 text     : Utf8[value] Utf8[default]   (variable size!)
        ... and the RENDERED text lives separately in the text-engine stream
            as "(\xfe\xff" + UTF-16BE + ")" PostScript-style strings.

This tool parses the RIFX tree, patches control values by GUID + the layer
text strings, rebuilds with corrected sizes, and rezips the capsule. The JS
port of exactly this logic goes into the panel; this prototype exists so the
byte-level logic can be developed/validated offline (incl. an AE round-trip).

Usage:
  rifx_patch.py in.mogrt out.mogrt '{"controls": {"<guid>": "text or number or bool", ...},
                                     "texts": {"NAME SURNAME": "MARÍA GARCÍA", ...}}'
"""
import json
import struct
import sys
import zipfile
import io
import re

# ---------------------------------------------------------------- RIFX tree
CONTAINERS = (b"RIFX", b"LIST")


def parse(data):
    """RIFX → (tree, trailer). AE appends an XMP packet AFTER the RIFX root —
    parse strictly inside declared sizes and carry the trailer verbatim."""
    def parse_chunks(buf, start, end):
        out = []
        i = start
        while i + 8 <= end:
            four = buf[i:i + 4]
            size = struct.unpack(">I", buf[i + 4:i + 8])[0]
            if i + 8 + size > end:                   # malformed/unknown → keep raw
                out.append([b"_RAW", None, buf[i:end]])
                break
            body = buf[i + 8:i + 8 + size]
            if four in CONTAINERS and size >= 4:
                sub = body[:4]
                out.append([four, sub, parse_chunks(buf, i + 12, i + 8 + size)])
            else:
                out.append([four, None, body])
            i += 8 + size + (size & 1)               # chunks pad to even
        return out

    assert data[:4] == b"RIFX", "not a RIFX file"
    root_size = struct.unpack(">I", data[4:8])[0]
    end = 8 + root_size
    tree = [[b"RIFX", data[8:12], parse_chunks(data, 12, end)]]
    return tree, data[end:]


def build(nodes, trailer=b""):
    def build_nodes(ns):
        out = bytearray()
        for four, sub, body in ns:
            if four == b"_RAW":
                out += body
                continue
            payload = (sub + build_nodes(body)) if four in CONTAINERS else body
            out += four + struct.pack(">I", len(payload)) + payload
            if len(payload) & 1:
                out += b"\x00"
        return bytes(out)
    return build_nodes(nodes) + trailer


def leaves(nodes, parent=None):
    """Yield (parent_children_list, index, fourcc, payload) for every leaf."""
    for idx, node in enumerate(nodes):
        four, sub, body = node
        if four in CONTAINERS:
            yield from leaves(body, node)
        else:
            yield nodes, idx, four, body


# ---------------------------------------------------------------- patchers
def patch_controls(tree, controls):
    """controls: {guid(str): value}. Returns list of patched labels."""
    done = []
    seq = list(leaves(tree))
    for n, (siblings, idx, four, body) in enumerate(seq):
        if four != b"Utf8":
            continue
        guid = body.decode("utf-8", "ignore")
        if guid not in controls:
            continue
        val = controls[guid]
        # find CTyp among the next few sibling leaves (same parent list)
        ctyp = None
        js = [j for j in range(idx + 1, min(idx + 8, len(siblings)))]
        for j in js:
            f2, _, b2 = siblings[j][0], siblings[j][1], siblings[j][2]
            if f2 == b"CTyp":
                ctyp = struct.unpack(">I", b2)[0]
                break
        if ctyp is None:
            continue
        if ctyp == 6:                                   # text → next two Utf8 siblings
            replaced = 0
            for j in js:
                if siblings[j][0] == b"Utf8" and replaced < 2:
                    siblings[j][2] = str(val).encode("utf-8")
                    replaced += 1
            if replaced:
                done.append(f"{guid[:8]}:text")
        else:                                           # CVal/CDef fixed-size numerics
            for j in js:
                f2 = siblings[j][0]
                if f2 in (b"CVal", b"CDef"):
                    b2 = siblings[j][2]
                    if len(b2) == 1:
                        siblings[j][2] = b"\x01" if val else b"\x00"
                    elif len(b2) == 8:
                        siblings[j][2] = struct.pack(">d", float(val))
                    elif len(b2) == 4:
                        siblings[j][2] = struct.pack(">i", int(val))
                if f2 == b"Utf8":                       # stop at next control
                    break
            done.append(f"{guid[:8]}:v={val}")
    return done


def _ps_escape(b):
    out = bytearray()
    for x in b:
        if x in (0x28, 0x29, 0x5C):                     # ( ) \
            out += b"\\"
        out.append(x)
    return bytes(out)


def patch_texts(tree, texts):
    """Replace UTF-16BE '(\xfe\xff...)' text-engine strings by exact old→new."""
    done = []
    for siblings, idx, four, body in leaves(tree):
        changed = False
        for old, new in texts.items():
            old_b = b"(\xfe\xff" + _ps_escape(old.encode("utf-16-be"))
            if old_b not in body:
                continue
            new_b = b"(\xfe\xff" + _ps_escape(new.encode("utf-16-be"))
            body = body.replace(old_b, new_b)
            changed = True
            done.append(f"{four.decode()}:{old[:18]}→{new[:18]}")
        if changed:
            siblings[idx][2] = body
    return done


# ---------------------------------------------------------------- capsule io
def patch_mogrt(in_path, out_path, spec):
    zin = zipfile.ZipFile(in_path)
    names = zin.namelist()
    files = {n: zin.read(n) for n in names}

    inner = zipfile.ZipFile(io.BytesIO(files["project.aegraphic"]))
    inner_files = {n: inner.read(n) for n in inner.namelist()}
    aep_name = next(n for n in inner_files if n.endswith(".aep"))

    tree, trailer = parse(inner_files[aep_name])
    p1 = patch_controls(tree, spec.get("controls", {}))
    p2 = patch_texts(tree, spec.get("texts", {}))
    rebuilt = build(tree, trailer)
    inner_files[aep_name] = rebuilt

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in inner_files.items():
            z.writestr(n, b)
    files["project.aegraphic"] = buf.getvalue()

    # keep definition.json in sync (EGP display) + fresh capsuleID
    d = json.loads(files["definition.json"])
    import uuid
    d["capsuleID"] = str(uuid.uuid4())
    for c in d.get("clientControls", []):
        cid = c.get("id")
        if cid in spec.get("controls", {}):
            v = spec["controls"][cid]
            if c.get("type") == 6 and isinstance(c.get("value"), dict):
                for loc in c["value"].get("strDB", []):
                    loc["str"] = str(v)
            else:
                c["value"] = v
    files["definition.json"] = json.dumps(d).encode("utf-8")

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)
    return p1, p2


if __name__ == "__main__":
    inp, outp, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    a, b = patch_mogrt(inp, outp, spec)
    print("controls patched:", a)
    print("texts patched:", b)
