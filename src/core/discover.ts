import picomatch from "picomatch";
import path from "node:path";
import type { Config, ContextFile, Diagnostic, Workspace } from "./types.js";
import { classify, parseContent, todayIso } from "./parse.js";
import { decode, diskFs, type FileSystem } from "./fs.js";

export const PATTERNS = [
  "**/CLAUDE.md",
  "**/.claude/CLAUDE.md",
  "**/CLAUDE.local.md",
  "**/.claude/rules/**/*.md",
  "**/AGENTS.md",
  "**/.claude/AGENTS.md",
  "**/.cursor/rules/**/*.{mdc,md}",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".github/instructions/**/*.instructions.md",
  "**/GEMINI.md",
];

export const ALWAYS_IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**", "**/coverage/**"];

const MAX_LISTED_FILES = 200_000;

export interface Discovery {
  files: ContextFile[];
  /** Informational notices (OBL000) about files that were skipped. */
  notices: Diagnostic[];
}

function notice(file: string, message: string): Diagnostic {
  return { ruleId: "OBL000", severity: "info", file, message };
}

/** Find and parse instruction files, enforcing hard limits and decoding safely. */
export function discoverAll(fsys: FileSystem, config: Config, today: string = todayIso()): Discovery {
  const found = [...new Set(fsys.glob(PATTERNS, ALWAYS_IGNORE, config.limits.maxDepth))].filter((p) => classify(p)).sort();
  const isIgnored = config.ignore.length ? picomatch(config.ignore, { dot: true }) : () => false;
  const files: ContextFile[] = [];
  const notices: Diagnostic[] = [];
  for (const rel of found) {
    if (isIgnored(rel)) continue;
    if (files.length >= config.limits.maxInstructionFiles) {
      notices.push(notice(rel, `Skipped: more than ${config.limits.maxInstructionFiles} instruction files (limits.maxInstructionFiles).`));
      continue;
    }
    const size = fsys.size(rel);
    if (size === null) {
      notices.push(notice(rel, "Skipped: file is unreadable or a dangling symlink."));
      continue;
    }
    if (size > config.limits.maxFileBytes) {
      notices.push(notice(rel, `Skipped: ${size} bytes exceeds limits.maxFileBytes (${config.limits.maxFileBytes}).`));
      continue;
    }
    const buf = fsys.readBytes(rel);
    if (!buf) {
      notices.push(notice(rel, "Skipped: file could not be read."));
      continue;
    }
    const dec = decode(buf);
    if ("skip" in dec) {
      notices.push(notice(rel, `Skipped: ${dec.skip}.`));
      continue;
    }
    const f = parseContent(rel, dec.text, { abs: fsys.abs(rel), realPath: fsys.realPath(rel), today });
    if (f) files.push(f);
  }
  return { files, notices };
}

/** Disk convenience wrapper. */
export function discover(root: string, config: Config, today?: string): ContextFile[] {
  return discoverAll(diskFs(root), config, today).files;
}

export function createWorkspace(rootOrFs: string | FileSystem, config: Config, today: string = todayIso(), rootLabel?: string): Workspace {
  const fsys = typeof rootOrFs === "string" ? diskFs(rootOrFs) : rootOrFs;
  const root = typeof rootOrFs === "string" ? rootOrFs : (rootLabel ?? "/");
  let cache: string[] | null = null;
  const scriptCache = new Map<string, Set<string>>();

  const read = (rel: string): string | null => {
    const buf = fsys.readBytes(rel);
    if (!buf) return null;
    const d = decode(buf);
    return "text" in d ? d.text : null;
  };

  function readScripts(dir: string): Set<string> | null {
    const text = read(dir === "" ? "package.json" : `${dir}/package.json`);
    if (text === null) return null;
    try {
      const json = JSON.parse(text) as { scripts?: Record<string, string> };
      return new Set(Object.keys(json.scripts ?? {}));
    } catch {
      return new Set();
    }
  }

  return {
    root,
    config,
    today,
    exists: (rel) => fsys.exists(rel),
    read,
    allFiles() {
      if (!cache) cache = fsys.glob(null, ALWAYS_IGNORE, config.limits.maxDepth).slice(0, MAX_LISTED_FILES);
      return cache;
    },
    scriptsFor(dir) {
      const hit = scriptCache.get(dir);
      if (hit) return hit;
      const union = new Set<string>();
      let cur = dir;
      for (;;) {
        const s = readScripts(cur);
        if (s) for (const n of s) union.add(n);
        if (cur === "") break;
        const parent = path.posix.dirname(cur);
        cur = parent === "." ? "" : parent;
      }
      scriptCache.set(dir, union);
      return union;
    },
  };
}
