---
name: design-harness-review
description: Suggest stale RULES.md Corrections to prune. Does not delete files.
version: 1.0.0
mode: design
category: design
featured: false
triggers: prune rules, stale design harness, corrections cleanup
example-prompt: Review RULES.md Corrections and list bullets that are stale or too specific
design-system-required: true
---
# Design harness review

Read the bound design system's `RULES.md` and review `## Corrections`.
Suggest which dated bullets (`- YYYY-MM-DD: …`) are stale, duplicated, or too
specific to keep injecting. This skill only suggests.

## Do

- List candidate bullets with date + one-line reason (stale / duplicate / over-specific).
- Tell the user to prune via the existing API, which works **without** this skill:
  `POST /api/design-systems/:id/rules/prune`
  Body `{}` uses defaults (drop Corrections older than 90 days, then keep 20).
  Desktop: **Prune stale corrections** on the RULES.md tab (confirm first).
- If no design system is bound, say so and stop (`design-system-required`).

## Do not

- Do not delete files. Do not rewrite `RULES.md` yourself.
- Do not POST prune or append unless the user explicitly confirms after the list.
- Do not critique HTML/CSS (use `design-critique` for that).
- Do not edit workers or `/api/workers`.
- Do not invent another review skill name. This package is `design-harness-review` only.
