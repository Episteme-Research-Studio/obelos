import path from "node:path";
import { detectStack, renderAgentsMd, type StackInfo } from "./stack.js";
import type { FileSystem } from "./fs.js";

export interface InitPlanItem {
  path: string;
  action: "create" | "skip";
  reason?: string;
  content: string;
}

export interface InitPlan {
  stack: StackInfo;
  items: InitPlanItem[];
}

const CLAUDE_MD = "@AGENTS.md\n\n# Claude Code notes\n\n- Add Claude-specific settings here; shared rules live in AGENTS.md.\n- Keep this file short so every tool reads the same project-wide instructions.\n";

/**
 * Plan a minimal, correct starting point: AGENTS.md with detected commands, plus a CLAUDE.md that imports it
 * (Claude Code reads CLAUDE.md, not AGENTS.md, when both exist). Never overwrites an existing file.
 */
export function planInit(fsys: FileSystem, projectName: string, stack?: string): InitPlan {
  const info = detectStack(fsys, stack);
  const items: InitPlanItem[] = [];
  const agentsExists = fsys.exists("AGENTS.md");
  const claudeExists = fsys.exists("CLAUDE.md");
  items.push(
    agentsExists
      ? { path: "AGENTS.md", action: "skip", reason: "already exists", content: "" }
      : { path: "AGENTS.md", action: "create", content: renderAgentsMd(info, path.basename(projectName) || "Project") },
  );
  items.push(claudeExists ? { path: "CLAUDE.md", action: "skip", reason: "already exists", content: "" } : { path: "CLAUDE.md", action: "create", content: CLAUDE_MD });
  return { stack: info, items };
}
