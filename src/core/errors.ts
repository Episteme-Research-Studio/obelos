/** Stable exit-code contract. Documented in docs/SPEC.md; changing a value is a breaking change. */
export const EXIT = {
  OK: 0,
  /** Findings at or above the failure threshold, or too many warnings. */
  FINDINGS: 1,
  /** Usage error or invalid configuration. */
  USAGE: 2,
  /** Internal error or a hard limit was hit. */
  INTERNAL: 3,
} as const;

export type ErrorCode =
  | "USAGE"
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "BASELINE_INVALID"
  | "NOT_A_GIT_REPO"
  | "GIT_FAILED"
  | "PATH_NOT_FOUND"
  | "LIMIT_EXCEEDED"
  | "INTERNAL";

const EXIT_FOR: Record<ErrorCode, number> = {
  USAGE: EXIT.USAGE,
  CONFIG_NOT_FOUND: EXIT.USAGE,
  CONFIG_INVALID: EXIT.USAGE,
  BASELINE_INVALID: EXIT.USAGE,
  NOT_A_GIT_REPO: EXIT.USAGE,
  GIT_FAILED: EXIT.USAGE,
  PATH_NOT_FOUND: EXIT.USAGE,
  LIMIT_EXCEEDED: EXIT.INTERNAL,
  INTERNAL: EXIT.INTERNAL,
};

export class ObelosError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ObelosError";
    this.code = code;
  }
  get exitCode(): number {
    return EXIT_FOR[this.code];
  }
}

export function exitCodeFor(e: unknown): number {
  return e instanceof ObelosError ? e.exitCode : EXIT.INTERNAL;
}
