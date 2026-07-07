#!/usr/bin/env node
/*
 * claude-cost — friendly usage/cost reporting for Claude Code, built on ccusage.
 *
 * Subcommands:
 *   statusline        -> compact line for the Claude Code status bar (model | session $ | month-to-date $)
 *   report            -> all-time totals + month-by-month table + plan recommendation
 *   month [YYYY-MM]   -> detailed breakdown for one month (defaults to current)
 *
 * Data source: ccusage, which parses your local Claude Code logs (~/.claude/projects/*.jsonl)
 * and prices token usage at API rates. All dollar figures are therefore "API-equivalent":
 * what these Claude Code sessions WOULD cost on pay-as-you-go API billing. On a Pro/Max plan
 * you don't actually pay this — it's the value you're extracting from the flat subscription.
 *
 * NOTE: ccusage's --json shape can vary slightly by version, so parsing below is defensive.
 * Run `npx ccusage monthly --json` once to eyeball the keys if a field ever shows blank.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- Flat plan prices (USD/month). Update if Anthropic changes pricing. ----
const PLANS = [
  { name: "Pro",     price: 20 },
  { name: "Max 5x",  price: 100 },
  { name: "Max 20x", price: 200 },
];

// Force offline pricing everywhere by setting CLAUDE_COST_OFFLINE=1.
// (The status line always runs offline for speed regardless of this.)
const OFFLINE = process.env.CLAUDE_COST_OFFLINE === "1";

// Cost basis passed to ccusage's --mode. Default "calculate" prices every month
// identically (token counts x current per-model rates) so months are comparable.
// Override with CLAUDE_COST_MODE=auto (use Claude's recorded cost where present)
// or =display (only recorded costs). See ccusage docs for details.
const MODE = (process.env.CLAUDE_COST_MODE || "calculate").toLowerCase();

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const nf = (n) => (Number(n) || 0).toLocaleString("en-US");
const pad = (s, n) => String(s).padEnd(n);

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Run ccusage: prefer a globally installed binary (fast); fall back to npx.
function runCcusage(args, offline = false) {
  // `--offline` uses ccusage's bundled pricing snapshot (no network, faster).
  // Without it, ccusage fetches the latest per-token rates. Offline changes only
  // the price source, never the token counts.
  const withMode = offline ? [...args, "--offline"] : args;
  const attempts = [
    ["ccusage", withMode],
    ["npx", ["-y", "ccusage", ...withMode]],
  ];
  for (const [cmd, cmdArgs] of attempts) {
    try {
      return execFileSync(cmd, cmdArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      /* try next */
    }
  }
  return null;
}

// Normalize `ccusage monthly --json` into a simple array of month rows.
function getMonthly(offline = false) {
  const raw = runCcusage(
    ["monthly", "--json", "--breakdown", "--mode", MODE],
    offline
  );
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(data)
    ? data
    : data.monthly ?? data.months ?? data.data ?? [];
  return rows
    .map((r) => ({
      month: r.month ?? r.date ?? r.label ?? r.period ?? "?",
      cost: Number(r.totalCost ?? r.cost ?? r.total_cost ?? 0),
      input: Number(r.inputTokens ?? r.input_tokens ?? 0),
      output: Number(r.outputTokens ?? r.output_tokens ?? 0),
      cacheRead: Number(r.cacheReadTokens ?? r.cache_read_tokens ?? 0),
      cacheWrite: Number(
        r.cacheCreationTokens ?? r.cache_creation_tokens ?? 0
      ),
      models: normalizeBreakdown(r),
    }))
    .filter((r) => r.month !== "?")
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Tidy a model id like "claude-opus-4-1-20250805" -> "opus-4-1".
function prettyModel(name) {
  return String(name || "?")
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "");
}

// Normalize ccusage's per-model detail (schema varies by version) into
// [{ model, cost }]. Handles the `modelBreakdowns` array, the `breakdown`
// object, or a bare `modelsUsed`/`models` name list as a last resort.
function normalizeBreakdown(r) {
  if (Array.isArray(r.modelBreakdowns)) {
    return r.modelBreakdowns.map((b) => ({
      model: prettyModel(b.model ?? b.modelName ?? b.name),
      cost: Number(b.totalCost ?? b.cost ?? b.costUSD ?? 0),
    }));
  }
  if (r.breakdown && typeof r.breakdown === "object") {
    return Object.entries(r.breakdown).map(([k, v]) => ({
      model: prettyModel(k),
      cost: Number(v?.totalCost ?? v?.cost ?? v?.costUSD ?? 0),
    }));
  }
  const names = r.modelsUsed ?? r.models;
  if (Array.isArray(names)) {
    return names.map((m) => ({ model: prettyModel(m), cost: 0 }));
  }
  return [];
}

// ---- month-to-date cache (shared by statusline + warm) ----
const CACHE_DIR = join(tmpdir(), "claude-cost");
const CACHE_FILE = join(CACHE_DIR, "mtd.json");

function writeMtdCache(mtd) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ t: Date.now(), mtd }));
  } catch {
    /* ignore */
  }
}

// Refresh the month-to-date figure from ccusage and cache it. Returns the number.
function refreshMtd(offline) {
  const rows = getMonthly(offline);
  const cur = rows.find((r) => r.month === currentMonthKey());
  const mtd = cur ? cur.cost : 0;
  writeMtdCache(mtd);
  return mtd;
}

// Read cached MTD if younger than ttlMs; otherwise recompute (offline for speed).
// The SessionStart "warm" hook is the real refresh (once per session, online, free).
// ttlMs is just a dead-man's-switch for a session left open for a very long time --
// not a freshness schedule -- so it's set generously rather than tuned tightly.
function cachedMtd(ttlMs = 24 * 60 * 60 * 1000) {
  try {
    if (existsSync(CACHE_FILE)) {
      const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
      if (Date.now() - c.t < ttlMs) return c.mtd;
    }
  } catch {
    /* ignore cache errors */
  }
  return refreshMtd(true); // status line prioritizes speed -> offline pricing
}

// ---- statusline: fast, cached month-to-date; enriched from the CC stdin payload ----
function statusline() {
  // Claude Code pipes a JSON payload describing the current session on stdin.
  let payload = {};
  try {
    const stdin = readFileSync(0, "utf8");
    if (stdin && stdin.trim()) payload = JSON.parse(stdin);
  } catch {
    /* no stdin / not JSON — fine */
  }
  const model = payload?.model?.display_name ?? payload?.model?.id ?? "";
  const sessionCost =
    payload?.cost?.total_cost_usd ?? payload?.cost?.total_cost ?? undefined;

  // MTD can never legitimately be less than the current session's own cost --
  // this session is part of the month. Clamp so a stale cache can never display
  // a contradiction, regardless of how the TTL above is tuned.
  const mtd = Math.max(cachedMtd(), sessionCost || 0);

  const parts = [];
  if (model) parts.push(`🤖 ${model}`);
  if (typeof sessionCost === "number")
    parts.push(`💬 ${money(sessionCost)} session`);
  parts.push(`📅 ${money(mtd)} MTD`);
  process.stdout.write(parts.join("  |  "));
}

// ---- report: the everything view ----
function report() {
  const rows = getMonthly(OFFLINE);
  if (!rows.length) {
    console.log(
      "No usage data found yet. (ccusage reads ~/.claude logs — use Claude Code a bit, then re-run.)"
    );
    return;
  }
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const sorted = rows.map((r) => r.cost).sort((a, b) => a - b);
  const avg = total / rows.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];

  const lines = [];
  lines.push("Claude Code — API-equivalent usage (from local logs via ccusage)");
  lines.push("");
  lines.push(pad("Month", 12) + "API-equiv cost");
  lines.push("-".repeat(28));
  for (const r of rows) lines.push(pad(r.month, 12) + money(r.cost));
  lines.push("-".repeat(28));
  lines.push(`Months tracked : ${rows.length}`);
  lines.push(`Total          : ${money(total)}`);
  lines.push(`Avg / month    : ${money(avg)}`);
  lines.push(`Median / month : ${money(median)}`);
  lines.push(`Busiest month  : ${money(max)}`);
  lines.push("");

  // All-time spend by model (captures mid-session model switches, since ccusage
  // prices each turn by its own model).
  const modelTotals = {};
  for (const r of rows)
    for (const b of r.models)
      modelTotals[b.model] = (modelTotals[b.model] || 0) + b.cost;
  const modelEntries = Object.entries(modelTotals)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  if (modelEntries.length) {
    lines.push("By model (all-time)");
    for (const [m, c] of modelEntries) {
      const pct = total > 0 ? Math.round((c / total) * 100) : 0;
      lines.push(`  ${pad(m, 16)} ${pad(money(c), 10)} ${pct}%`);
    }
    lines.push("");
  }

  // Plan comparison keyed on median (robust to the occasional runaway month).
  const typical = median;
  lines.push("Plan comparison — flat price vs your typical (median) monthly spend");
  lines.push(pad("Plan", 12) + pad("Price", 8) + "Verdict");
  lines.push("-".repeat(60));
  lines.push(
    pad("API pay-go", 12) + pad("usage", 8) + `you'd pay ~${money(typical)}/mo`
  );
  for (const p of PLANS) {
    const verdict =
      typical >= p.price
        ? `covers ~${money(typical)} of usage for ${money(p.price)} → saves ~${money(typical - p.price)}/mo`
        : `${money(p.price)} > your ${money(typical)} typical spend`;
    lines.push(pad(p.name, 12) + pad(money(p.price), 8) + verdict);
  }
  lines.push("-".repeat(60));

  let rec;
  if (typical < 20)
    rec =
      "Light usage. API pay-as-you-go may beat even Pro on raw cost — but Pro's $20 flat buys predictability and also covers claude.ai chat.";
  else if (typical < 100)
    rec =
      "Pro ($20) is a strong deal: you're extracting well above $20/mo of API-equivalent value for a flat $20 — as long as your usage stays within Pro's caps.";
  else if (typical < 200)
    rec = "Your usage points to Max 5x ($100) as the sweet spot.";
  else
    rec =
      "Heavy usage — Max 20x ($200), or API billing with spend limits if your usage is spiky.";

  lines.push("");
  lines.push(`Recommendation: ${rec}`);
  lines.push("");
  lines.push(
    "Note: figures are API-equivalent and cover Claude Code only (not claude.ai chat)."
  );
  lines.push(
    "Priced at CURRENT per-model API rates x your historical token counts — not the rate"
  );
  lines.push(
    "in effect each past month (ccusage has no per-date historical pricing). This is the"
  );
  lines.push(
    "right basis for a forward-looking plan decision. [mode: " + MODE + (OFFLINE ? ", offline" : "") + "]"
  );
  lines.push(
    "Pro/Max are flat but have usage caps, so very high months may not be servable on a cheaper tier."
  );
  console.log(lines.join("\n"));
}

// ---- month: single-month detail ----
function month(arg) {
  const key = arg && /^\d{4}-\d{2}$/.test(arg) ? arg : currentMonthKey();
  const rows = getMonthly(OFFLINE);
  const r = rows.find((x) => x.month === key);
  if (!r) {
    console.log(`No usage found for ${key}.`);
    return;
  }
  const out = [];
  out.push(`Claude Code usage — ${key} (API-equivalent)`);
  out.push("");
  out.push(`Cost            : ${money(r.cost)}`);
  out.push(`Input tokens    : ${nf(r.input)}`);
  out.push(`Output tokens   : ${nf(r.output)}`);
  out.push(`Cache read      : ${nf(r.cacheRead)}`);
  out.push(`Cache write     : ${nf(r.cacheWrite)}`);
  const byModel = (r.models || []).filter((b) => b.cost > 0).sort((a, b) => b.cost - a.cost);
  if (byModel.length > 1) {
    out.push("");
    out.push("By model:");
    for (const b of byModel) out.push(`  ${pad(b.model, 16)} ${money(b.cost)}`);
  }
  out.push("");
  out.push(
    `Flat-plan reference: Pro $20 / Max 5x $100 / Max 20x $200. This month you used ${money(
      r.cost
    )} of API-equivalent value.`
  );
  out.push(
    `(Priced at current per-model API rates, not the rate in effect during ${key}.)`
  );
  console.log(out.join("\n"));
}

// ---- warm: silently refresh the cache with fresh (online) pricing ----
// Intended for a SessionStart hook. Prints NOTHING to stdout, so it adds nothing
// to the model context = zero token cost. The pricing fetch is a plain HTTP call.
function warm() {
  try {
    refreshMtd(OFFLINE); // default online -> pulls current API rates at session start
  } catch {
    /* never let a warm failure interrupt a session */
  }
  // deliberately no output
}

// ---- export: dump full month-by-month history to CSV or JSON ----
function exportData(fmt, outPath) {
  const format = (fmt || "csv").toLowerCase();
  const rows = getMonthly(OFFLINE);
  if (!rows.length) {
    console.log("No usage data to export yet.");
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const dest =
    outPath ||
    join(process.cwd(), `claude-cost-${stamp}.${format === "json" ? "json" : "csv"}`);

  let body;
  if (format === "json") {
    body = JSON.stringify(rows, null, 2);
  } else {
    const header = [
      "month",
      "api_equivalent_cost_usd",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
    ].join(",");
    const csvRows = rows.map((r) =>
      [r.month, r.cost.toFixed(2), r.input, r.output, r.cacheRead, r.cacheWrite].join(",")
    );
    body = [header, ...csvRows].join("\n") + "\n";
  }

  try {
    writeFileSync(dest, body);
    console.log(`Exported ${rows.length} months to ${dest}`);
  } catch (e) {
    console.log(`Could not write ${dest}: ${e.message}`);
  }
}

// ---- dispatch ----
const [, , sub, ...rest] = process.argv;
switch ((sub || "").toLowerCase()) {
  case "statusline":
    statusline();
    break;
  case "report":
    report();
    break;
  case "month":
    month(rest[0]);
    break;
  case "warm":
    warm();
    break;
  case "export":
    exportData(rest[0], rest[1]);
    break;
  default:
    console.log(
      "Usage: ccu-report.mjs <statusline|report|month [YYYY-MM]|export [csv|json] [path]|warm>"
    );
}
