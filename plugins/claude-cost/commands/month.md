---
description: Detailed usage for a specific month (defaults to the current month).
argument-hint: [YYYY-MM]
allowed-tools: Bash(node:*), Bash(npx:*), Bash(ccusage:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ccu-report.mjs" month "$ARGUMENTS"`

Present the month detail above to the user as a markdown table with rows for Cost, Input tokens, Output tokens, Cache read, and Cache write. If more than one model was used, add a second markdown table titled "By model" with Model and Cost columns. Keep your reply brief — the tables are the answer, no extra commentary needed.
