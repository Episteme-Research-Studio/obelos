import fs from "node:fs";
import path from "node:path";
import { ObelosError } from "./errors.js";
import type { Config, Limits, Policy, Severity, Tool } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  rules: {},
  ruleOptions: {},
  ignore: [],
  ignorePathRefs: ["dist/**", "build/**", "out/**", ".next/**", "coverage/**", "node_modules/**", "target/**", "tmp/**"],
  budgets: {
    claudeLines: 200, // Claude Code docs: target under 200 lines per CLAUDE.md
    cursorLines: 500, // Cursor docs: keep rules under 500 lines
    agentsLines: 500,
    otherLines: 500,
    aggregateBytes: 32 * 1024, // Codex reportedly truncates combined instructions at 32 KiB (secondary source)
  },
  limits: {
    maxFileBytes: 1024 * 1024,
    maxInstructionFiles: 500,
    maxDepth: 20,
    timeoutMs: 30_000,
  },
  policies: [],
  sources: [],
};

export const CONFIG_NAMES = ["obelos.config.json", ".obelosrc.json"];

const SEVERITIES = new Set<string>(["error", "warn", "info", "off"]);
const TOOLS = new Set<string>(["claude", "agents", "cursor", "copilot", "gemini"]);
const KNOWN_KEYS = new Set(["$schema", "extends", "rules", "ignore", "ignorePathRefs", "budgets", "limits", "policies"]);
const RULE_ID = /^(OBL\d{3}|POL-[A-Z0-9_-]+)$/;
const POLICY_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_EXTENDS_DEPTH = 5;

/** Built-in presets. Heuristic rules are never raised to `error`. */
export const PRESETS: Record<string, Record<string, unknown>> = {
  recommended: {},
  strict: {
    rules: {
      OBL001: "error", OBL004: "error", OBL005: "error", OBL006: "error", OBL007: "error", OBL010: "error", OBL017: "error", OBL018: "error",
      OBL008: "warn", OBL012: "warn", OBL014: "warn", OBL019: "warn", OBL026: "warn", OBL027: "warn",
    },
  },
  minimal: {
    rules: { OBL002: "off", OBL008: "off", OBL011: "off", OBL012: "off", OBL014: "off", OBL015: "off", OBL019: "off", OBL026: "off", OBL027: "off" },
  },
};

export interface MergeContext {
  /** Directory that relative `extends` paths resolve against. */
  baseDir?: string;
  /** Label recorded in `sources`. */
  label?: string;
  read?: (absPath: string) => string | null;
  depth?: number;
  seen?: Set<string>;
}

function bad(msg: string): never {
  throw new ObelosError("CONFIG_INVALID", msg);
}

function readDisk(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function loadConfig(root: string, explicit?: string): Config {
  const candidates = explicit ? [path.resolve(explicit)] : CONFIG_NAMES.map((n) => path.join(root, n));
  for (const file of candidates) {
    const text = readDisk(file);
    if (text === null) continue;
    return parseConfigText(text, file);
  }
  if (explicit) throw new ObelosError("CONFIG_NOT_FOUND", `Config file not found: ${explicit}`);
  return structuredClone(DEFAULT_CONFIG);
}

export function parseConfigText(text: string, file: string, ctx: MergeContext = {}): Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ObelosError("CONFIG_INVALID", `Could not parse config ${file}: ${(e as Error).message}`);
  }
  try {
    return mergeConfig(parsed, { baseDir: path.dirname(file), label: file, ...ctx });
  } catch (e) {
    if (e instanceof ObelosError) throw new ObelosError(e.code, `${file}: ${e.message}`);
    throw e;
  }
}

function normaliseRules(raw: unknown, out: Config): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad(`"rules" must be an object mapping rule IDs to severities.`);
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.toUpperCase();
    if (!RULE_ID.test(id)) bad(`Unknown rule ID "${key}". Rule IDs look like OBL012 or POL-MY-POLICY.`);
    let severity: unknown = v;
    if (Array.isArray(v)) {
      severity = v[0];
      const opts = v[1];
      if (opts !== undefined) {
        if (!opts || typeof opts !== "object" || Array.isArray(opts)) bad(`Options for ${id} must be an object.`);
        out.ruleOptions[id] = { ...(out.ruleOptions[id] ?? {}), ...(opts as Record<string, unknown>) };
      }
    }
    if (typeof severity !== "string" || !SEVERITIES.has(severity)) bad(`Invalid severity for rule ${id}: ${String(severity)}. Use error, warn, info or off.`);
    out.rules[id] = severity as Severity | "off";
  }
}

function normalisePolicy(raw: unknown, index: number): Policy {
  if (!raw || typeof raw !== "object") bad(`policies[${index}] must be an object.`);
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !POLICY_ID.test(p.id)) bad(`policies[${index}].id must be 1-40 characters of letters, digits, "-" or "_".`);
  if (!p.require && !p.forbid && !p.requireHeading) bad(`Policy "${String(p.id)}" needs at least one of require, forbid or requireHeading.`);
  const severity = (p.severity ?? "warn") as string;
  if (!["error", "warn", "info"].includes(severity)) bad(`Policy "${String(p.id)}" has invalid severity "${severity}".`);
  const flags = typeof p.flags === "string" ? p.flags : "i";
  if (!/^[gimsuy]*$/.test(flags)) bad(`Policy "${String(p.id)}" has invalid regex flags "${flags}".`);
  for (const key of ["require", "forbid"] as const) {
    const v = p[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.length === 0 || v.length > 500) bad(`Policy "${String(p.id)}".${key} must be a regular expression string of at most 500 characters.`);
    try {
      new RegExp(v, flags);
    } catch (e) {
      bad(`Policy "${String(p.id)}".${key} is not a valid regular expression: ${(e as Error).message}`);
    }
  }
  const tools = p.tools === undefined ? undefined : (Array.isArray(p.tools) ? p.tools : [p.tools]).map(String);
  if (tools?.some((t) => !TOOLS.has(t))) bad(`Policy "${String(p.id)}".tools must be among: ${[...TOOLS].join(", ")}.`);
  return {
    id: p.id,
    description: typeof p.description === "string" ? p.description : undefined,
    files: p.files === undefined ? ["**/*"] : (Array.isArray(p.files) ? p.files : [p.files]).map(String),
    tools: tools as Tool[] | undefined,
    require: p.require as string | undefined,
    forbid: p.forbid as string | undefined,
    requireHeading: typeof p.requireHeading === "string" ? p.requireHeading : undefined,
    flags,
    severity: severity as Severity,
    message: typeof p.message === "string" ? p.message : undefined,
  };
}

function overlay(base: Config, next: Config): Config {
  const out = structuredClone(base);
  out.rules = { ...base.rules, ...next.rules };
  for (const [id, o] of Object.entries(next.ruleOptions)) out.ruleOptions[id] = { ...(out.ruleOptions[id] ?? {}), ...o };
  out.ignore = [...new Set([...base.ignore, ...next.ignore])];
  out.ignorePathRefs = [...new Set([...base.ignorePathRefs, ...next.ignorePathRefs])];
  out.budgets = { ...base.budgets, ...next.budgets };
  out.limits = { ...base.limits, ...next.limits };
  const byId = new Map(base.policies.map((p) => [p.id, p]));
  for (const p of next.policies) byId.set(p.id, p);
  out.policies = [...byId.values()];
  out.sources = [...base.sources, ...next.sources];
  return out;
}

/** Validate a parsed config object and resolve `extends`. Later layers win; `ignore`, `ignorePathRefs` and policies accumulate. */
export function mergeConfig(input: unknown, ctx: MergeContext = {}): Config {
  const base = structuredClone(DEFAULT_CONFIG);
  if (input === undefined || input === null) return base;
  if (typeof input !== "object" || Array.isArray(input)) bad("The config must be a JSON object.");
  const c = input as Record<string, unknown>;
  for (const k of Object.keys(c)) if (!KNOWN_KEYS.has(k)) bad(`Unknown config key "${k}". Known keys: ${[...KNOWN_KEYS].filter((x) => x !== "$schema").join(", ")}.`);

  let acc = base;
  const depth = ctx.depth ?? 0;
  if (c.extends !== undefined) {
    if (depth >= MAX_EXTENDS_DEPTH) bad(`"extends" is nested more than ${MAX_EXTENDS_DEPTH} levels deep.`);
    const list = Array.isArray(c.extends) ? c.extends : [c.extends];
    for (const e of list) {
      if (typeof e !== "string") bad(`"extends" entries must be strings.`);
      const preset = e.startsWith("obelos:") ? e.slice("obelos:".length) : undefined;
      if (preset !== undefined) {
        const p = PRESETS[preset];
        if (!p) bad(`Unknown preset "${e}". Available: ${Object.keys(PRESETS).map((n) => `obelos:${n}`).join(", ")}.`);
        const layer = mergeConfig(p, { ...ctx, depth: depth + 1, label: e });
        layer.sources = [e];
        acc = overlay(acc, layer);
        continue;
      }
      const abs = path.resolve(ctx.baseDir ?? process.cwd(), e);
      const seen = ctx.seen ?? new Set<string>();
      if (seen.has(abs)) bad(`Circular "extends": ${abs}`);
      const text = (ctx.read ?? readDisk)(abs);
      if (text === null) bad(`Cannot read extended config ${e} (resolved to ${abs}).`);
      acc = overlay(acc, parseConfigText(text, abs, { ...ctx, depth: depth + 1, seen: new Set([...seen, abs]) }));
    }
  }

  const own = structuredClone(DEFAULT_CONFIG);
  own.ignorePathRefs = [];
  normaliseRules(c.rules, own);
  if (c.ignore !== undefined) {
    if (!Array.isArray(c.ignore)) bad(`"ignore" must be an array of globs.`);
    own.ignore = c.ignore.map(String);
  }
  if (c.ignorePathRefs !== undefined) {
    if (!Array.isArray(c.ignorePathRefs)) bad(`"ignorePathRefs" must be an array of globs.`);
    own.ignorePathRefs = c.ignorePathRefs.map(String);
  }
  const ownBudgets: Partial<Config["budgets"]> = {};
  if (c.budgets !== undefined) {
    if (!c.budgets || typeof c.budgets !== "object") bad(`"budgets" must be an object.`);
    for (const [k, v] of Object.entries(c.budgets as Record<string, unknown>)) {
      if (!(k in DEFAULT_CONFIG.budgets)) bad(`Unknown budget "${k}". Known: ${Object.keys(DEFAULT_CONFIG.budgets).join(", ")}.`);
      if (typeof v !== "number" || !(v > 0)) bad(`Budget "${k}" must be a positive number.`);
      (ownBudgets as Record<string, number>)[k] = v;
    }
  }
  const ownLimits: Partial<Limits> = {};
  if (c.limits !== undefined) {
    if (!c.limits || typeof c.limits !== "object") bad(`"limits" must be an object.`);
    for (const [k, v] of Object.entries(c.limits as Record<string, unknown>)) {
      if (!(k in DEFAULT_CONFIG.limits)) bad(`Unknown limit "${k}". Known: ${Object.keys(DEFAULT_CONFIG.limits).join(", ")}.`);
      if (typeof v !== "number" || !(v > 0)) bad(`Limit "${k}" must be a positive number.`);
      (ownLimits as Record<string, number>)[k] = v;
    }
  }
  if (c.policies !== undefined) {
    if (!Array.isArray(c.policies)) bad(`"policies" must be an array.`);
    own.policies = c.policies.map((p, i) => normalisePolicy(p, i));
  }
  own.budgets = ownBudgets as Config["budgets"];
  own.limits = ownLimits as Limits;
  own.sources = ctx.label ? [ctx.label] : [];
  return overlay(acc, own);
}
