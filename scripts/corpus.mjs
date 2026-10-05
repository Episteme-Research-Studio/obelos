#!/usr/bin/env node
// Corpus study runner for Obelos .
// Pipeline: sample -> fetch -> run -> (hand-check review.csv) -> report. Each step is separate and restartable.
// No dependencies beyond Node 20+, git, and (for `sample`) the GitHub CLI `gh` or a GITHUB_TOKEN.
//
//   node scripts/corpus.mjs sample  [--limit 150] [--min-stars 50] [--seed 1] [--out corpus/sample.json]
//   node scripts/corpus.mjs sample  --from-list repos.txt          (owner/name per line; skips the GitHub search)
//   node scripts/corpus.mjs fetch   [--sample corpus/sample.json] [--dir corpus/repos] [--jobs 4]
//   node scripts/corpus.mjs run     [--dir corpus/repos] [--out corpus/results.json] [--review-size 20]
//   node scripts/corpus.mjs report  [--results corpus/results.json] [--review corpus/review.csv] [--out corpus/report.md]
//   node scripts/corpus.mjs help
//
// `run` works on ANY folder of repositories, e.g. --dir ~/work to try it on your own projects first.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const num = (name, def) => Number(opt(name, def));
const log = (...a) => console.error(...a);

// Deterministic PRNG so a sample can be reproduced from its seed.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function shuffle(items, seed) {
  const r = rng(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);

// ---------- sample ----------
function ghApi(endpoint) {
  const gh = spawnSync("gh", ["api", endpoint, "-H", "Accept: application/vnd.github+json"], { encoding: "utf8" });
  if (gh.status === 0) return JSON.parse(gh.stdout);
  if (process.env.GITHUB_TOKEN) {
    const r = spawnSync("curl", ["-sS", "-H", `Authorization: Bearer ${process.env.GITHUB_TOKEN}`, "-H", "Accept: application/vnd.github+json", `https://api.github.com/${endpoint}`], { encoding: "utf8" });
    if (r.status === 0) return JSON.parse(r.stdout);
  }
  throw new Error(`GitHub API call failed for ${endpoint}. Install and log in to the GitHub CLI (gh auth login) or set GITHUB_TOKEN. ${gh.stderr ?? ""}`.trim());
}

async function sample() {
  const limit = num("limit", 150);
  const minStars = num("min-stars", 50);
  const seed = num("seed", 1);
  const out = opt("out", "corpus/sample.json");
  const fromList = opt("from-list", null);
  let names = [];
  const queries = ["filename:AGENTS.md", "filename:CLAUDE.md", "filename:copilot-instructions.md path:.github", "extension:mdc path:.cursor/rules"];
  const method = { date: new Date().toISOString().slice(0, 10), seed, limit, minStars, queries: fromList ? [`from-list:${fromList}`] : queries, filters: "not a fork, not archived, pushed in the last 12 months, stars >= minStars", note: "GitHub code search returns at most 1000 results per query and favours popular repositories; the sample is not representative of all repositories." };
  if (fromList) {
    names = fs.readFileSync(fromList, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.-]+\/[\w.-]+$/.test(l));
  } else {
    const found = new Set();
    for (const q of queries) {
      for (let page = 1; page <= 10; page++) {
        let res;
        try {
          res = ghApi(`search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
        } catch (e) {
          log(String(e.message));
          break;
        }
        for (const item of res.items ?? []) found.add(item.repository.full_name);
        log(`query "${q}" page ${page}: ${found.size} repositories so far`);
        if (!res.items || res.items.length < 100) break;
        await sleep(7000); // code search is limited to roughly 10 requests per minute
      }
    }
    names = [...found];
  }
  const cutoff = Date.now() - 365 * 86400 * 1000;
  const kept = [];
  for (const full of shuffle(names, seed)) {
    if (kept.length >= limit) break;
    try {
      const m = ghApi(`repos/${full}`);
      const ok = !m.fork && !m.archived && m.stargazers_count >= minStars && Date.parse(m.pushed_at) >= cutoff;
      if (ok) kept.push({ full_name: full, stars: m.stargazers_count, language: m.language, pushed_at: m.pushed_at, license: m.license?.spdx_id ?? null, default_branch: m.default_branch });
      await sleep(250);
    } catch (e) {
      log(`skip ${full}: ${e.message.split("\n")[0]}`);
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ method, candidates: names.length, repos: kept }, null, 2) + "\n");
  console.log(`Sampled ${kept.length} of ${names.length} candidate repositories -> ${out}`);
}

// ---------- fetch ----------
function clone(full, dir, base) {
  return new Promise((resolve) => {
    const target = path.join(dir, full.replace("/", "__"));
    if (fs.existsSync(target)) return resolve({ full, status: "exists" });
    const url = base ? `${base}/${full}` : `https://github.com/${full}.git`;
    const p = spawn("git", ["clone", "--depth", "1", "--quiet", "--filter=blob:none", url, target], { stdio: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const timer = setTimeout(() => p.kill("SIGKILL"), 180_000);
    p.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ full, status: code === 0 ? "cloned" : `failed(${code})` });
    });
    p.on("error", () => resolve({ full, status: "failed(spawn)" }));
  });
}

async function fetchRepos() {
  const sampleFile = opt("sample", "corpus/sample.json");
  const dir = opt("dir", "corpus/repos");
  const jobs = num("jobs", 4);
  const base = opt("base-url", null); // tests: a folder or URL prefix replacing https://github.com
  const repos = JSON.parse(fs.readFileSync(sampleFile, "utf8")).repos;
  fs.mkdirSync(dir, { recursive: true });
  const queue = [...repos];
  const results = [];
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (queue.length) {
        const r = queue.shift();
        const res = await clone(r.full_name, dir, base);
        results.push(res);
        log(`${String(results.length).padStart(4)}/${repos.length} ${res.full} ${res.status}`);
      }
    }),
  );
  const failed = results.filter((r) => r.status.startsWith("failed"));
  console.log(`Fetched into ${dir}: ${results.filter((r) => r.status === "cloned").length} new, ${results.filter((r) => r.status === "exists").length} already there, ${failed.length} failed.`);
  console.log("Clones are for local analysis only; do not redistribute them or commit them anywhere.");
}

// ---------- run ----------
async function loadEngine() {
  const entry = path.join(ROOT, "dist", "index.js");
  if (!fs.existsSync(entry)) throw new Error("dist/index.js not found. Run `npm run build` first.");
  return import(pathToFileURL(entry).href);
}

const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows;
}

async function runCorpus() {
  const dir = path.resolve(opt("dir", "corpus/repos"));
  const out = opt("out", "corpus/results.json");
  const reviewSize = num("review-size", 20);
  const seed = num("seed", 1);
  const { lint, VERSION } = await loadEngine();
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
  const repos = [];
  const findings = [];
  for (const name of names) {
    const t0 = performance.now();
    try {
      const r = lint(path.join(dir, name), { today: opt("today", undefined) });
      const real = r.diagnostics.filter((d) => d.ruleId !== "OBL000");
      repos.push({ repo: name, ok: true, files: r.files.length, kinds: [...new Set(r.files.map((f) => f.kind))], score: r.files.length ? r.score : null, grade: r.files.length ? r.grade : null, tokens: r.files.reduce((a, f) => a + f.tokens, 0), lines: r.files.reduce((a, f) => a + f.lines.length, 0), findings: real.length, notices: r.diagnostics.length - real.length, ms: Math.round(performance.now() - t0) });
      for (const d of real) findings.push({ repo: name, ruleId: d.ruleId, severity: d.severity, file: d.file, line: d.line ?? "", message: d.message });
    } catch (e) {
      repos.push({ repo: name, ok: false, error: String(e.message ?? e), files: 0, findings: 0, ms: Math.round(performance.now() - t0) });
      log(`CRASH ${name}: ${e.message}`);
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ toolVersion: VERSION, date: new Date().toISOString(), dir, repos, findings }, null, 2) + "\n");
  // Hand-check sheet: up to N random findings per rule, to fill in `verdict` with tp / fp / unsure.
  const byRule = new Map();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  const lines = ["rule,repo,file,line,message,verdict,notes"];
  for (const [rule, list] of [...byRule].sort()) for (const f of shuffle(list, seed).slice(0, reviewSize)) lines.push([rule, f.repo, f.file, f.line, f.message, "", ""].map(csvEscape).join(","));
  const reviewPath = path.join(path.dirname(out), "review.csv");
  if (fs.existsSync(reviewPath) && !argv.includes("--force")) {
    const alt = reviewPath.replace(/\.csv$/, `.${Date.now()}.csv`);
    fs.writeFileSync(alt, lines.join("\n") + "\n");
    console.log(`review.csv already exists (it may hold your verdicts), so the new sheet was written to ${alt}. Use --force to overwrite.`);
  } else fs.writeFileSync(reviewPath, lines.join("\n") + "\n");
  const crashed = repos.filter((r) => !r.ok).length;
  console.log(`Linted ${repos.length} repositories (${repos.filter((r) => r.files > 0).length} with instruction files), ${findings.length} findings, ${crashed} crashes -> ${out}`);
  console.log(`Hand-check sheet: ${reviewPath}. Open it in a spreadsheet and fill the verdict column with tp (real problem), fp (false positive) or unsure.`);
}

// ---------- report ----------
function report() {
  const resultsFile = opt("results", "corpus/results.json");
  const reviewFile = opt("review", path.join(path.dirname(resultsFile), "review.csv"));
  const outFile = opt("out", path.join(path.dirname(resultsFile), "report.md"));
  const threshold = num("precision", 0.8);
  const data = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  const withFiles = data.repos.filter((r) => r.ok && r.files > 0);
  const crashes = data.repos.filter((r) => !r.ok);
  const grades = {};
  for (const r of withFiles) grades[r.grade] = (grades[r.grade] ?? 0) + 1;
  const perRule = {};
  for (const f of data.findings) {
    const x = (perRule[f.ruleId] ??= { findings: 0, repos: new Set() });
    x.findings++;
    x.repos.add(f.repo);
  }
  const verdicts = {};
  let reviewed = 0;
  if (fs.existsSync(reviewFile)) {
    const rows = parseCsv(fs.readFileSync(reviewFile, "utf8"));
    const header = rows.shift() ?? [];
    const ix = Object.fromEntries(header.map((h, i) => [h, i]));
    for (const row of rows) {
      const v = (row[ix.verdict] ?? "").trim().toLowerCase();
      if (!["tp", "fp", "unsure"].includes(v)) continue;
      reviewed++;
      const x = (verdicts[row[ix.rule]] ??= { tp: 0, fp: 0, unsure: 0 });
      x[v]++;
    }
  }
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
  const md = [];
  md.push(`# Obelos corpus run`, "", `Tool version ${data.toolVersion}, run ${data.date.slice(0, 10)}, folder \`${data.dir}\`.`, "");
  md.push("## Coverage", "", `- Repositories: ${data.repos.length}; with agent instruction files: ${withFiles.length} (${pct(withFiles.length, data.repos.length)}).`, `- Crashes: ${crashes.length}${crashes.length ? ` (${crashes.map((c) => c.repo).join(", ")})` : ""}. Gate target: 0.`, `- Median score: ${median(withFiles.map((r) => r.score)) ?? "n/a"}; grades: ${Object.entries(grades).sort().map(([g, n]) => `${g}=${n}`).join(" ") || "n/a"}.`, `- Median instruction size: ${median(withFiles.map((r) => r.tokens)) ?? "n/a"} estimated tokens; median run time per repository: ${median(data.repos.map((r) => r.ms))} ms.`, "");
  md.push("## Findings by rule", "", "| Rule | Findings | Repos affected | Hit rate | Reviewed | Precision | Verdict |", "|---|---|---|---|---|---|---|");
  const failing = [];
  for (const id of Object.keys(perRule).sort()) {
    const x = perRule[id];
    const v = verdicts[id];
    const decided = v ? v.tp + v.fp : 0;
    const prec = decided ? v.tp / decided : null;
    let verdict = "needs review";
    if (prec !== null && decided >= 10) verdict = prec >= threshold ? "ok" : "BELOW TARGET";
    else if (prec !== null) verdict = `too few verdicts (${decided}/10)`;
    if (verdict === "BELOW TARGET") failing.push(id);
    md.push(`| ${id} | ${x.findings} | ${x.repos.size} | ${pct(x.repos.size, withFiles.length)} | ${v ? v.tp + v.fp + v.unsure : 0} | ${prec === null ? "n/a" : pct(v.tp, decided)} | ${verdict} |`);
  }
  md.push("", `Precision = true positives / (true positives + false positives) among hand-checked findings; "unsure" is excluded. Target ${Math.round(threshold * 100)}% with at least 10 verdicts per rule (backlog CO-020). Hit rate = share of repositories with instruction files where the rule fired at least once.`, "");
  md.push("## Accuracy checklist", "", `- [${crashes.length === 0 ? "x" : " "}] No crashes`, `- [${withFiles.length >= 100 ? "x" : " "}] At least 100 repositories with instruction files (have ${withFiles.length})`, `- [${reviewed >= 20 * Math.min(Object.keys(perRule).length, 10) ? "x" : " "}] Hand-checked findings recorded (${reviewed})`, `- [${failing.length === 0 && reviewed > 0 ? "x" : " "}] Every reviewed rule at or above ${Math.round(threshold * 100)}% precision${failing.length ? ` (below: ${failing.join(", ")}; demote to info or fix)` : ""}`, "", "Limits of this study: repositories were found through GitHub code search and favour popular, recently active projects; one reviewer judged the findings; instruction files change fast.", "");
  fs.writeFileSync(outFile, md.join("\n"));
  console.log(md.join("\n"));
  console.log(`\n(written to ${outFile})`);
}

// ---------- main ----------
const help = `Obelos corpus runner. Commands: sample, fetch, run, report, help. See the header of scripts/corpus.mjs or docs/TESTING.md.`;
try {
  if (cmd === "sample") await sample();
  else if (cmd === "fetch") await fetchRepos();
  else if (cmd === "run") await runCorpus();
  else if (cmd === "report") report();
  else console.log(help);
} catch (e) {
  console.error(`corpus: ${e.message}`);
  process.exit(1);
}
