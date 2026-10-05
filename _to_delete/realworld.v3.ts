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
    const root = makeRepo({ "AGENTS.md": body, "sub/AGENTS.md": body });
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

describe("second corpus pass: 150 public repositories", () => {
  it("OBL016: Cursor frontmatter with an unquoted glob is read, not an error", () => {
    const root = makeRepo({ ".cursor/rules/cs.mdc": "---\ndescription: C# rules\nglobs: *.cs\nalwaysApply: false\n---\n- Use PascalCase for public members and file-scoped namespaces.\n", "src/A.cs": "" });
    const r = lint(root);
    expect(r.diagnostics.filter((d) => d.ruleId === "OBL016")).toHaveLength(0);
    expect(r.diagnostics.filter((d) => d.ruleId === "OBL010")).toHaveLength(0); // `*.cs` matches src/A.cs by name
  });
  it("OBL016: the same problem in a Claude rule is a warning, not an error", () => {
    const root = makeRepo({ ".claude/rules/a.md": "---\npaths: *.ts\n---\n- Prefer small functions in this area of the repo.\n", "a.ts": "" });
    const d = found(root, "OBL016");
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("warn");
  });
  it("OBL016: an unclosed frontmatter is still an error", () => {
    const root = makeRepo({ ".cursor/rules/a.mdc": "---\ndescription: x\n- body without closing\n" });
    expect(found(root, "OBL016")[0]!.severity).toBe("error");
  });
  it("OBL010: ignores globs: null and matches slashless globs by file name", () => {
    const root = makeRepo({ ".cursor/rules/a.mdc": "---\nglobs: null\n---\n- text for rule a goes here.\n", ".cursor/rules/b.mdc": "---\nglobs: build.gradle\n---\n- text for rule b goes here.\n", "app/build.gradle": "" });
    expect(found(root, "OBL010")).toHaveLength(0);
  });
  it("OBL008: does not also report a rule whose frontmatter could not be parsed", () => {
    const root = makeRepo({ ".cursor/rules/a.mdc": "---\ndescription: x\n- no close\n" });
    expect(found(root, "OBL008")).toHaveLength(0);
  });
  it("OBL007: ignores README.md in the rules folder", () => {
    const root = makeRepo({ ".cursor/rules/README.md": "# About these rules\n" });
    expect(found(root, "OBL007")).toHaveLength(0);
  });
  it("OBL006: an identical CLAUDE.md copy hides nothing", () => {
    const body = "# P\n\n- Run `npm test`.\n- Keep modules small.\n- Never commit secrets.\n";
    const root = makeRepo({ "AGENTS.md": body, "CLAUDE.md": body, "package.json": '{"scripts":{"test":"x"}}' });
    expect(found(root, "OBL006")).toHaveLength(0);
  });
  it("OBL005: `pnpm run -r build` is not a script called -r", () => {
    const root = makeRepo({ "AGENTS.md": "- `pnpm run -r build` builds everything; `pnpm run --filter web dev` runs the site.\n", "package.json": '{"scripts":{"build":"x","dev":"x"}}' });
    expect(found(root, "OBL005")).toHaveLength(0);
  });
  it("OBL003: CJK punctuation ends an import token and git submodules are skipped", () => {
    const root = makeRepo({ "CLAUDE.md": "迁移@google/genai）迁移为新版\n@vendor-sub/CLAUDE.md\n", ".gitmodules": '[submodule "x"]\n\tpath = vendor-sub\n\turl = https://example.com/x\n' });
    expect(found(root, "OBL003")).toHaveLength(0);
  });
  it("OBL003: a Cursor @file reference may be relative to the repository root", () => {
    const root = makeRepo({ ".cursor/rules/ui.mdc": "---\ndescription: ui\n---\nFollow @.eslintrc for lint rules.\n", ".eslintrc": "{}" });
    expect(found(root, "OBL003")).toHaveLength(0);
  });
  it("OBL004: paths ignored by .gitignore, aliases and submodules are skipped", () => {
    const root = makeRepo({ "AGENTS.md": "- Output in `renders/intro.mp4`\n- Styles in `@app/styles/theme.css`\n- State in `.tool/run.cjs`\n", ".gitignore": "renders/\n.tool/\n" });
    expect(found(root, "OBL004")).toHaveLength(0);
  });
  it("OBL002: reported once at the file that crosses the limit, and not for CLAUDE.md", () => {
    const big = "x".repeat(40000);
    const root = makeRepo({ "AGENTS.md": big, "a/AGENTS.md": "- small\n", "b/AGENTS.md": "- small\n", "CLAUDE.md": big });
    const d = found(root, "OBL002");
    expect(d).toHaveLength(1);
    expect(d[0]!.file).toBe("AGENTS.md");
  });
  it("OBL013: kebab-case and snake_case values are not credentials", () => {
    const root = makeRepo({ "AGENTS.md": "- token: common_auth_failed_message_key\n- password: reset-password-email-template\n" });
    expect(found(root, "OBL013")).toHaveLength(0);
  });
  it("OBL014: a sentence about TODO comments is not a placeholder", () => {
    const root = makeRepo({ "AGENTS.md": "# Rules\n\n- Never leave a TODO comment without an issue number in the code you write.\n- Run `npm test` before every commit.\n- Keep functions short.\n" });
    expect(found(root, "OBL014")).toHaveLength(0);
  });
  it("OBL015: stating a preference or installing a global tool is not a second package manager", () => {
    const root = makeRepo({ "AGENTS.md": "- Use pnpm install, never npm install.\n- Install the CLI once with npm install -g tool.\n- Run pnpm test before committing.\n" });
    expect(found(root, "OBL015")).toHaveLength(0);
  });
});

describe("third accuracy pass", () => {
  it("does not flag CLAUDE.md and AGENTS.md siblings as duplicates", () => {
    const root = makeRepo({
      "AGENTS.md": "# A\n\nAlways run the full test suite before opening a pull request to main.\n",
      "CLAUDE.md": "# C\n\nAlways run the full test suite before opening a pull request to main.\nExtra.\n",
    });
    expect(found(root, "OBL011")).toHaveLength(0);
  });
});

describe("OBL011 aggregation", () => {
  it("reports many repeated lines between two files as one finding", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `- Rule number ${i}: always keep modules small and covered by tests.`);
    const root = makeRepo({ "AGENTS.md": lines.join("\n") + "\n", "sub/AGENTS.md": lines.join("\n") + "\n- Extra distinct line that is long enough to count here.\n" });
    const d = found(root, "OBL011");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("10 instructions");
  });
});
