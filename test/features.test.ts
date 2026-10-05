import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import fs from "node:fs";
import { lint } from "../src/core/runner.js";
import { createBaseline } from "../src/core/baseline.js";
import { resolveContext } from "../src/core/resolve.js";
import { discover } from "../src/core/discover.js";
import { loadConfig } from "../src/core/config.js";
import { formatJson } from "../src/report/json.js";
import { formatSarif } from "../src/report/sarif.js";
import { formatMarkdown } from "../src/report/markdown.js";
import { formatGithub } from "../src/report/github.js";
import { RULES } from "../src/rules/index.js";
import { RULE_DOCS } from "../src/rules/docs.js";
import { VERSION } from "../src/version.js";
import { makeRepo } from "./helpers.js";

const ids = (root: string) => lint(root).diagnostics.map((d) => d.ruleId);

describe("version and metadata", () => {
  it("keeps VERSION in sync with package.json", () => {
    expect(VERSION).toBe(JSON.parse(fs.readFileSync("package.json", "utf8")).version);
  });
  it("documents every rule", () => {
    for (const r of RULES) expect(RULE_DOCS[r.id], `missing docs for ${r.id}`).toBeTruthy();
  });
  it("has unique rule IDs", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});

describe("OBL017 local file not gitignored", () => {
  it("flags when .gitignore does not cover it", () => {
    expect(ids(makeRepo({ "CLAUDE.local.md": "# mine\n- a\n- b\n- c\n", ".gitignore": "node_modules\n" }))).toContain("OBL017");
  });
  it("accepts when covered", () => {
    expect(ids(makeRepo({ "CLAUDE.local.md": "# mine\n- a\n- b\n- c\n", ".gitignore": "CLAUDE.local.md\n" }))).not.toContain("OBL017");
  });
});

describe("inline disable comments", () => {
  it("suppresses the next line, a whole file, and counts them", () => {
    const next = makeRepo({ "AGENTS.md": "# T\n<!-- obelos-disable-next-line OBL012 -->\n- Write clean code.\n- Use `npm test`.\n- Keep `src/` tidy.\n" });
    expect(lint(next).diagnostics.some((d) => d.ruleId === "OBL012")).toBe(false);
    expect(lint(next).suppressed).toBe(1);
    const file = makeRepo({ "AGENTS.md": "<!-- obelos-disable-file OBL012, OBL014 -->\n- Write clean code.\n" });
    const r = lint(file);
    expect(r.diagnostics.filter((d) => ["OBL012", "OBL014"].includes(d.ruleId))).toEqual([]);
  });
  it("does not suppress other rules", () => {
    const root = makeRepo({ "AGENTS.md": "<!-- obelos-disable-file OBL012 -->\nSee @gone.md\n- one\n- two\n" });
    expect(ids(root)).toContain("OBL003");
  });
});

describe("baseline", () => {
  it("hides known findings and reports only new ones", () => {
    const root = makeRepo({ "AGENTS.md": "- Write clean code.\n" });
    const first = lint(root);
    const baseline = createBaseline(first.diagnostics);
    const again = lint(root, { baseline });
    expect(again.diagnostics).toEqual([]);
    expect(again.baselined).toBe(first.diagnostics.length);
    const root2 = makeRepo({ "AGENTS.md": "- Write clean code.\n- Follow best practices always.\n" });
    const r = lint(root2, { baseline });
    expect(r.diagnostics.some((d) => d.ruleId === "OBL012")).toBe(true);
  });
});

describe("reporters", () => {
  const root = makeRepo({ "CLAUDE.md": "See @gone.md\n- Run `npm run nope`\n- another\n- line\n", "package.json": '{"scripts":{"a":"b"}}' });
  const result = lint(root);

  it("JSON validates against the published schema", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(JSON.parse(fs.readFileSync("schema/output.v1.json", "utf8")));
    const ok = validate(JSON.parse(formatJson(result)));
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });
  it("SARIF has the 2.1.0 shape with fingerprints", () => {
    const s = JSON.parse(formatSarif(result));
    expect(s.version).toBe("2.1.0");
    expect(s.runs[0].tool.driver.rules.length).toBe(RULES.length);
    const first = s.runs[0].results[0];
    expect(first.ruleId).toMatch(/^OBL/);
    expect(first.locations[0].physicalLocation.region.startLine).toBeGreaterThanOrEqual(1);
    expect(first.partialFingerprints["obelos/v1"]).toBeTruthy();
  });
  it("markdown summarises score and findings", () => {
    const md = formatMarkdown(result);
    expect(md).toMatch(/Obelos: \d+\/100/);
    expect(md).toMatch(/OBL003/);
  });
  it("github annotations escape properly", () => {
    const out = formatGithub(result);
    expect(out).toMatch(/^::error file=CLAUDE.md,line=1,title=OBL003::/m);
    expect(out).not.toMatch(/\n\n/);
  });
});

describe("config schema", () => {
  it("accepts the documented example", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(JSON.parse(fs.readFileSync("schema/config.v1.json", "utf8")));
    expect(validate({ rules: { OBL012: "off" }, ignore: ["vendor/**"], budgets: { claudeLines: 150 } })).toBe(true);
    expect(validate({ rules: { nope: "off" } })).toBe(false);
  });
});

describe("resolve", () => {
  const files = {
    "AGENTS.md": "# Root\n- shared rule one here\n- two\n- three\n",
    "CLAUDE.md": "# Claude\n- a\n- b\n- c\n",
    "packages/api/AGENTS.md": "# API\n- x\n- y\n- z\n",
    ".claude/rules/api.md": '---\npaths:\n  - "packages/api/**/*.ts"\n---\n# Api\n- a\n',
    ".cursor/rules/ts.mdc": '---\nglobs: "**/*.ts"\n---\n# ts\n',
    ".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\n# always\n",
    ".cursor/rules/manual.mdc": "---\n---\n# manual\n",
    ".cursor/rules/ignored.md": "# ignored\n",
    ".github/copilot-instructions.md": "# copilot\n",
    ".github/instructions/py.instructions.md": '---\napplyTo: "**/*.py"\n---\n# py\n',
    "packages/api/src/x.ts": "",
  };
  const root = makeRepo(files);
  const found = discover(root, loadConfig(root));
  const r = resolveContext(found, "packages/api/src/x.ts");
  const tool = (t: string) => r.tools.find((x) => x.tool === t)!;

  it("Claude: reads CLAUDE.md, warns that AGENTS.md is not imported, matches path rules", () => {
    const c = tool("claude");
    expect(c.entries.map((e) => e.file)).toContain("CLAUDE.md");
    expect(c.entries.map((e) => e.file)).toContain(".claude/rules/api.md");
    expect(c.notes.join(" ")).toMatch(/AGENTS.md exists but is NOT read/);
  });
  it("Cursor: always, glob, manual-only and ignored files are classified", () => {
    const c = tool("cursor");
    const by = Object.fromEntries(c.entries.map((e) => [e.file, e.certainty]));
    expect(by[".cursor/rules/always.mdc"]).toBe("always");
    expect(by[".cursor/rules/ts.mdc"]).toBe("matched");
    expect(by[".cursor/rules/manual.mdc"]).toBe("manual-only");
    expect(c.notes.join(" ")).toMatch(/ignored/);
  });
  it("Copilot: repo-wide plus matching applyTo only, nearest AGENTS.md wins", () => {
    const files2 = tool("copilot").entries.map((e) => e.file);
    expect(files2).toContain(".github/copilot-instructions.md");
    expect(files2).not.toContain(".github/instructions/py.instructions.md");
    expect(files2).toContain("packages/api/AGENTS.md");
    expect(files2).not.toContain("AGENTS.md");
  });
  it("Claude reads AGENTS.md when there is no CLAUDE.md", () => {
    const r2 = resolveContext(discover(makeRepo({ "AGENTS.md": "# a\n- b\n- c\n- d\n" }), loadConfig(".")), "x.ts");
    expect(r2.tools.find((t) => t.tool === "claude")!.entries[0]!.file).toBe("AGENTS.md");
  });
});

describe("robustness", () => {
  it("does not crash on empty, binary-ish and CRLF files", () => {
    const root = makeRepo({ "AGENTS.md": "", "CLAUDE.md": "\r\n# T\r\n- a\r\n- b\r\n- c\r\n", "GEMINI.md": "\u0000\u0001\u0002" });
    expect(() => lint(root)).not.toThrow();
  });
  it("returns an empty result for a repo without instruction files", () => {
    const r = lint(makeRepo({ "README.md": "hi" }));
    expect(r.files).toEqual([]);
    expect(r.score).toBe(100);
  });
});
