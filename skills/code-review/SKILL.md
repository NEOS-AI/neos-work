---
name: code-review
description: Structured code review focusing on correctness, security, and maintainability.
version: 1.0.0
mode: agent
category: code
featured: true
triggers: review, PR review, code review
example-prompt: Review the open diff for security and edge cases
---
# Code review

Review the provided code or git diff.

## Checklist

1. Correctness and edge cases
2. Security (injection, authz, path traversal, secrets)
3. Performance hotspots
4. API / type contract breaks
5. Test gaps

## Output format

- **Summary** (2–4 bullets)
- **Blocking issues** (must fix)
- **Suggestions** (nice to have)
- **Questions** for the author
