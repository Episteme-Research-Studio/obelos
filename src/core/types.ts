export type Tool = "claude" | "agents" | "cursor" | "copilot" | "gemini";
export type Severity = "error" | "warn" | "info";

export type FileKind =
  | "claude-md"
  | "claude-local"
  | "claude-rule"
  | "agents-md"
  | "cursor-rule"
  | "cursor-legacy"
  | "copilot-repo"
  | "copilot-path"
  | "gemini-md";

export interface Ref {
  value: string;
  line: number;
}

export interface ContextFile {
  /** POSIX path relative to the workspace root. */
  path: string;
  abs: string;
  realPath: string;
  tool: Tool;
  kind: FileKind;
  /** POSIX directory relative to the workspace root ("" for root). */
  dir: string;
  raw: string;
  /** All lines of the file, frontmatter included (index 0 = line 1). */
  lines: string[];
  bytes: number;
  /** Rough estimate: bytes / 4. Not a real tokenizer. */
  tokens: number;
  frontmatter: Record<string, unknown> | null;
  frontmatterError?: string;
  /** Frontmatter that is not strict YAML but could be read leniently (unquoted globs, colons in values). */
  strictYamlError?: string;
  /** 1-based line number where the body starts. */
  bodyStart: number;
  imports: Ref[];
  pathRefs: Ref[];
  scriptRefs: Ref[];
  /** Inline suppressions parsed from HTML comments. */
  disables: Disables;
}

/** `all` means every rule; otherwise a set of rule IDs. */
export type RuleSet = "all" | Set<string>;

export interface Suppression {
  scope: "file" | "line" | "next-line";
  rules: RuleSet;
  /** 1-based line of the comment itself. */
  line: number;
  /** Optional expiry date (YYYY-MM-DD, inclusive). */
  until?: string;
  reason?: string;
}

export interface Disables {
  file: RuleSet | null;
  /** Map of 1-based line number to the rules disabled for that line. */
  lines: Map<number, RuleSet>;
  /** Every suppression comment found, active or not. */
  entries: Suppression[];
  /** Suppressions whose `until` date has passed; they no longer apply. */
  expired: Suppression[];
}

/** A text edit for a future autofix. Positions are 1-based; `endLine`/`endColumn` are exclusive. */
export interface Edit {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  newText: string;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  file: string;
  line?: number;
  /** 1-based column of the start of the finding, when a rule can say. */
  column?: number;
  endLine?: number;
  endColumn?: number;
  hint?: string;
  /** Safe, idempotent edits that would fix the finding (consumed by the planned `fix` command and editor quick fixes). */
  fix?: Edit[];
}

export interface Budgets {
  claudeLines: number;
  cursorLines: number;
  agentsLines: number;
  otherLines: number;
  aggregateBytes: number;
}

export interface Limits {
  /** Instruction files larger than this are skipped with a notice. */
  maxFileBytes: number;
  /** Discovery stops after this many instruction files. */
  maxInstructionFiles: number;
  /** Directory depth searched for instruction files. */
  maxDepth: number;
  /** Soft wall-clock limit for the whole run; remaining rules are skipped with a notice. */
  timeoutMs: number;
}

/** A declarative, organisation-defined rule (policy as code, free tier). */
export interface Policy {
  id: string;
  description?: string;
  /** Globs of instruction files the policy applies to. Default: all. */
  files: string[];
  /** Restrict to these tools (claude, agents, cursor, copilot, gemini). */
  tools?: Tool[];
  /** Every matching file must contain a match for this regular expression. */
  require?: string;
  /** No line may match this regular expression. */
  forbid?: string;
  /** Every matching file must contain a Markdown heading with this text (case-insensitive). */
  requireHeading?: string;
  /** Regex flags for require and forbid. Default "i". */
  flags?: string;
  severity: Severity;
  message?: string;
}

export interface Config {
  rules: Record<string, Severity | "off">;
  /** Per-rule options, e.g. { OBL013: { allow: ["^sk-test-"] } }. */
  ruleOptions: Record<string, Record<string, unknown>>;
  ignore: string[];
  ignorePathRefs: string[];
  budgets: Budgets;
  limits: Limits;
  policies: Policy[];
  /** Config files and presets that contributed, in application order (for --verbose and `config`). */
  sources: string[];
}

export interface Workspace {
  root: string;
  config: Config;
  /** Today as YYYY-MM-DD; injectable so runs are reproducible. */
  today: string;
  exists(rel: string): boolean;
  /** Read a workspace file as text, or null if missing or unreadable. */
  read(rel: string): string | null;
  allFiles(): string[];
  scriptsFor(dir: string): Set<string>;
}

export interface RuleDocs {
  why: string;
  fix: string;
  bad?: string;
  good?: string;
  sources?: string[];
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  defaultSeverity: Severity;
  /** Rule API version. Absent means 1. Reserved for the plugin API. */
  apiVersion?: 1;
  /** Whether an autofix is planned or available. */
  fixable?: boolean;
  run(files: ContextFile[], ws: Workspace): Diagnostic[];
}

export interface LintResult {
  root: string;
  files: ContextFile[];
  diagnostics: Diagnostic[];
  score: number;
  grade: string;
  /** Findings hidden by a baseline file. */
  baselined: number;
  /** Findings hidden by inline disable comments. */
  suppressed: number;
  /** Present when the run was restricted to changed files. */
  scope?: { mode: "changed"; since?: string; changedFiles: number };
  /** Timing and provenance for --verbose and --debug. */
  stats: RunStats;
}

export interface RunStats {
  totalMs: number;
  filesDiscovered: number;
  rules: { id: string; ms: number; findings: number }[];
  configSources: string[];
  /** Instruction files skipped (too large, binary, over the file cap). */
  skipped: string[];
}
