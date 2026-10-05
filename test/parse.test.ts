import { describe, expect, it } from "vitest";
import { classify, extractRefs, splitFrontmatter } from "../src/core/parse.js";

describe("classify", () => {
  it("recognises the supported instruction files", () => {
    expect(classify("CLAUDE.md")?.kind).toBe("claude-md");
    expect(classify("sub/AGENTS.md")?.kind).toBe("agents-md");
    expect(classify(".claude/rules/api.md")?.kind).toBe("claude-rule");
    expect(classify(".cursor/rules/ts.mdc")?.kind).toBe("cursor-rule");
    expect(classify(".github/copilot-instructions.md")?.kind).toBe("copilot-repo");
    expect(classify(".github/instructions/x.instructions.md")?.kind).toBe("copilot-path");
    expect(classify("README.md")).toBeNull();
  });
});

describe("splitFrontmatter", () => {
  it("parses yaml and reports the body start", () => {
    const r = splitFrontmatter('---\npaths:\n  - "src/**"\n---\n# Body');
    expect(r.frontmatter).toEqual({ paths: ["src/**"] });
    expect(r.bodyStart).toBe(5);
  });
  it("reports unclosed frontmatter", () => {
    expect(splitFrontmatter("---\na: 1\n# no end").error).toMatch(/never closed/);
  });
  it("returns null when there is none", () => {
    expect(splitFrontmatter("# Title").frontmatter).toBeNull();
  });
});

describe("extractRefs", () => {
  it("finds imports outside code and ignores spans, fences and emails", () => {
    const lines = ["See @docs/arch.md for more.", "Use `@docs/ignored.md` literally.", "mail me@example.com", "```", "@docs/fenced.md", "```"];
    const r = extractRefs(lines, 1);
    expect(r.imports.map((i) => i.value)).toEqual(["docs/arch.md"]);
  });
  it("finds path references in code spans and links, not urls or globs", () => {
    const lines = ["Code lives in `src/api/` and `src/index.ts`.", "See [guide](docs/guide.md) and `https://x.io/a.js` and `src/**/*.ts` and `and/or`."];
    const r = extractRefs(lines, 1);
    expect(r.pathRefs.map((p) => p.value).sort()).toEqual(["docs/guide.md", "src/api/", "src/index.ts"]);
  });
  it("finds package script references in fences and prose", () => {
    const r = extractRefs(["Run `pnpm run lint`.", "```bash", "npm run test:unit", "```"], 1);
    expect(r.scriptRefs.map((s) => s.value)).toEqual(["lint", "test:unit"]);
  });
});
