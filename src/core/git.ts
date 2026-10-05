import { execFileSync } from "node:child_process";
import path from "node:path";
import { ObelosError } from "./errors.js";

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (err.code === "ENOENT") throw new ObelosError("GIT_FAILED", "git is not installed or not on PATH.");
    throw new ObelosError("GIT_FAILED", `git ${args.slice(0, 2).join(" ")} failed: ${String(err.stderr ?? err.message).trim().split("\n")[0]}`);
  }
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/**
 * Paths (POSIX, relative to `root`) that changed: committed since `since` (merge-base with HEAD),
 * plus staged, unstaged and untracked files. Deleted files are included because a deleted path
 * can break references. Arguments are passed without a shell.
 */
export function changedPaths(rootInput: string, since?: string): Set<string> {
  const root = path.resolve(rootInput);
  try {
    git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch (e) {
    if (e instanceof ObelosError && /not installed/.test(e.message)) throw e;
    throw new ObelosError("NOT_A_GIT_REPO", `${root} is not inside a git repository, so --changed-only/--since cannot work.`);
  }
  const out = new Set<string>();
  let hasHead = true;
  try {
    git(root, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    hasHead = false;
  }
  if (since !== undefined) {
    if (!hasHead) throw new ObelosError("GIT_FAILED", "The repository has no commits yet, so --since has nothing to compare with. Use --changed-only.");
    if (since.startsWith("-") || !/^[\w./@^~-]+$/.test(since)) throw new ObelosError("USAGE", `Invalid git ref for --since: "${since}".`);
    for (const l of lines(git(root, ["diff", "--name-only", "--relative", "--no-renames", `${since}...HEAD`, "--"]))) out.add(l);
  }
  if (hasHead) for (const l of lines(git(root, ["diff", "--name-only", "--relative", "--no-renames", "HEAD", "--"]))) out.add(l);
  else for (const l of lines(git(root, ["ls-files", "--cached"]))) out.add(l);
  for (const l of lines(git(root, ["ls-files", "--others", "--exclude-standard"]))) out.add(l);
  return out;
}
