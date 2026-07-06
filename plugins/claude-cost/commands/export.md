---
description: Export your full month-by-month usage history to CSV (default) or JSON.
argument-hint: [csv|json] [optional/output/path]
allowed-tools: Bash(node:*), Bash(npx:*), Bash(ccusage:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ccu-report.mjs" export $1 $2`

Tell the user where the file was written (the path is printed above) and, in one line, that they can open the CSV in any spreadsheet for longer-term trend analysis.
