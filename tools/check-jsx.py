#!/usr/bin/env python3
"""ExtendScript rules that a JavaScript parser will NOT catch.

Run:  python3 tools/check-jsx.py         (exit 1 on any violation)

Every rule here comes from a failure that actually happened, and every one of
them is invisible to node/acorn — ExtendScript is ES3 *plus Adobe's own
preprocessor*, and it is the preprocessor that does the damage.

The failure mode is always the same and always maximally unhelpful: the file
fails to load ENTIRELY, so every ocha*() call returns "EvalScript error.", the
panel greys out, and nothing anywhere names the line. You cannot tell it apart
from "Premiere is broken" without loading the file in After Effects
(premiere/ae/check_host_loads.jsx does exactly that).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# ascii=True only for host.jsx. It is the one file shuttled through CEP's
# evalScript bridge, where non-ASCII does not survive; the AE builder is READ
# from disk by After Effects and has carried em-dashes for years without a
# problem, so flagging it would be noise, not a finding.
TARGETS = [
    (ROOT / "premiere" / "cep" / "jsx" / "host.jsx", True),
    (ROOT / "premiere" / "ae" / "src" / "builder_template.jsx", False),
    (ROOT / "premiere" / "ae" / "check_host_loads.jsx", False),
]

# A comment whose first non-space character is "@" is read as a PREPROCESSOR
# DIRECTIVE (the mechanism behind the at-include and at-target forms). An
# unknown directive is a SyntaxError for the whole file. 2026-07-31: one
# "// @font: ..." line took down the entire panel.
AT_COMMENT = re.compile(r"(?://|/\*|^\s*\*)\s*@")
# Same trap, mid-line: the directive scanner does not require column 0.
AT_INLINE = re.compile(r"//\s*@")
# ES3 has no let/const/arrows/template literals. Comments are stripped first so
# prose about them doesn't trip the check.
ES5_PLUS = [
    (re.compile(r"(?<![\w$.])(?:let|const)\s+[A-Za-z_$]"), "let/const (ES3 needs var)"),
    (re.compile(r"=>"), "arrow function"),
    (re.compile(r"`"), "template literal"),
]


def strip_comments(src):
    """Blank out comments and strings so syntax rules only see real code."""
    out, i, n = [], 0, len(src)
    while i < n:
        two = src[i:i + 2]
        if two == "//":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i)); i = j
        elif two == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", src[i:j])); i = j
        elif src[i] in "\"'":
            q, j = src[i], i + 1
            while j < n and src[j] != q:
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            out.append(" " * (j - i)); i = j
        else:
            out.append(src[i]); i += 1
    return "".join(out)


def main():
    problems = []
    checked = 0
    for path, ascii_only in TARGETS:
        if not path.is_file():
            continue
        checked += 1
        src = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        code = strip_comments(src)

        for num, line in enumerate(src.split("\n"), 1):
            if AT_COMMENT.search(line) or AT_INLINE.search(line):
                problems.append(f"{rel}:{num}  comment starts with '@' — read as a "
                                f"preprocessor directive, breaks the WHOLE file\n"
                                f"    {line.strip()[:88]}")

        if ascii_only:
            for num, line in enumerate(src.split("\n"), 1):
                bad = [c for c in line if ord(c) > 127]
                if bad:
                    problems.append(f"{rel}:{num}  non-ASCII {bad[:5]} — this file must be ASCII only")

        for rx, what in ES5_PLUS:
            for m in rx.finditer(code):
                num = code[:m.start()].count("\n") + 1
                problems.append(f"{rel}:{num}  {what}")

    if problems:
        print("ExtendScript rule violations — these break the file SILENTLY:\n")
        for p in problems:
            print("  " + p)
        print(f"\n{len(problems)} problem(s) in {checked} file(s).")
        return 1
    print(f"ExtendScript checks passed ({checked} files):")
    print("  no '@' comments · ASCII only · no let/const/arrows/template literals")
    return 0


if __name__ == "__main__":
    sys.exit(main())
