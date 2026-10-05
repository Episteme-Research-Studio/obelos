import { describe, expect, it } from "vitest";
import { lint } from "../src/core/runner.js";
import { makeRepo, repeat } from "./helpers.js";

const ids = (root: string) => lint(root).diagnostics.map((d) => d.ruleId);
const has = (root: string, id: string) => ids(root).includes(id);

describe("OBL001 / OBL002 size", () => {
  it("flags a CLAUDE.md over 200 lines", () => {
    const root = makeRepo({ "CLAUDE.md": repeat("- keep the build green", 250) });
    expect(has(root, "OBL001")).toBe(true);
  });
  it("does not flag a short file", () => {
    const root = makeRepo({ "CLAUDE.md": "# Project\n- Run `npm test` before committing.\n- Source is in `src/`.\n", "package.json": '{"scripts":{"test":"x"}}', src: "" });
    expect(has(root, "OBL001")).toBe(false);
  });
  it("flags an oversized AGENTS.md chain", () => {
    const big = "x".repeat(20000);
    const root = makeRepo({ "AGENTS.md": big, "pkg/AGENTS.md": big });
    expect(has(root, "OBL002")).toBe(true);
  });
});

describe("OBL003 broken-import", () => {
  it("flags a missing import target", () => {
    const root = makeRepo({ "CLAUDE.md": "See @docs/missing.md for details.\n" });
    expect(has(root, "OBL003")).toBe(true);
  });
  it("accepts an existing import", () => {
    const root = makeRepo({ "CLAUDE.md": "See @docs/a.md\n", "docs/a.md": "# a" });
    expect(has(root, "OBL003")).toBe(false);
  });
  it("flags import chains deeper than four hops", () => {
    const root = makeRepo({
      "CLAUDE.md": "@a.md\n",
      "a.md": "@b.md\n",
      "b.md": "@c.md\n",
      "c.md": "@d.md\n",
      "d.md": "@e.md\n",
      "e.md": "@f.md\n",
      "f.md": "end\n",
    });
    expect(lint(root).diagnostics.some((d) => d.ruleId === "OBL003" && /hops/.test(d.message))).toBe(true);
  });
});

describe("OBL004 / OBL005 references", () => {
  it("flags missing paths but not existing, generated or ignored ones", () => {
    const root = makeRepo({ "AGENTS.md": "Code in `src/real.ts`, `src/gone.ts`, and `dist/out.js`.\n", "src/real.ts": "" });
    const msgs = lint(root).diagnostics.filter((d) => d.ruleId === "OBL004").map((d) => d.message);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/src\/gone\.ts/);
  });
  it("flags scripts that are not in package.json", () => {
    const root = makeRepo({ "AGENTS.md": "Run `npm run build` and `npm run nope`.\n", "package.json": '{"scripts":{"build":"tsc"}}' });
    const msgs = lint(root).diagnostics.filter((d) => d.ruleId === "OBL005");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.message).toMatch(/nope/);
  });
});

describe("OBL006 claude ignores AGENTS.md", () => {
  it("flags CLAUDE.md that does not import AGENTS.md", () => {
    const root = makeRepo({ "CLAUDE.md": "# Claude\n", "AGENTS.md": "# Agents\n" });
    expect(has(root, "OBL006")).toBe(true);
  });
  it("accepts an import", () => {
    const root = makeRepo({ "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": "# Agents\n" });
    expect(has(root, "OBL006")).toBe(false);
  });
});

describe("Cursor and Copilot rules", () => {
  it("OBL007 flags .md in .cursor/rules", () => {
    expect(has(makeRepo({ ".cursor/rules/a.md": "# a\n" }), "OBL007")).toBe(true);
  });
  it("OBL008 notes .mdc without frontmatter", () => {
    expect(has(makeRepo({ ".cursor/rules/a.mdc": "# a\n" }), "OBL008")).toBe(true);
  });
  it("OBL009 flags copilot path rules without applyTo", () => {
    expect(has(makeRepo({ ".github/instructions/a.instructions.md": "# a\n" }), "OBL009")).toBe(true);
  });
  it("OBL016 flags unclosed frontmatter", () => {
    expect(has(makeRepo({ ".cursor/rules/a.mdc": "---\ndescription: x\n# oops\n" }), "OBL016")).toBe(true);
  });
});

describe("OBL010 scoped globs", () => {
  it("flags a paths glob that matches nothing", () => {
    const root = makeRepo({ ".claude/rules/api.md": '---\npaths:\n  - "src/api/**/*.ts"\n---\n# Api\n- validate input\n- return typed errors\n- log requests\n' });
    expect(has(root, "OBL010")).toBe(true);
  });
  it("accepts a glob that matches a file", () => {
    const root = makeRepo({ ".claude/rules/api.md": '---\npaths:\n  - "src/api/**/*.ts"\n---\n# Api\n', "src/api/x.ts": "" });
    expect(has(root, "OBL010")).toBe(false);
  });
});

describe("quality rules", () => {
  it("OBL011 flags duplicated lines across files", () => {
    const line = "- Always run the full test suite before opening a pull request in this repository.";
    const root = makeRepo({ "AGENTS.md": line + "\n", "sub/AGENTS.md": line + "\nMore.\n" });
    expect(has(root, "OBL011")).toBe(true);
  });
  it("OBL012 flags vague instructions", () => {
    expect(has(makeRepo({ "AGENTS.md": "- Write clean code.\n" }), "OBL012")).toBe(true);
  });
  it("OBL013 flags secrets without printing them", () => {
    const root = makeRepo({ "AGENTS.md": "token = ghp_" + "a".repeat(36) + "\n" });
    const d = lint(root).diagnostics.find((x) => x.ruleId === "OBL013");
    expect(d).toBeTruthy();
    expect(d!.message).not.toMatch(/ghp_a/);
  });
  it("OBL013 ignores obvious placeholders", () => {
    expect(has(makeRepo({ "AGENTS.md": "api_key = your_api_key_goes_here_please\n" }), "OBL013")).toBe(false);
  });
  it("OBL014 flags near-empty files", () => {
    expect(has(makeRepo({ "AGENTS.md": "# Title\n" }), "OBL014")).toBe(true);
  });
  it("OBL015 flags always/never conflicts and mixed package managers", () => {
    const a = makeRepo({ "AGENTS.md": "- Always use tabs for indentation.\n", "CLAUDE.md": "- Never use tabs for indentation.\n@AGENTS.md\n" });
    expect(has(a, "OBL015")).toBe(true);
    const b = makeRepo({ "AGENTS.md": "Run `npm install`.\n", "GEMINI.md": "Run `pnpm install`.\n" });
    expect(has(b, "OBL015")).toBe(true);
  });
});

describe("config and scoring", () => {
  it("turns rules off and overrides severity", () => {
    const root = makeRepo({ "AGENTS.md": "- Write clean code.\n", "obelos.config.json": '{"rules":{"OBL012":"error","OBL014":"off"}}' });
    const r = lint(root);
    expect(r.diagnostics.find((d) => d.ruleId === "OBL012")?.severity).toBe("error");
    expect(r.diagnostics.some((d) => d.ruleId === "OBL014")).toBe(false);
  });
  it("gives a clean repo a perfect score", () => {
    const root = makeRepo({
      "AGENTS.md": "# Project\n- Run `npm test` before every commit.\n- Source lives in `src/`.\n- Use TypeScript strict mode.\n",
      "package.json": '{"scripts":{"test":"vitest"}}',
      "src/index.ts": "",
    });
    const r = lint(root);
    expect(r.diagnostics).toEqual([]);
    expect(r.score).toBe(100);
  });
  it("lowers the score for errors", () => {
    const root = makeRepo({ "CLAUDE.md": "See @gone.md\n- Run `npm run nope`\n- Another real line\n- And one more line\n", "package.json": '{"scripts":{"a":"b"}}' });
    expect(lint(root).score).toBeLessThan(90);
  });
});
