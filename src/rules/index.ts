import type { Rule } from "../core/types.js";
import { aggregateBudget, sizeBudget } from "./size.js";
import { brokenImport, missingPathReference, missingScriptReference, scopedGlobMatchesNothing } from "./references.js";
import { localFileNotGitignored, claudeIgnoresAgentsMd, copilotApplyToMissing, cursorFrontmatter, cursorMdIgnored, frontmatterInvalid } from "./tooling.js";
import { emphasisOveruse, expiredSuppression, noBuildOrTestCommand, wallOfText } from "./hygiene.js";
import { policyEngine } from "./policy.js";
import { contradictoryInstruction, duplicateInstruction, emptyOrPlaceholder, secretDetected, vagueInstruction } from "./quality.js";

export const RULES: Rule[] = [
  sizeBudget,
  aggregateBudget,
  brokenImport,
  missingPathReference,
  missingScriptReference,
  claudeIgnoresAgentsMd,
  cursorMdIgnored,
  cursorFrontmatter,
  copilotApplyToMissing,
  scopedGlobMatchesNothing,
  duplicateInstruction,
  vagueInstruction,
  secretDetected,
  emptyOrPlaceholder,
  contradictoryInstruction,
  frontmatterInvalid,
  localFileNotGitignored,
  expiredSuppression,
  noBuildOrTestCommand,
  wallOfText,
  emphasisOveruse,
  policyEngine,
].sort((a, b) => a.id.localeCompare(b.id));
