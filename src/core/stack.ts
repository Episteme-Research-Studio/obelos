import { decode, type FileSystem } from "./fs.js";

export interface StackInfo {
  stacks: string[];
  packageManager?: string;
  commands: { install?: string; build?: string; test?: string; lint?: string; typecheck?: string; format?: string; dev?: string };
  /** Facts the detector is unsure about; shown to the user and written as TODO-free prose, never guessed. */
  notes: string[];
}

function text(fsys: FileSystem, rel: string): string | null {
  const b = fsys.readBytes(rel);
  if (!b) return null;
  const d = decode(b);
  return "text" in d ? d.text : null;
}

function makeTargets(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)) if (m[1] && !m[1].startsWith(".")) out.add(m[1]);
  return out;
}

/**
 * Detect the project's stack and its real commands from files only (package.json scripts, lockfiles,
 * pyproject, Cargo, go.mod, Makefile). Reads, never executes. Only commands that provably exist are returned.
 */
export function detectStack(fsys: FileSystem, forced?: string): StackInfo {
  const info: StackInfo = { stacks: [], commands: {}, notes: [] };
  const has = (p: string) => fsys.exists(p);
  const wants = (s: string) => !forced || forced === s;

  const pkg = wants("node") ? text(fsys, "package.json") : null;
  if (pkg !== null || forced === "node") {
    info.stacks.push(has("tsconfig.json") ? "TypeScript/Node" : "Node");
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    info.packageManager = pm;
    info.commands.install = pm === "npm" ? "npm install" : `${pm} install`;
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(pkg ?? "{}") as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      info.notes.push("package.json could not be parsed; no scripts detected.");
    }
    const run = (n: string) => (pm === "npm" || pm === "bun" ? `${pm} run ${n}` : `${pm} ${n}`);
    for (const [key, names] of [
      ["build", ["build"]],
      ["test", ["test"]],
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["format", ["format", "fmt"]],
      ["dev", ["dev", "start"]],
    ] as const) {
      const hit = names.find((n) => n in scripts);
      if (hit) info.commands[key] = key === "test" && pm === "npm" && hit === "test" ? "npm test" : run(hit);
    }
  }
  const py = wants("python") ? (text(fsys, "pyproject.toml") ?? text(fsys, "requirements.txt") ?? text(fsys, "setup.cfg")) : null;
  if (py !== null || forced === "python") {
    info.stacks.push("Python");
    const uv = has("uv.lock");
    const poetry = has("poetry.lock");
    info.packageManager ??= uv ? "uv" : poetry ? "poetry" : "pip";
    info.commands.install ??= uv ? "uv sync" : poetry ? "poetry install" : has("requirements.txt") ? "pip install -r requirements.txt" : "pip install -e .";
    const pre = uv ? "uv run " : poetry ? "poetry run " : "";
    if (/pytest/.test(py ?? "") || has("pytest.ini") || has("tests")) info.commands.test ??= `${pre}pytest`;
    if (/\[tool\.ruff/.test(py ?? "") || has("ruff.toml")) {
      info.commands.lint ??= `${pre}ruff check .`;
      info.commands.format ??= `${pre}ruff format .`;
    }
    if (/\[tool\.mypy/.test(py ?? "") || has("mypy.ini")) info.commands.typecheck ??= `${pre}mypy .`;
  }
  if ((wants("rust") && has("Cargo.toml")) || forced === "rust") {
    info.stacks.push("Rust");
    info.commands.build ??= "cargo build";
    info.commands.test ??= "cargo test";
    info.commands.lint ??= "cargo clippy";
    info.commands.format ??= "cargo fmt";
  }
  if ((wants("go") && has("go.mod")) || forced === "go") {
    info.stacks.push("Go");
    info.commands.build ??= "go build ./...";
    info.commands.test ??= "go test ./...";
    info.commands.lint ??= "go vet ./...";
    info.commands.format ??= "gofmt -w .";
  }
  const mk = text(fsys, "Makefile");
  if (mk !== null) {
    const t = makeTargets(mk);
    for (const k of ["build", "test", "lint", "format"] as const) if (t.has(k) && !info.commands[k]) info.commands[k] = `make ${k}`;
  }
  if (info.stacks.length === 0) info.notes.push("No known project manifest found (package.json, pyproject.toml, Cargo.toml, go.mod). Commands were left out rather than guessed.");
  return info;
}

export function renderAgentsMd(info: StackInfo, projectName: string): string {
  const out = [`# ${projectName}`, ""];
  if (info.stacks.length) out.push(`Stack: ${info.stacks.join(", ")}.`, "");
  const rows: [string, string | undefined][] = [
    ["Install", info.commands.install],
    ["Dev", info.commands.dev],
    ["Build", info.commands.build],
    ["Test", info.commands.test],
    ["Lint", info.commands.lint],
    ["Typecheck", info.commands.typecheck],
    ["Format", info.commands.format],
  ];
  const present = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (present.length) {
    out.push("## Commands", "");
    for (const [k, v] of present) out.push(`- ${k}: \`${v}\``);
    out.push("");
  }
  out.push("## Conventions", "", "<!-- Add the rules an agent cannot infer from the code: naming, error handling, test style, forbidden patterns. -->", "", "- Keep this file under 200 lines; move detail into linked docs.", "");
  return out.join("\n");
}
