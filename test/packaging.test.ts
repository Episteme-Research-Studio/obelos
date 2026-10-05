import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package entry point", () => {
  it("the CLI source starts with a node shebang so the installed bin runs under node", () => {
    expect(fs.readFileSync("src/cli.ts", "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
