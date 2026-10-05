#!/usr/bin/env node
// End-to-end smoke test of every Obelos feature, one scenario per feature.
// Builds throw-away repositories at runtime (so nothing with secret-like strings is ever committed),
// runs the built CLI (dist/cli.js) and prints a checklist. Cross-platform: Node 20+.
//
//   npm run build && node scripts/smoke.mjs            run everything
//   node scripts/smoke.mjs --only secrets,baseline     run some scenarios (comma separated, substring match)
//   node scripts/smoke.mjs --list                      list scenario names
//   node scripts/smoke.mjs --keep                      keep the fixture folders and print their paths
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "..", "dist", "cli.js");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const keep = flag("--keep");

if (!fs.existsSync(CLI)) {
  console.error("dist/cli.js not found. Run `npm run build` first.");
  process.exit(2);
}

const GOOD = "# Project\n\nRun `npm test` before committing.\nUse tabs for indentation.\nPrefer small functions.\n";
const PKG = JSON.stringify({ scripts: { test: "vitest", build: "tsc", lint: "eslint ." } });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctxops-smoke-"));
let counter = 0;

function repo(files) {
  const root = path.join(tmpRoot, `r${++counter}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}
const run = (cwd, ...a) => {
  const r = spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: "utf8" });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
};
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });

// Credentials built at runtime so no secret-shaped literal is ever committed (GitHub push protection).
const FAKE = {
  stripe: "sk_" + "live_" + "A1b2C3d4E5f6G7h8I9j0",
  github: "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
  jwt: "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0" + "." + "dBjftJeZ4CVPmB92K27uhbUJU1p1r",
};

const scenarios = [];
const scenario = (name, what, fn) => scenarios.push({ name, what, fn });
const has = (out, s) => out.includes(s);

scenario("clean-repo", "A healthy repo scores 100 and exits 0", () => {
  const d = repo({ "AGENTS.md": GOOD, "CLAUDE.md": "@AGENTS.md\n\n# Notes\n\n- one\n- two\n", "package.json": PKG });
  const r = run(d, "lint");
  return [[r.code === 0, `exit ${r.code}, want 0`], [has(r.out, "100/100"), "score 100/100"]];
});
scenario("broken-references", "OBL003 broken import, OBL004 missing path, OBL005 missing script", () => {
  const d = repo({ "CLAUDE.md": GOOD + "@docs/nope.md\nSee `src/ghost.ts`.\nRun `npm run deploy`.\n", "package.json": PKG });
  const r = run(d, "lint");
  return [[r.code === 1, `exit ${r.code}, want 1 (OBL003 is an error)`], ...["OBL003", "OBL004", "OBL005"].map((id) => [has(r.out, id), `reports ${id}`])];
});
scenario("claude-ignores-agents", "OBL006: CLAUDE.md that does not import AGENTS.md", () => {
  const d = repo({ "AGENTS.md": GOOD, "CLAUDE.md": GOOD });
  const r = run(d, "lint");
  return [[has(r.out, "OBL006"), "reports OBL006"], [r.code === 0, "warning only, exit 0"]];
});
scenario("fail-on", "--fail-on warn turns warnings into exit 1; --fail-on never forces 0", () => {
  const d = repo({ "AGENTS.md": GOOD, "CLAUDE.md": GOOD });
  return [[run(d, "lint", "--fail-on", "warn").code === 1, "--fail-on warn exits 1"], [run(d, "lint", "--fail-on", "never").code === 0, "--fail-on never exits 0"], [run(d, "lint", "--max-warnings", "0").code === 1, "--max-warnings 0 exits 1"]];
});
scenario("secrets", "OBL013 detects several credential formats and never prints the value", () => {
  const d = repo({ "AGENTS.md": `${GOOD}stripe: ${FAKE.stripe}\ntoken ${FAKE.github}\njwt ${FAKE.jwt}\nDB postgres://admin:Tr0ub4dor7x@db.internal/app\n` });
  const r = run(d, "lint");
  const count = (r.out.match(/OBL013/g) ?? []).length;
  return [[r.code === 1, `exit ${r.code}, want 1`], [count >= 4, `${count} secret findings, want 4 or more`], [!has(r.out, FAKE.stripe.slice(0, 14)) && !has(r.out, "Tr0ub4dor7x"), "no secret value printed"]];
});
scenario("secrets-allowlist", "OBL013 allow list silences a known-safe line", () => {
  const line = "token = Zq8wX2vL9mP4nR7tY1uK5\n";
  const a = repo({ "AGENTS.md": GOOD + line });
  const b = repo({ "AGENTS.md": GOOD + line, "obelos.config.json": JSON.stringify({ rules: { OBL013: ["error", { allow: ["Zq8wX2"] }] } }) });
  return [[has(run(a, "lint").out, "OBL013"), "flagged without allow list"], [!has(run(b, "lint").out, "OBL013"), "silent with allow list"]];
});
scenario("inline-suppression", "obelos-disable-next-line hides a finding and counts it", () => {
  const d = repo({ "AGENTS.md": GOOD + "<!-- obelos-disable-next-line OBL012 -->\nWrite clean code.\n" });
  const r = run(d, "lint", "-f", "json");
  const j = JSON.parse(r.stdout);
  return [[!j.diagnostics.some((x) => x.ruleId === "OBL012"), "OBL012 hidden"], [j.suppressed === 1, `suppressed=${j.suppressed}, want 1`]];
});
scenario("expiring-suppression", "until= date: applies before, expires after (OBL018)", () => {
  const d = repo({ "AGENTS.md": GOOD + '<!-- obelos-disable-next-line OBL012 until=2026-06-30 reason="rewrite later" -->\nWrite clean code.\n' });
  const before = run(d, "lint", "--today", "2026-06-30");
  const after = run(d, "lint", "--today", "2026-07-01");
  const list = run(d, "suppressions", "--today", "2026-07-01");
  return [[!has(before.out, "OBL012"), "hidden on the last valid day"], [has(after.out, "OBL018") && has(after.out, "OBL012"), "expired: OBL018 and OBL012 both appear"], [has(list.out, "EXPIRED"), "`suppressions` marks it EXPIRED"]];
});
scenario("baseline", "Adopt with a baseline: old findings hidden, new ones shown", () => {
  const d = repo({ "AGENTS.md": GOOD + "Write clean code.\n" });
  const b = run(d, "baseline");
  const hidden = run(d, "lint", "--baseline", "obelos.baseline.json");
  fs.appendFileSync(path.join(d, "AGENTS.md"), "Follow best practices.\n");
  const fresh = run(d, "lint", "--baseline", "obelos.baseline.json");
  return [[b.code === 0 && fs.existsSync(path.join(d, "obelos.baseline.json")), "baseline file written"], [!has(hidden.out, "OBL012"), "old finding hidden"], [fresh.out.toLowerCase().includes("follow best practices"), "new finding visible"]];
});
scenario("presets", "extends obelos:strict raises severities; obelos:minimal switches advisories off", () => {
  const files = { "AGENTS.md": GOOD + "Write clean code.\n" };
  const strict = run(repo({ ...files, "obelos.config.json": JSON.stringify({ extends: "obelos:strict" }) }), "lint");
  const minimal = run(repo({ ...files, "obelos.config.json": JSON.stringify({ extends: "obelos:minimal" }) }), "lint");
  return [[/warn\s+OBL012/.test(strict.out), "strict: OBL012 is a warning"], [!has(minimal.out, "OBL012"), "minimal: OBL012 off"]];
});
scenario("monorepo-cascade", "A nested config changes rules for its subtree only", () => {
  const d = repo({ "AGENTS.md": GOOD + "Write clean code.\n", "pkg/AGENTS.md": GOOD + "Write clean code.\n", "pkg/obelos.config.json": JSON.stringify({ rules: { OBL012: "off" } }) });
  const on = run(d, "lint", "-f", "json");
  const j = JSON.parse(on.stdout);
  const files = j.diagnostics.filter((x) => x.ruleId === "OBL012").map((x) => x.file);
  const off = JSON.parse(run(d, "lint", "-f", "json", "--no-cascade").stdout).diagnostics.filter((x) => x.ruleId === "OBL012").length;
  return [[files.length === 1 && files[0] === "AGENTS.md", `OBL012 only at root (${files.join(",")})`], [off === 2, `--no-cascade restores both (${off})`]];
});
scenario("policies", "Policy as code: require, forbid, requireHeading", () => {
  const cfg = { policies: [{ id: "security", requireHeading: "Security", severity: "error" }, { id: "no-todo", forbid: "\\bTODO\\b", severity: "warn" }] };
  const d = repo({ "AGENTS.md": GOOD + "TODO later\n", "obelos.config.json": JSON.stringify(cfg) });
  const r = run(d, "lint");
  return [[has(r.out, "POL-SECURITY") && has(r.out, "POL-NO-TODO"), "both policies fire"], [r.code === 1, "error policy fails the run"]];
});
scenario("config-errors", "Bad config exits 2 with a clear message; unknown rule IDs are flagged", () => {
  const a = run(repo({ "AGENTS.md": GOOD, "obelos.config.json": '{"rules":{"OBL001":"loud"}}' }), "lint");
  const b = run(repo({ "AGENTS.md": GOOD, "obelos.config.json": '{"nope":1}' }), "lint");
  const c = run(repo({ "AGENTS.md": GOOD, "obelos.config.json": '{"rules":{"OBL999":"off"}}' }), "lint");
  return [[a.code === 2 && has(a.out, "Invalid severity"), "invalid severity exits 2"], [b.code === 2 && has(b.out, "Unknown config key"), "unknown key exits 2"], [has(c.out, "unknown rule OBL999"), "unknown rule ID noticed"]];
});
scenario("limits-encoding", "Oversized and binary files are skipped with a notice; UTF-16 is read", () => {
  const d = repo({ "AGENTS.md": GOOD, "big/AGENTS.md": "x".repeat(3000), "obelos.config.json": JSON.stringify({ limits: { maxFileBytes: 2000 } }) });
  fs.mkdirSync(path.join(d, "bin"));
  fs.writeFileSync(path.join(d, "bin", "CLAUDE.md"), Buffer.from([0x23, 0x20, 0x00, 0x01]));
  const u = repo({});
  fs.writeFileSync(path.join(u, "AGENTS.md"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(GOOD, "utf16le")]));
  const r = run(d, "lint", "--verbose");
  const r2 = run(u, "lint", "--verbose");
  return [[has(r.out, "maxFileBytes"), "oversized file skipped"], [has(r.out, "NUL bytes"), "binary file skipped"], [has(r2.out, "AGENTS.md (agents-md)"), "UTF-16 file discovered and parsed"]];
});
scenario("changed-only", "--changed-only and --since limit findings to what git says changed", () => {
  const d = repo({ "AGENTS.md": GOOD + "Write clean code.\n", "pkg/AGENTS.md": GOOD + "Write clean code.\n" });
  git(d, "init", "-q", "-b", "main");
  git(d, "add", ".");
  git(d, "commit", "-q", "-m", "init");
  fs.appendFileSync(path.join(d, "pkg", "AGENTS.md"), "Be careful.\n");
  const r = run(d, "lint", "--changed-only", "-f", "json");
  const j = JSON.parse(r.stdout);
  const only = j.diagnostics.every((x) => x.file === "pkg/AGENTS.md") && j.diagnostics.length > 0;
  git(d, "commit", "-qam", "edit");
  const s = run(d, "lint", "--since", "HEAD~1", "-f", "json");
  const nogit = run(repo({ "AGENTS.md": GOOD }), "lint", "--changed-only");
  return [[only && j.scope?.mode === "changed", "only the changed file's findings"], [s.code === 0 && JSON.parse(s.stdout).diagnostics.every((x) => x.file === "pkg/AGENTS.md"), "--since HEAD~1 works"], [nogit.code === 2 && has(nogit.out, "not inside a git repository"), "outside git: exit 2 with a clear message"]];
});
scenario("resolve-budget", "resolve shows which files apply; budget counts tokens and follows imports", () => {
  const d = repo({ "CLAUDE.md": "@AGENTS.md\nnotes\nnotes\n", "AGENTS.md": GOOD, ".cursor/rules/a.mdc": "---\nalwaysApply: true\n---\nrule\nrule\nrule\n" });
  const r = run(d, "resolve", "src/app.ts");
  const b = run(d, "budget", "src/app.ts");
  const gate = run(d, "budget", "src/app.ts", "--max-tokens", "1");
  return [[has(r.out, "claude") && has(r.out, "CLAUDE.md") && has(r.out, "AGENTS.md"), "resolve lists files per tool"], [has(b.out, "always loaded"), "budget prints per-tool totals"], [gate.code === 1, "--max-tokens gate exits 1"]];
});
scenario("init", "init detects commands, dry-runs by default, never overwrites", () => {
  const d = repo({ "package.json": PKG, "pnpm-lock.yaml": "" });
  const dry = run(d, "init");
  const wrote = fs.existsSync(path.join(d, "AGENTS.md"));
  const w = run(d, "init", "--write");
  const content = fs.readFileSync(path.join(d, "AGENTS.md"), "utf8");
  const again = run(d, "init", "--write");
  const lintOut = run(d, "lint");
  return [[has(dry.out, "pnpm test") && !wrote, "dry run shows pnpm commands, writes nothing"], [w.code === 0 && has(content, "pnpm build"), "--write creates AGENTS.md with detected commands"], [has(again.out, "skip") && again.code === 0, "second run skips existing files"], [lintOut.code === 0, "generated files lint without errors"]];
});
scenario("reporters", "json, sarif, junit, checkstyle, markdown and github all render", () => {
  const d = repo({ "AGENTS.md": GOOD + "Write clean code.\n", "CLAUDE.md": GOOD });
  const json = JSON.parse(run(d, "lint", "-f", "json").stdout);
  const sarif = JSON.parse(run(d, "lint", "-f", "sarif").stdout);
  const junit = run(d, "lint", "-f", "junit").stdout;
  const cs = run(d, "lint", "-f", "checkstyle").stdout;
  const md = run(d, "lint", "-f", "markdown").stdout;
  const gh = run(d, "lint", "-f", "github").stdout;
  const bad = run(d, "lint", "-f", "nope");
  return [[json.version === 1 && Array.isArray(json.diagnostics), "json v1"], [sarif.version === "2.1.0" && sarif.runs[0].results.length > 0, "sarif 2.1.0 with results"], [junit.includes("<testsuites"), "junit"], [cs.includes("<checkstyle"), "checkstyle"], [md.length > 20, "markdown"], [/^::(warning|error|notice)/m.test(gh), "github annotations"], [bad.code === 2, "unknown format exits 2"]];
});
scenario("badge-history", "badge SVG and shields JSON; history records and shows a trend", () => {
  const d = repo({ "AGENTS.md": GOOD });
  const svg = run(d, "badge").stdout;
  const sh = JSON.parse(run(d, "badge", "--shields").stdout);
  run(d, "history", "--record", "--today", "2026-10-01");
  run(d, "history", "--record", "--today", "2026-10-02", "--label", "abc");
  const h = run(d, "history");
  return [[svg.startsWith("<svg"), "SVG badge"], [sh.schemaVersion === 1 && /100\/100/.test(sh.message), "shields JSON"], [has(h.out, "Score trend") && has(h.out, "2026-10-02"), "history shows both entries"]];
});
scenario("scan", "scan lints many repos and summarises", () => {
  const parent = repo({ "a/AGENTS.md": GOOD, "b/AGENTS.md": GOOD + "Write clean code.\n", "c/README.md": "x" });
  const r = run(parent, "scan", ".");
  return [[has(r.out, "3 repositories") && has(r.out, "2 have agent"), "counts repos"], [has(r.out, "OBL012=1"), "findings per rule"]];
});
scenario("explain-rules-config", "explain, rules --json and config work", () => {
  const d = repo({ "AGENTS.md": GOOD });
  const e = run(d, "explain", "OBL006");
  const bad = run(d, "explain", "OBL9999");
  const rules = JSON.parse(run(d, "rules", "--json").stdout);
  const cfg = run(d, "config");
  return [[has(e.out, "Why:") && has(e.out, "Fix:"), "explain prints why and fix"], [bad.code === 2, "unknown rule exits 2"], [rules.length >= 22, `${rules.length} rules listed`], [has(cfg.out, '"limits"'), "config prints effective settings"]];
});
scenario("inspect", "inspect lists files with sizes", () => {
  const d = repo({ "AGENTS.md": GOOD, ".github/copilot-instructions.md": GOOD });
  const r = run(d, "inspect");
  return [[has(r.out, "agents-md") && has(r.out, "copilot-repo"), "both files listed"]];
});

const list = flag("--list");
const chosen = scenarios.filter((s) => !only || only.some((o) => s.name.includes(o)));
if (list) {
  for (const s of scenarios) console.log(`${s.name.padEnd(22)} ${s.what}`);
  process.exit(0);
}

let failed = 0;
console.log(`Obelos smoke test (${chosen.length} scenarios), CLI: ${CLI}\n`);
for (const s of chosen) {
  let results;
  try {
    results = s.fn();
  } catch (e) {
    results = [[false, `scenario crashed: ${e.message}`]];
  }
  const bad = results.filter(([ok]) => !ok);
  failed += bad.length;
  console.log(`${bad.length ? "FAIL" : "PASS"}  ${s.name} - ${s.what}`);
  for (const [ok, msg] of results) if (!ok) console.log(`        x ${msg}`);
}
console.log(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`}`);
if (keep) console.log(`Fixtures kept in ${tmpRoot}`);
else fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
