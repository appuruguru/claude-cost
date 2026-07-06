---
description: Full Claude Code usage history (month-by-month) plus a plan cost-effectiveness recommendation.
allowed-tools: Bash(node:*), Bash(npx:*), Bash(ccusage:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ccu-report.mjs" report`

The report above is already formatted — present it to the user as-is. Then add a two-sentence, plain-English takeaway about which plan looks most cost-effective for them given the numbers, and remind them these are Claude Code API-equivalent figures that exclude claude.ai chat usage.
