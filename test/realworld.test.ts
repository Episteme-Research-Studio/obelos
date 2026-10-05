import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lint } from "../src/core/runner.js";
import { score } from "../src/core/score.js";
import { splitPatterns } from "../src/rules/references.js";
import { makeRepo } from "./helpers.js";

// Regression tests for false positives found by linting real public repositories.
const found = (root: string, id: string) => lint(root).diagnostics.filter((d) => d.ruleId === id);

const GOOD = "# Project\n\n- Run `npm test` before committing.\n- Keep modules small and tested.\n- Never commit secrets to the repo.\n";

describe("OBL014 import-only and short files", () => {
  it("does not flag a CLAUDE.md that only imports AGENTS.md", () => {
    const root = makeRepo({ "AGENTS.md": GOOD, "CLAUDE.md": "# CLAUDE.md\n\n@AGENTS.md\n" });
    expect(found(root, "OBL014")).toHaveLength(0);
  });
  it("does not flag a single meaningful sentence", () => {
    const root = makeRepo({ "AGENTS.md": "You may edit this application and create local commits. Do not push or create pull requests. Use npm.\n" });
    expect(found(root, "OBL014")).toHaveLength(0);
  });
  it("still flags a nearly empty file", () => {
    const root = makeRepo({ "AGENTS.md": "# Notes\n\nTBD\n" });
    expect(found(root, "OBL014").length).toBeGreaterThan(0);
  });
});

describe("OBL004 relative, generated and optional paths", () => {
  const base = { "AGENTS.md": "", "packages/next/src/cli/next-dev.ts": "", "src/airflow/models/dag.py": "" };
  it("accepts a path written relative to a sub-package", () => {
    const root = makeRepo({ ...base, "AGENTS.md": "- Dev server: `src/cli/next-dev.ts`\n- Models live in `models/`\n" });
    expect(found(root, "OBL004")).toHaveLength(0);
  });
  it("skips optional, generated and scheme-less URL references", () => {
    const root = makeRepo({ ...base, "AGENTS.md": "- Read `docs/NOTES.md` (if exists)\n- Output goes to `dist/app.js`\n- Docs at `airflow.apache.org/registry/`\n- Vendored code: `vendor/`\n" });
    expect(found(root, "OBL004")).toHaveLength(0);
  });
  it("still flags a real stale path", () => {
    const root = makeRepo({ ...base, "AGENTS.md": "- Entry point is `src/old/main.ts`\n" });
    expect(found(root, "OBL004")).toHaveLength(1);
  });
  it("accepts a .js import written for a .ts source", () => {
    const root = makeRepo({ "AGENTS.md": "- Import `./ui/widget.contribution.js`\n", "src/ui/widget.contribution.ts": "" });
    expect(found(root, "OBL004")).toHaveLength(0);
  });
});

describe("OBL005 scripts", () => {
  it("skips a hedged script reference", () => {
    const root = makeRepo({ "AGENTS.md": "| `npm run test` | Run the tests (if present). |\n", "package.json": '{"scripts":{"build":"x"}}' });
    expect(found(root, "OBL005")).toHaveLength(0);
  });
  it("accepts a script defined in another package.json of the repo", () => {
    const root = makeRepo({ "AGENTS.md": "- Run `npm run typecheck` from the build folder\n", "package.json": '{"scripts":{"build":"x"}}', "build/package.json": '{"scripts":{"typecheck":"tsc"}}' });
    expect(found(root, "OBL005")).toHaveLength(0);
  });
  it("still flags a script that exists nowhere", () => {
    const root = makeRepo({ "AGENTS.md": "- Run `npm run deploy`\n", "package.json": '{"scripts":{"build":"x"}}' });
    expect(found(root, "OBL005")).toHaveLength(1);
  });
});

describe("OBL003 scoped package names", () => {
  it("does not treat @scope/package in prose as an import", () => {
    const root = makeRepo({ "AGENTS.md": "- `$next-rspack` maintains @next/rspack-core and @next/rspack-binding\n" });
    expect(found(root, "OBL003")).toHaveLength(0);
  });
  it("still flags a missing file import", () => {
    const root = makeRepo({ "CLAUDE.md": "@docs/missing.md\n" });
    expect(found(root, "OBL003")).toHaveLength(1);
  });
});

describe("OBL009 and OBL010 Copilot path files", () => {
  it("does not flag a Copilot instruction file that has a description but no applyTo", () => {
    const root = makeRepo({ ".github/instructions/chat.instructions.md": "---\ndescription: Chat feature guidelines\n---\n\n- Gate AI features on the context key.\n" });
    expect(found(root, "OBL009")).toHaveLength(0);
  });
  it("notes a file with neither, at info severity", () => {
    const root = makeRepo({ ".github/instructions/x.instructions.md": "- Be specific in commit messages for this area.\n" });
    const d = found(root, "OBL009");
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("info");
  });
  it("splits applyTo on commas outside braces", () => {
    expect(splitPatterns("src/**/*.{ts,css}, build/{a,b}/**")).toEqual(["src/**/*.{ts,css}", " build/{a,b}/**"]);
    const root = makeRepo({ ".github/instructions/x.instructions.md": '---\napplyTo: "src/**/*.{ts,css}"\n---\n- Use tabs in this area.\n', "src/a.css": "" });
    expect(found(root, "OBL010")).toHaveLength(0);
  });
});

describe("OBL011 duplicates", () => {
  const line = "- Always run the full test suite before you open a pull request for review.";
  it("ignores licence headers in HTML comments", () => {
    const hdr = "<!-- SPDX-License-Identifier: Apache-2.0\n     https://www.apache.org/licenses/LICENSE-2.0 -->\n";
    const root = makeRepo({ "AGENTS.md": `${hdr}\n# A\n- one\n`, "pkg/AGENTS.md": `${hdr}\n# B\n- two\n` });
    expect(found(root, "OBL011")).toHaveLength(0);
  });
  it("ignores the same line in unrelated sibling directories", () => {
    const root = makeRepo({ "evals/a/AGENTS.md": `${line}\n`, "evals/b/AGENTS.md": `${line}\n` });
    expect(found(root, "OBL011")).toHaveLength(0);
  });
  it("reports the same line in a parent and a child file, at info", () => {
    const root = makeRepo({ "AGENTS.md": `${line}\n- other\n`, "pkg/AGENTS.md": `${line}\n- more\n` });
    const d = found(root, "OBL011");
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("info");
  });
  it("reports an exact copy once instead of once per line", () => {
    const body = Array.from({ length: 30 }, (_, i) => `- Rule number ${i}: always keep modules small and covered by tests.`).join("\n");
    const root = makeRepo({ "AGENTS.md": body, "CLAUDE.md": body });
    const d = found(root, "OBL011");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("Exact copy");
  });
  it("does not report a symlink as a duplicate", () => {
    const root = makeRepo({ "AGENTS.md": GOOD });
    fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    expect(found(root, "OBL011")).toHaveLength(0);
  });
});

describe("OBL026 wall of text", () => {
  it("does not join list items, comments and tables into one paragraph", () => {
    const item = "- " + "word ".repeat(60).trim();
    const root = makeRepo({ "AGENTS.md": `<!-- generated block -->\n${Array.from({ length: 12 }, () => item).join("\n")}\n` });
    expect(found(root, "OBL026")).toHaveLength(0);
  });
  it("still flags one huge paragraph", () => {
    const root = makeRepo({ "AGENTS.md": "word ".repeat(400) + "\n" });
    expect(found(root, "OBL026").length).toBeGreaterThan(0);
  });
});

describe("score v2 averages over files", () => {
  const d = (file: string, ruleId: string) => ({ ruleId, severity: "warn" as const, message: "m", file });
  it("keeps a large repository with a few findings in a good band", () => {
    const files = Array.from({ length: 30 }, (_, i) => `d${i}/AGENTS.md`);
    const ds = ["OBL004", "OBL011", "OBL026"].flatMap((r) => files.slice(0, 10).map((f) => d(f, r)));
    expect(score(ds, files).score).toBeGreaterThan(80);
  });
  it("still scores one badly broken file low when it is the only file", () => {
    const ds = ["OBL004", "OBL011", "OBL026", "OBL005", "OBL010"].flatMap((r) => Array.from({ length: 5 }, () => d("AGENTS.md", r)));
    expect(score(ds, ["AGENTS.md"]).score).toBeLessThan(10);
  });
});
