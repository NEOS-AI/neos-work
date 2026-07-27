---
name: refactor-safe
description: Safe refactor guidance that preserves behavior and tests.
version: 1.0.0
mode: agent
category: code
triggers: refactor, extract, rename safely
example-prompt: Refactor this module without changing public behavior
---
# Safe refactor

Propose a minimal, behavior-preserving refactor.

## Rules

- Do not change public API unless requested
- Keep or update tests in the same change
- Prefer small commits / steps
- Call out risk and rollback

When editing Design Project files, use patch / replace-selection modes.
