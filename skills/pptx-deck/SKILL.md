---
name: pptx-deck
description: Create a PowerPoint (.pptx) slide deck from an outline, brief, or research notes.
version: 1.0.0
mode: agent
category: docs
featured: true
triggers: powerpoint, pptx, slide deck, presentation
example-prompt: Turn these notes into a 10-slide investor deck as deck.pptx
---
# PowerPoint deck

Produce a real `.pptx` file in the workspace (not just markdown slides).

## When to use

- User asks for a presentation, pitch deck, talk, or `.pptx`
- Notes / outline should become slides with titles and speaker notes

## Steps

1. Confirm audience, slide count, and output path (default `deck.pptx`).
2. Outline slides (title, 3–7 bullets max, optional notes).
3. Generate the `.pptx` with python-pptx or an equivalent local tool when available.
4. If no generator is installed, write `deck-outline.md` **and** a `generate_pptx.py` script the user can run, then say what is missing.
5. Open/verify the file exists and report the path.

## Slide rules

- One idea per slide
- Titles ≤ 8 words
- Prefer evidence over filler
- Include a title slide and a closing/next-steps slide

## Output

- The `.pptx` path
- Slide count
- Any fonts or tools that were unavailable
