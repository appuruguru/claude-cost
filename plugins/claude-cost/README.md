# claude-cost

See what your Claude Code usage would cost on pay-as-you-go API billing — right in the
terminal — and get a data-driven answer to "which plan is most cost-effective for me?"

- **Status line:** month-to-date API-equivalent cost, always in view.
- **`/claude-cost:report`:** all-time totals, a month-by-month table, and a plan recommendation.
- **`/claude-cost:month [YYYY-MM]`:** drill into any single month.
- **`/claude-cost:setup`:** wire up the status line in one step.

Built on top of [`ccusage`](https://github.com/ryoppippi/ccusage), which reads your local
Claude Code logs (`~/.claude/projects/*.jsonl`) and prices token usage at API rates.

## What "API-equivalent" means

Every dollar figure is what your Claude Code sessions **would** cost on pay-as-you-go API
billing. On a Pro/Max subscription you don't actually pay this — it's the *value you're
extracting* from your flat subscription. That's exactly what you want for a switching
decision: compare your monthly API-equivalent spend against the flat plan prices
($20 Pro / $100 Max 5x / $200 Max 20x).

A few honest caveats:
- It covers **Claude Code only** — claude.ai chat has no token meter and isn't included.
- Pro/Max are flat but have **usage caps**, so a very heavy month's API-equivalent number
  might not actually be servable on a cheaper flat tier.
- Numbers reflect your logs as of the last disk write. Sub-task/subagent usage is included
  in the totals (verified with a controlled before/after test, not assumed), but a very
  active in-progress session can briefly run ahead of what `/claude-cost:report` shows —
  the status line accounts for this by never displaying less than your current session's
  own live cost.

## vs. the built-in `/usage` command

Claude Code ships a built-in `/usage` command. Based on its documentation (we haven't
been able to get a firsthand look at its live output on every setup, so treat this as a
best-effort comparison), it's session-local — a breakdown of recent usage by skill,
subagent, and plugin for the current session or a 24h/7-day window. `claude-cost`
answers a different question: month-to-date tracking, multi-month historical trends,
and a data-driven recommendation for which plan (Pro/Max/pay-as-you-go) actually fits
your usage pattern. The two aren't redundant — `/usage` is about *this session*;
`claude-cost` is about your spend *over time*.

## Install

```
/plugin marketplace add appuruguru/claude-cost
/plugin install claude-cost@claude-cost
/reload-plugins
/claude-cost:setup
```

`ccusage` is fetched automatically via `npx` on first run. For a snappier status line,
install it once globally: `npm i -g ccusage`.

## Commands

| Command | What it does |
| --- | --- |
| `/claude-cost:report` | All-time + month-by-month history + plan recommendation |
| `/claude-cost:month 2026-03` | Detailed breakdown for one month (defaults to current) |
| `/claude-cost:export csv` | Dump full history to CSV (or `json`) for spreadsheet analysis |
| `/claude-cost:setup` | Configure the month-to-date status line |

## Export

`/claude-cost:export csv` writes `claude-cost-YYYY-MM-DD.csv` to your current directory
(columns: month, cost, input/output/cache tokens). Use `json` for the raw shape, or pass a
path: `/claude-cost:export csv ~/reports/claude.csv`. Open the CSV in any spreadsheet to
chart long-term trends and eyeball your plan break-even over time.

## Fresh pricing at session start (zero token cost)

A `SessionStart` hook (`hooks/hooks.json`) silently runs `ccu-report.mjs warm` once per
session. It refreshes the pricing/usage cache using **current** API rates and prints
nothing — so it adds nothing to the model's context and costs **zero tokens**. Pricing is
a plain HTTP fetch; no LLM is involved. It also makes your first status line render instant.

## Online vs offline pricing

Dollar figures price your (local) token counts at API rates. Where those rates come from:

- **Reports/export** default to **online** — ccusage fetches the latest per-token rates.
- **Status line** always runs **offline** (bundled pricing snapshot) for speed; the
  session-start hook keeps it fresh anyway.
- Force offline everywhere by setting `CLAUDE_COST_OFFLINE=1` (no network, uses the pricing
  snapshot in your installed ccusage version — fast, but can lag a rate change).

Offline only changes the *rate card*, never your token counts. Subscription flat prices
($20/$100/$200) have no live source, so they stay as constants in `bin/ccu-report.mjs`.

## Cost basis (why numbers are "current-rate")

Every dollar figure is your **historical token counts priced at current per-model API
rates** — not the rate that was in effect during each past month. ccusage has no per-date
historical pricing, so this is expected; it's also the *right* basis for a forward-looking
plan decision (you care what your usage pattern costs at today's prices).

This is controlled by ccusage's `--mode`, which the plugin sets to `calculate` by default
so every month is priced identically and stays comparable. Override with `CLAUDE_COST_MODE`:

- `calculate` (default) — always compute tokens × current rates. Consistent across months.
- `auto` — use Claude Code's recorded cost where the log has one, else compute. Mixed basis.
- `display` — only show recorded costs (blanks where none exist). Rarely useful now, since
  recent Claude Code versions no longer write per-message costs.

The report footer prints the active mode, e.g. `[mode: calculate]`.

## Model switching

Switching models mid-session (`/model`, or Claude Code routing a sub-task to Haiku) is
captured and costed correctly: ccusage prices **each turn by the model that ran it**, not
the session by a single model. So a Sonnet→Opus session is summed as Sonnet turns at Sonnet
rates plus Opus turns at Opus rates. The report shows an **all-time "By model" split** (with
each model's share of spend), and `/claude-cost:month` breaks a month out per model. Your
Opus-vs-Sonnet ratio is the biggest driver of which plan fits, so this is the number to
watch.

## Status line

After `/claude-cost:setup`, your status bar shows:

```
🤖 Sonnet 4.6  |  💬 $0.42 session  |  📅 $18.90 MTD
```

Session cost is read for free from the payload Claude Code hands the status line.
Month-to-date is refreshed once per session (via a `SessionStart` hook, at zero token
cost) and cached for the rest of the session so every render stays instant; it's clamped
to never display less than your current session's own live cost.

## A note on trust

Claude Code plugins run code with your privileges. This one runs a small Node script
(`bin/ccu-report.mjs`) that shells out to `ccusage` and reads your local usage logs.
It makes no network calls of its own (ccusage may fetch pricing data unless run with
`--offline`). Read the source before installing — you should do that with any plugin.

## Customizing

- Plan prices live at the top of `bin/ccu-report.mjs` (the `PLANS` array) — update them
  if Anthropic changes pricing.
- The plan recommendation keys on your **median** monthly spend, which shrugs off the odd
  runaway month. Change `typical = median` in `report()` to `avg` if you'd rather it react
  to spikes.
