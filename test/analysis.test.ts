import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { lint } from "../src/core/runner.js";
import { mergeConfig } from "../src/core/config.js";
import { createWorkspace, discoverAll } from "../src/core/discover.js";
import { memoryFs, diskFs } from "../src/core/fs.js";
import { computeBudget } from "../src/core/budget.js";
import { detectStack } from "../src/core/stack.js";
import { planInit } from "../src/core/init.js";
import { badgeSvg, shieldsJson } from "../src/core/badge.js";
import { entryFrom, formatHistory, readHistory, recordHistory } from "../src/core/history.js";
import { scan } from "../src/core/scan.js";
import { entropy } from "../src/rules/quality.js";
import { formatJson } from "../src/report/json.js";
import { makeRepo, repeat } from "./helpers.js";

const GOOD = "# P\n\nRun `npm test` before committing.\nUse tabs.\nPrefer small functions.\n";
const ids = (r: ReturnType<typeof lint>) => r.diagnostics.map((d) => d.ruleId);
const cfg = (c: unknown) => mergeConfig(c);

describe("policy as code", () => {
  it("require, forbid and requireHeading report under POL-<ID>", () => {
    const config = cfg({
      policies: [
        { id: "has-security", requireHeading: "Security", severity: "error", message: "Every AGENTS.md needs a Security section." },
        { id: "no-todo", forbid: "\\bTODO\\b", severity: "warn" },
        { id: "mentions-tests", require: "npm test", severity: "info" },
      ],
    });
    const r = lint(makeRepo({ "AGENTS.md": GOOD + "TODO fix\n" }), { config });
    const d = (id: string) => r.diagnostics.filter((x) => x.ruleId === id);
    expect(d("POL-HAS-SECURITY")[0]).toMatchObject({ severity: "error", message: "Every AGENTS.md needs a Security section." });
    expect(d("POL-NO-TODO")[0]?.line).toBe(6);
    expect(d("POL-MENTIONS-TESTS")).toHaveLength(0);
    const ok = lint(makeRepo({ "AGENTS.md": GOOD + "\n## Security\n\nNever commit keys.\n" }), { config });
    expect(ids(ok)).not.toContain("POL-HAS-SECURITY");
  });
  it("policies can be scoped by files and tools, re-levelled, suppressed and turned off", () => {
    const policies = [{ id: "ban", forbid: "banned", files: ["pkg/**"], tools: ["agents"], severity: "warn" }];
    const files = { "AGENTS.md": GOOD + "banned\n", "pkg/AGENTS.md": GOOD + "banned\n", "pkg/CLAUDE.md": GOOD + "banned\n" };
    const r = lint(makeRepo(files), { config: cfg({ policies }) });
    expect(r.diagnostics.filter((d) => d.ruleId === "POL-BAN").map((d) => d.file)).toEqual(["pkg/AGENTS.md"]);
    const up = lint(makeRepo(files), { config: cfg({ policies, rules: { "POL-BAN": "error" } }) });
    expect(up.diagnostics.find((d) => d.ruleId === "POL-BAN")?.severity).toBe("error");
    const off = lint(makeRepo(files), { config: cfg({ policies, rules: { "POL-BAN": "off" } }) });
    expect(ids(off)).not.toContain("POL-BAN");
    const sup = lint(makeRepo({ "pkg/AGENTS.md": GOOD + "<!-- obelos-disable-next-line POL-BAN -->\nbanned\n" }), { config: cfg({ policies }) });
    expect(ids(sup)).not.toContain("POL-BAN");
    expect(sup.suppressed).toBeGreaterThan(0);
  });
  it("rejects invalid policies at load time", () => {
    expect(() => cfg({ policies: [{ id: "x" }] })).toThrow(/at least one of/);
    expect(() => cfg({ policies: [{ id: "x", forbid: "(" }] })).toThrow(/not a valid regular expression/);
    expect(() => cfg({ policies: [{ id: "bad id", forbid: "a" }] })).toThrow(/id must be/);
    expect(() => cfg({ policies: [{ id: "x", forbid: "a", tools: ["vim"] }] })).toThrow(/tools must be/);
    expect(() => cfg({ policies: [{ id: "x", forbid: "a".repeat(501) }] })).toThrow(/at most 500/);
  });
  it("an org policy file can be shared with extends", () => {
    const root = makeRepo({
      "org/policy.json": JSON.stringify({ policies: [{ id: "org-no-todo", forbid: "TODO", severity: "error" }] }),
      "obelos.config.json": JSON.stringify({ extends: "./org/policy.json" }),
      "AGENTS.md": GOOD + "TODO\n",
    });
    expect(ids(lint(root))).toContain("POL-ORG-NO-TODO");
  });
});

describe("secret detection", () => {
  const scanText = (t: string, config = cfg({})) => lint(makeRepo({ "AGENTS.md": GOOD + t + "\n" }), { config }).diagnostics.filter((d) => d.ruleId === "OBL013");
  it("detects more credential formats without printing them", () => {
    const samples = ["sk_" + "live_" + "A1b2C3d4E5f6G7h8I9j0", "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q", "npm_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" + ".dBjftJeZ4CVPmB92K27uhbUJU1p1r", "https://hooks.slack.com/services/T0ABC123/B0ABC123/abcDEF123xyz456"];
    for (const s of samples) {
      const d = scanText(s);
      expect(d.length, s).toBeGreaterThan(0);
      expect(d.every((x) => !x.message.includes(s.slice(0, 12)))).toBe(true);
    }
    expect(scanText("Connect to postgres://admin:Tr0ub4dor7x@db.internal/app").length).toBe(1);
  });
  it("ignores placeholders, env references and low-entropy values", () => {
    expect(scanText("postgres://user:${DB_PASSWORD}@db/app")).toHaveLength(0);
    expect(scanText("password = aaaaaaaaaaaaaaaaaaaa")).toHaveLength(0);
    expect(scanText("api_key = $API_KEY_FROM_ENV_VARIABLE")).toHaveLength(0);
    expect(entropy("aaaaaaaa")).toBe(0);
    expect(entropy("a1B2c3D4e5F6")).toBeGreaterThan(3);
  });
  it("supports an allow list through rule options", () => {
    const line = "token = Zq8wX2vL9mP4nR7tY1uK5";
    expect(scanText(line)).toHaveLength(1);
    expect(scanText(line, cfg({ rules: { OBL013: ["error", { allow: ["Zq8wX2"] }] } }))).toHaveLength(0);
  });
});

describe("quality hints", () => {
  it("OBL019 asks for build/test commands only when none exist in root files", () => {
    expect(ids(lint(makeRepo({ "AGENTS.md": "# P\n\nBe nice.\nUse tabs.\nShort lines.\n" })))).toContain("OBL019");
    expect(ids(lint(makeRepo({ "AGENTS.md": GOOD })))).not.toContain("OBL019");
    expect(ids(lint(makeRepo({ "pkg/AGENTS.md": "# P\n\nBe nice.\nUse tabs.\nShort.\n" })))).not.toContain("OBL019");
  });
  it("OBL026 flags walls of text and honours options", () => {
    const wall = "word ".repeat(200);
    expect(ids(lint(makeRepo({ "AGENTS.md": GOOD + wall + "\n" })))).toContain("OBL026");
    const para = Array.from({ length: 25 }, () => "A reasonably long sentence about nothing in particular here.").join("\n");
    expect(ids(lint(makeRepo({ "AGENTS.md": GOOD + "\n" + para + "\n" })))).toContain("OBL026");
    expect(ids(lint(makeRepo({ "AGENTS.md": GOOD + wall + "\n" }), { config: cfg({ rules: { OBL026: ["info", { maxLineChars: 5000, maxParagraphChars: 5000 }] } }) }))).not.toContain("OBL026");
  });
  it("OBL027 counts shouting words", () => {
    const body = GOOD + "ALWAYS a. NEVER b. MUST c. IMPORTANT d. CRITICAL e. ALWAYS f. NEVER g. MUST h. ALWAYS i.\n";
    expect(ids(lint(makeRepo({ "AGENTS.md": body })))).toContain("OBL027");
    expect(ids(lint(makeRepo({ "AGENTS.md": GOOD + "ALWAYS a.\n" })))).not.toContain("OBL027");
  });
});

describe("budget", () => {
  const files = {
    "CLAUDE.md": "@AGENTS.md\n" + "c".repeat(400) + "\n",
    "AGENTS.md": "@docs/style.md\n" + "a".repeat(800) + "\n",
    "docs/style.md": "s".repeat(1200),
    ".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\n" + "r".repeat(400),
    ".cursor/rules/maybe.mdc": "---\ndescription: db stuff\n---\n" + "d".repeat(2000),
    ".cursor/rules/manual.mdc": "---\n---\n" + "m".repeat(5000),
  };
  it("counts Claude imports transitively and separates optional Cursor rules", () => {
    const fsys = memoryFs(files);
    const config = cfg({});
    const { files: found } = discoverAll(fsys, config);
    const ws = createWorkspace(fsys, config, "2026-10-04", "/v");
    const b = computeBudget(found, ws, "src/x.ts");
    const claude = b.tools.find((t) => t.tool === "claude")!;
    expect(claude.items.map((i) => i.file)).toEqual(expect.arrayContaining(["CLAUDE.md", "AGENTS.md", "docs/style.md"]));
    expect(claude.items.find((i) => i.file === "docs/style.md")?.certainty).toBe("imported");
    expect(claude.baselineTokens).toBeGreaterThan(450);
    const cursor = b.tools.find((t) => t.tool === "cursor")!;
    expect(cursor.optionalTokens).toBeGreaterThan(400);
    expect(cursor.items.some((i) => i.file.endsWith("manual.mdc"))).toBe(false);
    const big = computeBudget(found, ws, "src/x.ts", 2);
    expect(big.tools.find((t) => t.tool === "claude")!.baselineTokens).toBeGreaterThan(claude.baselineTokens);
  });
});

describe("stack detection and init", () => {
  it("detects node commands from scripts and lockfile", () => {
    const s = detectStack(memoryFs({ "package.json": JSON.stringify({ scripts: { build: "x", test: "x", lint: "x", typecheck: "x" } }), "pnpm-lock.yaml": "", "tsconfig.json": "{}" }));
    expect(s.stacks).toEqual(["TypeScript/Node"]);
    expect(s.packageManager).toBe("pnpm");
    expect(s.commands).toMatchObject({ install: "pnpm install", build: "pnpm build", test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" });
  });
  it("detects python, rust, go and makefile targets, never inventing commands", () => {
    expect(detectStack(memoryFs({ "pyproject.toml": "[tool.ruff]\n", "uv.lock": "", tests: "" })).commands.lint).toBe("uv run ruff check .");
    expect(detectStack(memoryFs({ "Cargo.toml": "" })).commands.test).toBe("cargo test");
    expect(detectStack(memoryFs({ "go.mod": "" })).commands.build).toBe("go build ./...");
    const mk = detectStack(memoryFs({ Makefile: "build:\n\tx\ntest:\n\ty\n.PHONY: a\n" }));
    expect(mk.commands).toMatchObject({ build: "make build", test: "make test" });
    const none = detectStack(memoryFs({ "README.md": "x" }));
    expect(none.commands).toEqual({});
    expect(none.notes[0]).toMatch(/left out rather than guessed/);
  });
  it("planInit never overwrites and its output lints cleanly", () => {
    const fsys = memoryFs({ "package.json": JSON.stringify({ scripts: { test: "x", build: "x" } }), "package-lock.json": "{}" });
    const plan = planInit(fsys, "/work/my-app");
    expect(plan.items.map((i) => i.action)).toEqual(["create", "create"]);
    expect(plan.items[0]!.content).toContain("# my-app");
    expect(plan.items[0]!.content).toContain("- Test: `npm test`");
    const written = Object.fromEntries(plan.items.map((i) => [i.path, i.content]));
    const r = lint("/v", { fs: memoryFs({ "package.json": '{"scripts":{"test":"x","build":"x"}}', ...written }) });
    expect(r.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const again = planInit(memoryFs({ "AGENTS.md": "x", "CLAUDE.md": "y" }), "p");
    expect(again.items.every((i) => i.action === "skip")).toBe(true);
  });
});

describe("badge, history, scan", () => {
  it("badge SVG and shields JSON reflect score and grade", () => {
    const r = { score: 87, grade: "B" };
    expect(badgeSvg(r)).toContain("87/100 B");
    expect(badgeSvg(r)).toMatch(/^<svg /);
    expect(JSON.parse(shieldsJson(r))).toMatchObject({ schemaVersion: 1, label: "agent context", message: "87/100 B", color: "green" });
    expect(badgeSvg({ score: 10, grade: "F" })).toContain("#e05d44");
  });
  it("history appends, reads back and renders a trend", () => {
    const root = makeRepo({ "AGENTS.md": GOOD });
    const r1 = lint(root);
    recordHistory(root, entryFrom(r1, "2026-10-01", 1, "abc123"));
    fs.writeFileSync(path.join(root, "AGENTS.md"), GOOD + "Write clean code.\n");
    recordHistory(root, entryFrom(lint(root), "2026-10-02", 1));
    const h = readHistory(root);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ date: "2026-10-01", label: "abc123", errors: 0 });
    expect(formatHistory(h)).toMatch(/Score trend: .+ \(100 -> 9\d\)/);
    expect(formatHistory([])).toMatch(/No history yet/);
    fs.appendFileSync(path.join(root, ".obelos/history.jsonl"), "not json\n");
    expect(() => readHistory(root)).toThrow(/not valid JSON/);
  });
  it("scan summarises many repositories and counts findings per rule", () => {
    const parent = makeRepo({ "a/AGENTS.md": GOOD, "b/AGENTS.md": GOOD + "Write clean code.\n", "c/README.md": "x", ".hidden/AGENTS.md": GOOD });
    const r = scan(parent);
    expect(r.repos).toBe(3);
    expect(r.withInstructionFiles).toBe(2);
    expect(r.byRule.OBL012).toBe(1);
    expect(r.rows.find((x) => x.repo === "c")).toMatchObject({ files: 0, score: null });
    expect(() => scan(path.join(parent, "nope"))).toThrow(/Not a directory/);
  });
});

describe("output schema with new fields", () => {
  it("validates JSON that includes scope, policy IDs, columns and fixes", () => {
    const schema = JSON.parse(fs.readFileSync("schema/output.v1.json", "utf8"));
    const ajv = new Ajv({ strict: false });
    const root = makeRepo({ "AGENTS.md": GOOD + "TODO\n" });
    const r = lint(root, { config: cfg({ policies: [{ id: "t", forbid: "TODO", severity: "warn" }] }), changed: new Set(["AGENTS.md"]), since: "main" });
    r.diagnostics[0] = { ...r.diagnostics[0]!, column: 3, endLine: 6, endColumn: 7, fix: [{ line: 6, column: 1, endLine: 6, endColumn: 5, newText: "" }] };
    const out = JSON.parse(formatJson(r));
    expect(out.scope).toMatchObject({ mode: "changed", since: "main" });
    expect(ajv.validate(schema, out), JSON.stringify(ajv.errors)).toBe(true);
  });
  it("validates the new config shape", () => {
    const schema = JSON.parse(fs.readFileSync("schema/config.v1.json", "utf8"));
    const ajv = new Ajv({ strict: false });
    const good = { extends: ["obelos:strict"], rules: { OBL012: "off", OBL027: ["warn", { max: 3 }], "POL-X": "error" }, limits: { maxFileBytes: 2000 }, policies: [{ id: "x", forbid: "a", severity: "warn", tools: ["agents"] }] };
    expect(ajv.validate(schema, good), JSON.stringify(ajv.errors)).toBe(true);
    expect(ajv.validate(schema, { rules: { OBL012: "loud" } })).toBe(false);
    expect(ajv.validate(schema, { policies: [{ id: "x" }] })).toBe(false);
  });
});

void repeat;
void diskFs;
