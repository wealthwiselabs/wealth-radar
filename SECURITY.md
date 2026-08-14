# Security Policy

This app handles financial data, bank connections (Plaid), encryption keys, and a login
gate — so please report security issues **privately**, not in public issues or discussions.

## Reporting a vulnerability

- Preferred: use GitHub's **private vulnerability reporting** — the **Security** tab →
  **Report a vulnerability**. It's a private channel between you and the maintainer.
- Or email **<your-email@example.com>** *(maintainer: replace with your address)*.

Please include steps to reproduce and the potential impact. I'll acknowledge as soon as I
can, and I'd appreciate a reasonable window to fix before any public disclosure.

## Scope — good things to look for

- Auth-gate bypass (`src/middleware.ts`, `src/lib/auth.ts`)
- Leakage or weak handling of `APP_ENCRYPTION_KEY` / stored Plaid tokens
- Anything that could expose one instance's data to another party

## Not in scope

- Findings that require already having the shared login password
- Issues in Plaid or the Anthropic API themselves (report to those vendors)
