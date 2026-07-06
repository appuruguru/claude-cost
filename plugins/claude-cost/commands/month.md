---
description: Detailed usage for a specific month (defaults to the current month).
argument-hint: [YYYY-MM]
allowed-tools: Bash(node:*), Bash(npx:*), Bash(ccusage:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ccu-report.mjs" month $1`

Present the month detail above to the user. Keep your reply brief — the table is the answer.
