---
description: Configure the claude-cost status line (shows month-to-date API-equivalent cost).
allowed-tools: Bash(node:*), Read, Write, Edit
---

Set up the status line so it shows month-to-date cost after every turn.

Do this:

1. Resolve the absolute path to this plugin's report script. The plugin root is available as the `CLAUDE_PLUGIN_ROOT` environment variable, so the script lives at `${CLAUDE_PLUGIN_ROOT}/bin/ccu-report.mjs`. Determine its real absolute path (e.g. run `node -e "console.log(process.env.CLAUDE_PLUGIN_ROOT)"`).

2. Read `~/.claude/settings.json` (if it doesn't exist, treat it as `{}`).

3. Merge in the following `statusLine` block **without clobbering any other keys**, replacing `<ABS_PATH>` with the absolute path resolved in step 1 (write the resolved absolute path, not the literal variable — status line commands are not guaranteed to expand `${CLAUDE_PLUGIN_ROOT}`):

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node \"<ABS_PATH>/bin/ccu-report.mjs\" statusline",
       "padding": 0
     }
   }
   ```

4. Write the merged JSON back to `~/.claude/settings.json`.

5. Confirm to the user that on the next turn the status line will show `🤖 model | 💬 session $ | 📅 MTD $`, and mention that ccusage is fetched via `npx` on first use — for a snappier status line they can run `npm i -g ccusage` once.
