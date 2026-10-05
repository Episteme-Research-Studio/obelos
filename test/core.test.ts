import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { lint } from "../src/core/runner.js";
import { mergeConfig, loadConfig } from "../src/core/config.js";
import { memoryFs, decode } from "../src/core/fs.js";
import { ObelosError, EXIT, exitCodeFor } from "../src/core/errors.js";
import { changedPaths } from "../src/core/git.js";
import { extractDisables } from "../src/core/parse.js";
import { formatCheckstyle, formatJunit } from "../src/report/xml.js";
import { getReporter, registerReporter, reporterNames } from "../src/report/index.js";
import { makeRepo, repeat } from "./helpers.js";

const ids = (r: ReturnType<typeof lint>) => r.diagnostics.map((d) => d.ruleId);
const GOOD = "# P\n\nRun `npm test` before committing.\nUse tabs.\nPrefer small functions.\n";

describe("typed errors and exit codes", () => {
  it("maps codes to the documented exit contract", () => {
    expect(new ObelosError("CONFIG_INVALID", "x").exitCode).toBe(EXIT.USAGE);
    expect(new ObelosError("LIMIT_EXCEEDED", "x").exitCode).toBe(EXIT.INTERNAL);
    expect(exitCodeFor(new Error("boom"))).toBe(EXIT.INTERNAL);
  });
  it("config problems are typed errors", () => {
    expect(() => mergeConfig({ rules: { OBL001: "loud" } })).toThrow(ObelosError);
    expect(() => mergeConfig({ nope: 1 })).toThrow(/Unknown config key "nope"/);
    expect(() => mergeConfig({ rules: { FOO: "off" } })).toThrow(/Unknown rule ID/);
    expect(() => loadConfig("/tmp", "/definitely/missing.json")).toThrow(/not found/);
  });
});

describe("config extends, presets and per-rule options", () => {
  it("strict preset raises severities, minimal switches heuristics off", () => {
    const files = { "AGENTS.md": GOOD + "Write clean code.\n" };
    const base = lint(makeRepo(files));
    expect(base.diagnostics.find((d) => d.ruleId === "OBL012")?.severity).toBe("info");
    const strict = lint(makeRepo(files), { config: mergeConfig({ extends: "obelos:strict" }) });
    expect(strict.diagnostics.find((d) => d.ruleId === "OBL012")?.severity).toBe("warn");
    const minimal = lint(makeRepo(files), { config: mergeConfig({ extends: ["obelos:minimal"] }) });
    expect(ids(minimal)).not.toContain("OBL012");
  });
  it("own rules override extended ones; unknown presets fail", () => {
    const c = mergeConfig({ extends: "obelos:strict", rules: { OBL012: "off" } });
    expect(c.rules.OBL012).toBe("off");
    expect(() => mergeConfig({ extends: "obelos:wild" })).toThrow(/Unknown preset/);
  });
  it("extends a shared file by relative path and detects cycles", () => {
    const root = makeRepo({
      "org/base.json": JSON.stringify({ rules: { OBL012: "error" }, ignore: ["vendor/**"] }),
      "obelos.config.json": JSON.stringify({ extends: "./org/base.json", rules: { OBL014: "off" } }),
      "a.json": JSON.stringify({ extends: "./b.json" }),
      "b.json": JSON.stringify({ extends: "./a.json" }),
    });
    const c = loadConfig(root);
    expect(c.rules.OBL012).toBe("error");
    expect(c.rules.OBL014).toBe("off");
    expect(c.ignore).toContain("vendor/**");
    expect(c.sources.length).toBe(2);
    expect(() => loadConfig(root, path.join(root, "a.json"))).toThrow(/Circular/);
  });
  it("supports [severity, options] and uses options in rules", () => {
    const c = mergeConfig({ rules: { OBL027: ["warn", { max: 1 }] } });
    expect(c.rules.OBL027).toBe("warn");
    expect(c.ruleOptions.OBL027).toEqual({ max: 1 });
    const r = lint(makeRepo({ "AGENTS.md": GOOD + "ALWAYS test. NEVER skip. MUST lint.\n" }), { config: c });
    expect(r.diagnostics.find((d) => d.ruleId === "OBL027")?.severity).toBe("warn");
  });
});

describe("monorepo config cascade", () => {
  it("a nested config changes severities and ignores only its subtree", () => {
    const files = {
      "AGENTS.md": GOOD + "Write clean code.\n",
      "packages/a/AGENTS.md": GOOD + "Write clean code.\n",
      "packages/a/obelos.config.json": JSON.stringify({ rules: { OBL012: "off" } }),
      "packages/b/AGENTS.md": GOOD + "Write clean code.\n",
      "packages/b/obelos.config.json": JSON.stringify({ rules: { OBL012: "error" } }),
    };
    const r = lint(makeRepo(files));
    const at = (f: string) => r.diagnostics.filter((d) => d.file === f && d.ruleId === "OBL012");
    expect(at("AGENTS.md")[0]?.severity).toBe("info");
    expect(at("packages/a/AGENTS.md")).toHaveLength(0);
    expect(at("packages/b/AGENTS.md")[0]?.severity).toBe("error");
    const off = lint(makeRepo(files), { cascade: false });
    expect(off.diagnostics.filter((d) => d.ruleId === "OBL012")).toHaveLength(3);
  });
});

describe("expiring suppressions", () => {
  const text = "<!-- obelos-disable-next-line OBL012 until=2026-06-30 reason=\"rewrite after v2\" -->\nWrite clean code.\n";
  it("parses until and reason", () => {
    const d = extractDisables(text.split("\n"), "2026-01-01");
    expect(d.entries[0]).toMatchObject({ until: "2026-06-30", reason: "rewrite after v2" });
    expect(d.expired).toHaveLength(0);
  });
  it("applies before the date and stops after it, reporting OBL018", () => {
    const body = GOOD + text;
    const before = lint(makeRepo({ "AGENTS.md": body }), { today: "2026-06-30" });
    expect(ids(before)).not.toContain("OBL012");
    expect(ids(before)).not.toContain("OBL018");
    const after = lint(makeRepo({ "AGENTS.md": body }), { today: "2026-07-01" });
    expect(ids(after)).toContain("OBL012");
    expect(after.diagnostics.find((d) => d.ruleId === "OBL018")?.message).toMatch(/expired on 2026-06-30/);
  });
});

describe("hard limits and encoding guards", () => {
  it("skips oversized and binary files with a notice, and keeps going", () => {
    const root = makeRepo({ "AGENTS.md": GOOD, "sub/AGENTS.md": "x".repeat(3000) });
    fs.mkdirSync(path.join(root, "bin"));
    fs.writeFileSync(path.join(root, "bin/CLAUDE.md"), Buffer.from([0x23, 0x20, 0x00, 0x01, 0x02]));
    const r = lint(root, { config: mergeConfig({ limits: { maxFileBytes: 2000 } }) });
    const notices = r.diagnostics.filter((d) => d.ruleId === "OBL000").map((d) => d.message);
    expect(notices.some((m) => /exceeds limits.maxFileBytes/.test(m))).toBe(true);
    expect(notices.some((m) => /NUL bytes/.test(m))).toBe(true);
    expect(r.files.map((f) => f.path)).toEqual(["AGENTS.md"]);
  });
  it("caps the number of instruction files", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`p${i}/AGENTS.md`] = GOOD;
    const r = lint(makeRepo(files), { config: mergeConfig({ limits: { maxInstructionFiles: 2 } }) });
    expect(r.files).toHaveLength(2);
    expect(r.diagnostics.filter((d) => /maxInstructionFiles/.test(d.message))).toHaveLength(3);
  });
  it("decodes BOMs and UTF-16", () => {
    expect(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Hi")]))).toEqual({ text: "# Hi" });
    expect(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# Hi", "utf16le")]))).toEqual({ text: "# Hi" });
    const be = Buffer.from("# Hi", "utf16le");
    be.swap16();
    expect(decode(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toEqual({ text: "# Hi" });
  });
  it.skipIf(process.platform === "win32")("does not loop on symlink cycles and handles dangling links", () => {
    const root = makeRepo({ "AGENTS.md": GOOD, "a/x.txt": "1" });
    fs.symlinkSync(root, path.join(root, "a/loop"), "dir");
    fs.symlinkSync(path.join(root, "missing.md"), path.join(root, "CLAUDE.md"));
    const r = lint(root);
    expect(r.files.map((f) => f.path)).toContain("AGENTS.md");
  });
  it("stops with a notice when the time limit is hit", () => {
    const r = lint(makeRepo({ "AGENTS.md": GOOD }), { config: mergeConfig({ limits: { timeoutMs: 0.0001 } }) });
    expect(r.diagnostics.some((d) => /Time limit/.test(d.message))).toBe(true);
  });
  it("flags unknown rule IDs in config instead of ignoring typos", () => {
    const r = lint(makeRepo({ "AGENTS.md": GOOD }), { config: mergeConfig({ rules: { OBL999: "off" } }) });
    expect(r.diagnostics.some((d) => /unknown rule OBL999/.test(d.message))).toBe(true);
  });
});

describe("virtual file system seam", () => {
  it("lints an in-memory workspace with no disk access", () => {
    const fsys = memoryFs({ "CLAUDE.md": "See @docs/missing.md\n" + GOOD, "AGENTS.md": GOOD, "package.json": '{"scripts":{"test":"x"}}', "docs/real.md": "hi" });
    const r = lint("/virtual", { fs: fsys });
    expect(ids(r)).toContain("OBL003");
    expect(r.files.map((f) => f.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });
  it("import depth, scripts and gitignore checks all go through the seam", () => {
    const fsys = memoryFs({
      "CLAUDE.md": "@a.md\nRun `npm run nope`.\n",
      "CLAUDE.local.md": "me\nme\nme\n",
      "a.md": "@b.md",
      "b.md": "@c.md",
      "c.md": "@d.md",
      "d.md": "@e.md",
      "e.md": "end",
      "package.json": '{"scripts":{"test":"x"}}',
    });
    const r = lint("/virtual", { fs: fsys });
    expect(ids(r)).toEqual(expect.arrayContaining(["OBL003", "OBL005", "OBL017"]));
  });
  it("rules never import fs", () => {
    for (const f of fs.readdirSync("src/rules")) expect(fs.readFileSync(path.join("src/rules", f), "utf8")).not.toMatch(/node:fs|from "fs"/);
  });
});

describe("changed-only", () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  function repo() {
    const root = makeRepo({ "AGENTS.md": GOOD + "Write clean code.\n", "pkg/AGENTS.md": GOOD + "Write clean code.\n" });
    sh(root, "init", "-q", "-b", "main");
    sh(root, "-c", "user.email=a@b.c", "-c", "user.name=t", "add", ".");
    sh(root, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "init");
    return root;
  }
  it("reports only findings affected by working-tree changes", () => {
    const root = repo();
    fs.appendFileSync(path.join(root, "pkg/AGENTS.md"), "Be concise.\n");
    const changed = changedPaths(root);
    expect([...changed]).toEqual(["pkg/AGENTS.md"]);
    const r = lint(root, { changed });
    expect(r.diagnostics.every((d) => d.file === "pkg/AGENTS.md")).toBe(true);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.scope?.mode).toBe("changed");
  });
  it("includes files whose references point at a deleted or changed path", () => {
    const root = makeRepo({ "AGENTS.md": GOOD + "See `docs/guide.md`.\n", "docs/guide.md": "g", "other/AGENTS.md": GOOD });
    sh(root, "init", "-q", "-b", "main");
    sh(root, "-c", "user.email=a@b.c", "-c", "user.name=t", "add", ".");
    sh(root, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "init");
    fs.rmSync(path.join(root, "docs/guide.md"));
    const r = lint(root, { changed: changedPaths(root) });
    expect(r.diagnostics.some((d) => d.ruleId === "OBL004" && d.file === "AGENTS.md")).toBe(true);
  });
  it("supports --since and rejects option-like refs and non-repos", () => {
    const root = repo();
    fs.writeFileSync(path.join(root, "pkg/AGENTS.md"), GOOD + "New.\n");
    sh(root, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qam", "edit");
    expect([...changedPaths(root, "HEAD~1")]).toContain("pkg/AGENTS.md");
    expect(() => changedPaths(root, "--output=x")).toThrow(/Invalid git ref/);
    expect(() => changedPaths(makeRepo({ "a.txt": "x" }))).toThrow(/not inside a git repository/);
  });
});

describe("reporters", () => {
  const result = () => lint(makeRepo({ "AGENTS.md": GOOD + "Write clean code & <tags>.\n", "CLAUDE.md": "x\ny\nz\n" }));
  it("junit and checkstyle emit escaped, well-formed XML", () => {
    const j = formatJunit(result());
    expect(j).toContain("<testsuites");
    expect(j).toContain("&quot;");
    expect(j.match(/<testsuite /g)?.length).toBe(2);
    const c = formatCheckstyle(result());
    expect(c).toContain('<checkstyle version="4.3"');
    expect(c).toContain('source="obelos.OBL');
  });
  it("registry lists builtins and accepts custom reporters", () => {
    expect(reporterNames()).toEqual(expect.arrayContaining(["text", "json", "sarif", "markdown", "github", "junit", "checkstyle"]));
    registerReporter("count", (r) => String(r.diagnostics.length));
    expect(getReporter("count")!(result(), { color: false })).toMatch(/^\d+$/);
    expect(() => registerReporter("Bad Name", () => "")).toThrow();
  });
  it("lint stats record timings and config sources", () => {
    const r = lint(makeRepo({ "AGENTS.md": GOOD }));
    expect(r.stats.filesDiscovered).toBe(1);
    expect(r.stats.rules.length).toBeGreaterThan(10);
    expect(r.stats.totalMs).toBeGreaterThanOrEqual(0);
  });
});

describe("CLI contract", () => {
  const run = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.resolve("node_modules/tsx/dist/esm/index.mjs")).href, path.resolve("src/cli.ts"), ...args], { cwd, encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  it("exits 0 clean, 1 on findings, 2 on bad config or usage", () => {
    expect(run(makeRepo({ "AGENTS.md": GOOD }), "lint").code).toBe(0);
    expect(run(makeRepo({ "AGENTS.md": "token = ghp_" + "b".repeat(36) + "\n" }), "lint").code).toBe(1);
    expect(run(makeRepo({ "AGENTS.md": GOOD, "obelos.config.json": "{" }), "lint").code).toBe(2);
    expect(run(makeRepo({ "AGENTS.md": GOOD }), "lint", "--fail-on", "bogus").code).toBe(2);
    expect(run(makeRepo({ "AGENTS.md": GOOD }), "lint", "-f", "nope").code).toBe(2);
  }, 60_000);
  it("--debug prints a stack and --verbose prints timings", () => {
    const root = makeRepo({ "AGENTS.md": GOOD });
    expect(run(root, "--debug", "lint", "--baseline", "missing.json").out).toMatch(/at /);
    expect(run(root, "lint", "--verbose").out).toMatch(/\[obelos\] 1 instruction files/);
  }, 60_000);
});

void repeat;
