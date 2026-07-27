#!/usr/bin/env python3
"""Lint the Windows .bat files for the bug class that shipped broken on
2026-07-27 and stranded every Windows install.

THE BUG: an unescaped parenthesis in an `echo` line. Inside an if/for block cmd
reads a bare ")" as the END OF THE BLOCK, so the rest of the block is swallowed
and the script dies later with the useless ": was unexpected at this time."
It is invisible until the branch is skipped, which is why the first launch
worked and every launch after it failed.

Also checks .bat files are CRLF — LF-only batch files break labels/goto.

    ./.venv/bin/python tools/check-bat.py        # exits non-zero on a problem
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", ".venv", "node_modules"}


def strip_quoted(s: str) -> str:
    """Blank out "..." spans — parens inside quotes are literal to cmd."""
    return re.sub(r'"[^"]*"', lambda m: " " * len(m.group(0)), s)


def unescaped(text: str) -> list[int]:
    """Positions of ( or ) that cmd will treat as block syntax."""
    return [m.start() for m in re.finditer(r"[()]", text)
            if m.start() == 0 or text[m.start() - 1] != "^"]


def check(path: pathlib.Path) -> list[str]:
    raw = path.read_bytes()
    problems = []

    if raw.replace(b"\r\n", b"").count(b"\n"):
        problems.append("has LF-only line endings (must be CRLF)")

    for n, line in enumerate(raw.decode("utf-8", "replace").split("\r\n"), 1):
        body = line.strip()
        low = body.lower()
        if low.startswith("rem ") or low.startswith("::") or low.startswith("rem\t"):
            continue
        # the command is `echo` — possibly behind `if ... ` / `for ... do `
        m = re.search(r"\becho(?:\.|\s)", low)
        if not m:
            continue

        # echo's ARGUMENT ends at the first unquoted & or | (a new command),
        # not at end of line — otherwise `( echo x & pause )` looks like a bug.
        arg_start = m.end()
        in_q, arg_end = False, len(body)
        for i in range(arg_start, len(body)):
            if body[i] == '"':
                in_q = not in_q
            elif not in_q and body[i] in "&|":
                arg_end = i
                break

        # a same-line block — `if errorlevel 1 ( echo ... )` — legitimately ends
        # with the closer(s) that match the opener(s) sitting BEFORE the echo.
        openers = len([p for p in unescaped(strip_quoted(body[:m.start()]))
                       if body[p] == "("])
        arg = strip_quoted(body[arg_start:arg_end]).rstrip()
        while openers and arg.endswith(")") and (len(arg) < 2 or arg[-2] != "^"):
            arg, openers = arg[:-1].rstrip(), openers - 1

        for i in unescaped(arg):
            problems.append(
                f"line {n}: unescaped '{arg[i]}' in echo text — write ^( and ^)\n"
                f"         {body}")
            break
    return problems


def main() -> int:
    bad = 0
    files = [p for p in ROOT.rglob("*.bat")
             if not any(part in SKIP_DIRS for part in p.parts)]
    for p in sorted(files):
        problems = check(p)
        rel = p.relative_to(ROOT)
        if problems:
            bad += 1
            print(f"FAIL {rel}")
            for pr in problems:
                print(f"  {pr}")
        else:
            print(f"ok   {rel}")
    print(f"\n{len(files)} file(s) checked, {bad} with problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
