#!/usr/bin/env python3
"""The session list exists twice. This fails when the two copies stop matching.

    python3 checks/check_sessions.py
    python3 checks/check_sessions.py --table

WHY THERE ARE TWO COPIES
`js/scheduling-config.js` runs in the client's browser, so the booking function
cannot trust anything it sends: `netlify/functions/book-sessions.mjs` keeps its
own list and re-validates every duration against it. That is the right design
and it is not going away.

WHAT IT COSTS
Two copies drift, and this drift is silent in the worst way. The programme went
from six sessions to nine on 2026-08-04 and neither file was updated; Gold
booking kept offering six slots against a nine-session curriculum for three
weeks. A partial fix is worse still — update the browser list alone and the
client picks nine slots, the function counts them against six, and the whole
booking is rejected at the last step with "All nine sessions are required."

WHAT IT CHECKS
Session number, title and duration, in order, in both files. Titles must match
exactly: the server's title is what goes on the calendar invitation, and the
browser's is what the client saw when they picked the slot.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BROWSER = os.path.join(ROOT, "js", "scheduling-config.js")
SERVER = os.path.join(ROOT, "netlify", "functions", "book-sessions.mjs")

ROW = re.compile(r'\{\s*n:\s*(\d+)\s*,\s*title:\s*"([^"]*)"\s*,\s*dur:\s*(\d+)')


def rows(path, start):
    txt = open(path, encoding="utf-8").read()
    i = txt.index(start)
    j = txt.index("]", i)
    return [(int(n), t, int(d)) for n, t, d in ROW.findall(txt[i:j])]


def main():
    a = rows(BROWSER, "sessions: [")
    b = rows(SERVER, "const SESSIONS = [")

    if "--table" in sys.argv:
        for i in range(max(len(a), len(b))):
            x = a[i] if i < len(a) else ("—", "—", "—")
            y = b[i] if i < len(b) else ("—", "—", "—")
            mark = "  " if x == y else "<-"
            print(f"  {mark} {x[0]:>2} {x[2]:>4}min  {x[1]}")
            if x != y:
                print(f"     {y[0]:>2} {y[2]:>4}min  {y[1]}   (server)")

    total = sum(d for _, _, d in a)
    print(f"session list — {len(a)} session(s), {total // 60}h {total % 60:02d}m "
          f"of delivery, two copies compared")

    if a == b:
        print("  PASS — the browser and the booking function agree.")
        return 0

    print(f"\n  FAIL — js/scheduling-config.js and netlify/functions/book-sessions.mjs")
    print("  disagree. Edit BOTH. A partial edit rejects every booking at the last step.")
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else None
        y = b[i] if i < len(b) else None
        if x != y:
            print(f"    ! row {i + 1}: browser {x}  server {y}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
