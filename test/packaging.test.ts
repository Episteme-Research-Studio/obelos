import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package entry point", () => {
  it("the CLI source starts with a node shebang so the installed bin runs under node", () => {
    // Accept CRLF: Git on Windows may check the file out with Windows line endings.
    expect(/^#!\/usr\/bin\/env node\r?\n/.test(fs.readFileSync("src/cli.ts", "utf8"))).toBe(true);
  });
});
