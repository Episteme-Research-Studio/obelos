import picomatch from "picomatch";
import fs from "node:fs";
import path from "node:path";

/**
 * Everything the core needs from a file system. Rules and discovery use only this seam,
 * so the same engine runs on disk (CLI), in memory (tests, browser checker) or over a git tree.
 */
export interface FileSystem {
  /** POSIX paths relative to the root, files only. `patterns` narrows the listing; omit for everything. */
  glob(patterns: string[] | null, ignore: string[], maxDepth: number): string[];
  exists(rel: string): boolean;
  /** Raw bytes, or null if missing or unreadable. */
  readBytes(rel: string): Buffer | null;
  /** Size in bytes, or null if missing. */
  size(rel: string): number | null;
  /** Canonical path used to recognise symlinks that point at the same file. */
  realPath(rel: string): string;
  /** Absolute path for display and diagnostics; may be a virtual label for non-disk systems. */
  abs(rel: string): string;
}

const MAX_VISITED = 500_000;

export function diskFs(root: string): FileSystem {
  return {
    glob(patterns, ignore, maxDepth) {
      // Own walker (no glob dependency): symlinked directories are never entered, so there are no loops;
      // symlinked files are listed when their target is a regular file.
      const include = patterns ? picomatch(patterns, { dot: true }) : () => true;
      const skip = ignore.length ? picomatch(ignore, { dot: true }) : () => false;
      const out: string[] = [];
      let visited = 0;
      const walk = (rel: string, depth: number): void => {
        if (depth > maxDepth || visited > MAX_VISITED) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          visited++;
          const r = rel === "" ? e.name : `${rel}/${e.name}`;
          if (e.isDirectory()) {
            if (!skip(`${r}/__probe__`)) walk(r, depth + 1);
          } else if (e.isFile() || e.isSymbolicLink()) {
            if (e.isSymbolicLink()) {
              try {
                if (!fs.statSync(path.join(root, r)).isFile()) continue;
              } catch {
                continue;
              }
            }
            if (include(r) && !skip(r)) out.push(r);
          }
        }
      };
      walk("", 0);
      return out.sort();
    },
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    readBytes(rel) {
      try {
        return fs.readFileSync(path.join(root, rel));
      } catch {
        return null;
      }
    },
    size(rel) {
      try {
        return fs.statSync(path.join(root, rel)).size;
      } catch {
        return null;
      }
    },
    realPath(rel) {
      try {
        return fs.realpathSync(path.join(root, rel));
      } catch {
        return path.join(root, rel);
      }
    },
    abs: (rel) => path.join(root, rel),
  };
}

/** In-memory file system for tests, editors and the planned client-side web checker. */
export function memoryFs(files: Record<string, string | Buffer>, label = "/memory"): FileSystem {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const store = new Map<string, Buffer>(Object.entries(files).map(([k, v]) => [norm(k), Buffer.isBuffer(v) ? v : Buffer.from(v, "utf8")]));
  return {
    glob(patterns, ignore) {
      const include = patterns ? picomatch(patterns, { dot: true }) : () => true;
      const skip = ignore.length ? picomatch(ignore, { dot: true }) : () => false;
      return [...store.keys()].filter((p) => include(p) && !skip(p)).sort();
    },
    exists: (rel) => {
      const r = norm(rel);
      if (store.has(r)) return true;
      const prefix = r.endsWith("/") ? r : r + "/";
      return [...store.keys()].some((k) => k.startsWith(prefix));
    },
    readBytes: (rel) => store.get(norm(rel)) ?? null,
    size: (rel) => store.get(norm(rel))?.length ?? null,
    realPath: (rel) => `${label}/${norm(rel)}`,
    abs: (rel) => `${label}/${norm(rel)}`,
  };
}

export type DecodeResult = { text: string } | { skip: string };

/** Decode instruction-file bytes safely: strip BOM, support UTF-16, refuse binary content. */
export function decode(buf: Buffer): DecodeResult {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString("utf16le") };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString("utf16le") };
  }
  const start = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  const slice = buf.subarray(start, Math.min(buf.length, start + 8192));
  if (slice.includes(0)) return { skip: "contains NUL bytes (binary or unsupported encoding)" };
  return { text: buf.subarray(start).toString("utf8") };
}
