# PLAN_FOR_V0_23_0 — Keychain master key + web media + Postgres warehouse

**Status:** **complete** (Tracks K + W + P shipped in **0.23.0**)  
**Baseline:** monorepo **0.22.0** → **0.23.0**  
**Method:** parallel worktree subagents, **TDD**

## One-line

Three product/ops tracks: **operator-controlled encryption master key**, **web Media generate UI**, optional **Postgres run warehouse**.

## Train map

| Track | Theme | Impl | Status |
|---|---|---|---|
| **K** | Secrets key source (env / file keychain / legacy) | [`v0.23.0`](../implementation/v0.23/v0.23.0.md) | **done** |
| **W** | Web Media page + OpenAI settings row | [`v0.23.1`](../implementation/v0.23/v0.23.1.md) | **done** |
| **P** | Optional Postgres run warehouse | [`v0.23.2`](../implementation/v0.23/v0.23.2.md) | **done** |

## Non-goals

- Native macOS Keychain via keytar (file keychain + env is MVP)  
- Full web workflow editor  
- Replacing SQLite app DB with Postgres  

## Acceptance

| Case | Expected |
|---|---|
| `NEOS_MASTER_KEY` set | `NEOS_SECRETS_KEY_SOURCE=env` |
| Default legacy installs | Still decrypt with legacy machine key |
| Web `/media` | List + generate with tests green |
| `NEOS_RUN_WAREHOUSE=off` | All existing run tests green |
| Memory warehouse dual-write | Unit tests green |
| `pnpm inventory:check` | `v23Features` ok |
