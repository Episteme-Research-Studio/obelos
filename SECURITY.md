# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Do not open a public issue for security problems. You will get an acknowledgement within a few days; this is a small studio, so please allow reasonable time for a fix.

## Scope

Obelos reads files in the directory you point it at and prints findings. It makes no network calls, runs no repository code and sends no telemetry. In scope: crashes or hangs on crafted input, reading outside the target directory, command execution, output that leaks a detected secret, and weaknesses in the release pipeline. Details of the threat model and supply-chain controls are in docs/SECURITY-AND-SUPPLY-CHAIN.md.

## Supported versions

Pre-1.0: only the latest published version receives fixes.
