# Agent rules

This file is the behavioral half of the design harness.
Visual tokens live in DESIGN.md and tokens.css. Do not duplicate palettes here.

## Tools
- Prefer editing the open project HTML/CSS. Do not start from an empty document when a seed file exists.
- Use Design Editor selection / preview comments when present.
- Produce self-contained, clickable HTML (hover, focus, scroll, transitions). Not a screenshot mock.

## Never
- Stay on the ink/paper/gray mono tokens (`--color-ink`, `--color-paper`, `--color-border`, `--color-muted`, `--font-mono`).
- Do not use decorative shadows. Use 1px solid borders only.
- Do not invent a new chromatic palette or font stack when tokens.css defines one.
- Do not use raw hex/rgb for brand colors in generated CSS.
- Do not ship inaccessible contrast or missing focus rings.
- Do not overwrite unrelated manual edits (prefer a minimal patch).

## Preferred workflow
- Start from the seed (current file, components.html, or a starter). Prefer wireframes / low-fi; single column, 65ch measure.
- Generate a few variants as sibling files, then narrow to one.
- After a human correction, wait for an explicit promote; do not rewrite RULES.md yourself unless asked.

## Corrections
<!-- dated bullets, pruned when stale. format: - YYYY-MM-DD: text -->
