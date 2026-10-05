import type { LintResult } from "../core/types.js";
import { formatText } from "./text.js";
import { formatJson } from "./json.js";
import { formatSarif } from "./sarif.js";
import { formatMarkdown } from "./markdown.js";
import { formatGithub } from "./github.js";
import { formatCheckstyle, formatJunit } from "./xml.js";

export interface ReportOptions {
  color: boolean;
}
/** A reporter is a pure function of the result. */
export type Reporter = (result: LintResult, options: ReportOptions) => string;

const registry = new Map<string, Reporter>([
  ["text", (r, o) => formatText(r, o.color)],
  ["json", (r) => formatJson(r)],
  ["sarif", (r) => formatSarif(r)],
  ["markdown", (r) => formatMarkdown(r)],
  ["github", (r) => formatGithub(r)],
  ["junit", (r) => formatJunit(r)],
  ["checkstyle", (r) => formatCheckstyle(r)],
]);

export function registerReporter(name: string, reporter: Reporter): void {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid reporter name "${name}".`);
  registry.set(name, reporter);
}
export const reporterNames = (): string[] => [...registry.keys()];
export function getReporter(name: string): Reporter | undefined {
  return registry.get(name);
}
