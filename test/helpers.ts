import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obelos-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

export function repeat(line: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${line} ${i}`).join("\n");
}
