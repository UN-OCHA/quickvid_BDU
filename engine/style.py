#!/usr/bin/env python3
"""OCHA Editorial Style Guide (3rd ed.) applied to transcribed speech.

SPELLING, CAPITALIZATION and HYPHENATION only. This module never changes which
words were spoken, never reorders them and never rewrites a sentence — the whole
premise of a statement clip is that the captions are the exact spoken words.

The rules are DATA, in brand/ocha_style.json (canonical casings, respellings,
protected names, plus the prompt block). Editing that file changes behaviour with
no code change; every entry carries the guide's page number so it can be checked.

Why it works on WORD TOKENS, not on the sentence string
-------------------------------------------------------
Whisper gives us `text` AND a parallel `words` list with per-word timings, and the
renderer uses BOTH — `cues_from_runs` splits long sentences at word boundaries and
times each chunk from `words[i]["s"]`. Fixing only `text` would silently desync the
two, and the caption you reviewed would not be the caption that burns.

So a rule matches N consecutive tokens and produces M tokens (M may differ:
"percent" -> "per cent" is 1->2, "cease fire" -> "ceasefire" is 2->1). The matched
span's time range is redistributed across the replacements, and `text` is rebuilt
from the same tokens. They cannot drift because there is one operation.

Three things speech does that a printed style guide does not, all measured on real
transcripts and all handled here:
  * HYPHENS ARE INAUDIBLE. Whisper writes "secretary general", the guide says
    "Secretary-General". So matching happens on hyphen-split parts: one rule covers
    "Secretary-General", "secretary general" and "Secretary General" alike. A match
    must still start and end on whole-token boundaries, so "member state" can never
    eat half of "member-state-level".
  * POSSESSIVES. "the Secretary-General's report" must still match; the "'s" is
    lifted off before matching and re-attached to the replacement.
  * SENTENCE STARTS. A rule that forces LOWER case ("tsunami", "cholera") must not
    lower-case the first word of a sentence. Only . ! ? end one — a semicolon or a
    colon does not (guide p6, p5).
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_FILE = os.path.join(ROOT, "brand", "ocha_style.json")

# A token's "core" is the word without surrounding punctuation. Internal hyphens
# and apostrophes are part of the word (Secretary-General, Côte d'Ivoire), so only
# the OUTER edges are stripped.
_EDGE = r"[^\w\-'’]"
_SPLIT = re.compile(rf"^({_EDGE}*)(.*?)({_EDGE}*)$", re.UNICODE)
# Only a full stop / question mark / exclamation ends a sentence. NOT ";" or ":" —
# "Cholera is spreading; cholera kills" is one sentence and the second must stay
# lower case.
_SENTENCE_END = re.compile(r"[.!?]['\"’”)\]]*$")
_POSSESSIVE = re.compile(r"['’]s$", re.UNICODE)

_spec = None
_rules = None


def _load():
    """Parse brand/ocha_style.json once into a lookup keyed by the first word part.

    A missing or malformed file is NOT fatal: style is a polish pass, and a
    transcript with US spelling beats no transcript at all. It logs and disables
    itself, which is visible in the engine console rather than silent.
    """
    global _spec, _rules
    if _rules is not None:
        return _spec, _rules
    try:
        with open(SPEC_FILE, encoding="utf-8") as f:
            _spec = json.load(f)
    except Exception as e:                                   # noqa: BLE001
        print(f"OCHA style: {SPEC_FILE} unreadable ({e}) — transcript left verbatim", flush=True)
        _spec, _rules = {}, {}
        return _spec, _rules

    rules = {}                                               # first word part -> [(pattern, replacement)]

    def add(variant, canonical):
        pat = _parts_of(str(variant))
        rep = [t for t in str(canonical).split() if t]
        if pat and rep:
            rules.setdefault(pat[0], []).append((pat, rep))

    for entry in _spec.get("casing") or []:
        term = entry.get("term") if isinstance(entry, dict) else entry
        if term:
            add(term, term)                                  # any casing of it -> exactly this casing
    for entry in _spec.get("respell") or []:
        to = entry.get("to")
        for variant in (entry.get("from") or []) if to else ():
            add(variant, to)
    for phrase in _spec.get("protect") or []:                # matched first, blocks everything inside
        add(phrase, phrase)

    for key in rules:                                        # longest phrase first: "Member States" before "Member State"
        rules[key].sort(key=lambda r: -len(r[0]))
    _rules = rules
    return _spec, _rules


def _core(tok):
    """The matchable word inside a token: 'States,' -> 'states'."""
    m = _SPLIT.match(tok or "")
    return (m.group(2) if m else (tok or "")).lower()


def _edges(tok):
    """(leading punctuation, word, trailing punctuation)."""
    m = _SPLIT.match(tok or "")
    return (m.group(1), m.group(2), m.group(3)) if m else ("", tok or "", "")


def _parts_of(s):
    """Word parts of a phrase, split on whitespace AND hyphens, lower-cased.
    'Under-Secretary-General' and 'under secretary general' both give
    ['under', 'secretary', 'general'] — hyphens are inaudible in speech."""
    return [p for p in re.split(r"[\s\-]+", _strip_possessive(s.lower())) if p and p.strip("'’")]


def _strip_possessive(s):
    return _POSSESSIVE.sub("", s)


def _flatten(tokens):
    """Word parts across all tokens, with the token each part came from.
    Returns (parts, owner, starts, ends) where `starts`/`ends` mark the parts that
    open and close a token — a rule may only match on whole-token boundaries."""
    parts, owner, starts, ends = [], [], set(), set()
    for ti, tok in enumerate(tokens):
        core = _core(tok.get("w", ""))
        sub = _parts_of(core) or [""]
        starts.add(len(parts))
        for p in sub:
            parts.append(p)
            owner.append(ti)
        ends.add(len(parts) - 1)
    return parts, owner, starts, ends


def _blocked_tokens(tokens, spec):
    """Token indices covered by a `protect` phrase — 'Israel Defense Forces' must not
    become 'Israel Defence Forces' just because 'defense' is a respell rule."""
    parts, owner, starts, ends = _flatten(tokens)
    blocked = set()
    for phrase in spec.get("protect") or []:
        pat = _parts_of(str(phrase))
        n = len(pat)
        if not n:
            continue
        for i in range(len(parts) - n + 1):
            if i in starts and (i + n - 1) in ends and parts[i:i + n] == pat:
                blocked.update(owner[i:i + n])
    return blocked


def apply_tokens(tokens):
    """Style a list of word tokens. Returns (new_tokens, changed_count).

    `tokens` is a list of dicts with at least "w"; "s"/"e" (start/end seconds) are
    carried through and re-spread when a rule changes the token count.
    """
    spec, rules = _load()
    if not rules or not tokens:
        return tokens, 0

    parts, owner, starts, ends = _flatten(tokens)
    blocked = _blocked_tokens(tokens, spec)
    out, p, changed = [], 0, 0
    while p < len(parts):
        ti = owner[p]
        hit = None
        if p in starts and ti not in blocked:
            for pat, rep in rules.get(parts[p], ()):
                n = len(pat)
                if (p + n - 1) in ends and parts[p:p + n] == pat \
                        and not (blocked & set(owner[p:p + n])):
                    hit = (rep, n)
                    break
        if not hit:
            if p in starts:
                out.append(tokens[ti])
            p += 1
            continue

        rep, n = hit
        span = tokens[owner[p]:owner[p + n - 1] + 1]
        lead = _edges(span[0].get("w", ""))[0]               # keep the opening quote/bracket
        last_core, tail = _edges(span[-1].get("w", ""))[1:]  # keep the comma/full stop
        pm = _POSSESSIVE.search(last_core)                   # ...and the Secretary-General's "'s"
        words = list(rep)

        # Never lower-case the opening word of a sentence, even when the canonical
        # form is lower case ("Tsunami warnings were issued.").
        if _starts_sentence(out) and words[0][:1].islower():
            words[0] = words[0][:1].upper() + words[0][1:]

        # Punctuation belongs to the EDGES of the span, not to every word in it:
        # '"Member States must act,"' must not come back as '"Member "States'.
        pieces = list(words)
        pieces[0] = lead + pieces[0]
        pieces[-1] += (pm.group(0) if pm else "") + tail
        if pieces != [t.get("w", "") for t in span]:
            changed += 1

        s, e, m = span[0].get("s"), span[-1].get("e"), len(pieces)
        for k, piece in enumerate(pieces):
            tok = {"w": piece}
            if s is not None and e is not None:
                step = (e - s) / m
                tok["s"] = round(s + step * k, 2)
                tok["e"] = round(s + step * (k + 1), 2)
            elif s is not None:
                tok["s"] = s
            out.append(tok)
        p += n
    return out, changed


def _starts_sentence(emitted):
    """True when the next token opens a sentence (nothing before it, or the previous
    token ended one)."""
    if not emitted:
        return True
    return bool(_SENTENCE_END.search((emitted[-1].get("w") or "").strip()))


def apply_text(text):
    """Style a plain string (no timings). Same rules, same code path."""
    if not text or not text.strip():
        return text
    toks, _ = apply_tokens([{"w": w} for w in text.split()])
    return " ".join(t["w"] for t in toks)


def apply_segments(segments):
    """Style transcript segments in place (and return them).

    Rewrites each segment's `words` and rebuilds `text` from them, so the two can
    never disagree. A segment with no word timings falls back to apply_text.
    Returns (segments, changed_segment_count).
    """
    _, rules = _load()
    if not rules:
        return segments, 0
    touched = 0
    for seg in segments or []:
        words = seg.get("words") or []
        if words:
            new, changed = apply_tokens(words)
            if changed:
                seg["words"] = new
                seg["text"] = " ".join(t["w"] for t in new)
                touched += 1
        else:
            before = seg.get("text") or ""
            after = apply_text(before)
            if after != before:
                seg["text"] = after
                touched += 1
    return segments, touched


def prompt_block():
    """The OCHA house-style section for the AI prompt, generated from the SAME file
    as the transcript rules, so the two can't drift."""
    spec, _ = _load()
    rules = spec.get("prompt_rules") or []
    if not rules:
        return ""
    return ("OCHA HOUSE STYLE (OCHA Editorial Style Guide, 3rd edition):\n"
            + "\n".join("- " + r for r in rules))


if __name__ == "__main__":                                   # quick manual check
    import sys
    print(apply_text(" ".join(sys.argv[1:])) if len(sys.argv) > 1 else prompt_block())
