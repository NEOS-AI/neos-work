---
name: docx-report
description: Create a Microsoft Word (.docx) report from research, notes, or structured findings.
version: 1.0.0
mode: agent
category: docs
featured: true
triggers: word, docx, report, memo
example-prompt: Write a 4-page findings report as report.docx
---
# Word report

Produce a real `.docx` file in the workspace (not just markdown).

## When to use

- User asks for a Word doc, memo, brief, or `.docx`
- Multi-section report with headings, lists, and a summary

## Steps

1. Confirm title, audience, and output path (default `report.docx`).
2. Draft structure: summary, context, findings, recommendations, appendix.
3. Generate the `.docx` with python-docx or an equivalent local tool when available.
4. If no generator is installed, write `report.md` **and** a `generate_docx.py` script the user can run, then say what is missing.
5. Verify the file exists and report the path.

## Style

- Short paragraphs
- Heading hierarchy (H1 title, H2 sections)
- Tables for comparisons when useful
- Cite sources inline when the user provided them

## Output

- The `.docx` path
- Section list
- Any tools that were unavailable
