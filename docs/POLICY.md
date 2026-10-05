# Policy as code

Policies let a team enforce its own rules on instruction files without writing code. The engine is free and part of the open-source core; shared organisation policy packs and enforcement across repositories may be offered separately later (ADR-013).

## Defining policies

In `obelos.config.json`:

```json
{
  "policies": [
    { "id": "security-section", "requireHeading": "Security", "severity": "error",
      "message": "Every AGENTS.md needs a Security section.", "files": ["**/AGENTS.md"] },
    { "id": "no-todo", "forbid": "\\bTODO\\b", "severity": "warn" },
    { "id": "name-the-test-command", "require": "npm (run )?test|pnpm test", "tools": ["agents"], "severity": "info" }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | 1 to 40 letters, digits, `-` or `_`. The finding's rule ID is `POL-<ID in capitals>`. |
| `files` | Globs of instruction files the policy applies to (default: all). |
| `tools` | Restrict to `claude`, `agents`, `cursor`, `copilot`, `gemini`. |
| `require` | Regular expression that must match somewhere in the file. |
| `forbid` | Regular expression that no line may match (reported with a line number, at most 20 per file). |
| `requireHeading` | A Markdown heading with this text (case-insensitive) must exist. |
| `flags` | Regex flags, default `i`. `g` and `y` are ignored. |
| `severity` | `error`, `warn` or `info`. |
| `message` | Replaces the default message. `description` becomes the hint. |

A policy needs at least one of `require`, `forbid`, `requireHeading`. Invalid regular expressions, tools or ids are configuration errors (exit code 2).

## Working with policy findings

A policy finding behaves like any rule: re-level it (`"rules": { "POL-NO-TODO": "error" }`), switch it off (`"off"`), suppress it inline (`<!-- obelos-disable-next-line POL-NO-TODO -->`, optionally with `until=`), baseline it, and see it in every output format. `"rules": { "OBL900": "off" }` disables all policies.

## Sharing across repositories

Put policies in a shared file and extend it:

```json
{ "extends": ["obelos:recommended", "./.obelos/org-policy.json"] }
```

Today the path is relative to the config file, so teams distribute the file with a git submodule, subtree or a sync job. Resolving `extends` from an npm package or a git URL is planned. Policies from later layers replace earlier ones with the same `id`.

## Limits

Regular expressions have no timeout; keep them simple and only extend trusted files (see docs/SECURITY-AND-SUPPLY-CHAIN.md). Policies see the whole file text and cannot yet express "heading X must contain item Y" or cross-file rules; those need the plugin API (FEATURES C10).
