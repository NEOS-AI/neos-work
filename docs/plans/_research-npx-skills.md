# Research: Vercel Labs `skills` CLI (`npx skills`)

**Researched:** 2026-09-18  
**Primary sources:** GitHub `vercel-labs/skills` (main @ `7407f38` / tag `v1.7.0`), npm package `skills@1.7.0`, live `npx skills@1.7.0 --help` (Node 22.23.1), official docs at skills.sh / agentskills.io / Vercel KB.  
**Not used as authority:** third-party blogs, Mintlify auto-docs mirrors, unofficial `pskills` clones. Those disagree with current source in several places (called out below).

**Method notes**

- Source files were fetched to `/tmp/skills-cli-research` (not this repo).
- `npx --yes skills@1.7.0 --help` was run read-only. The CLI was **not** used to install skills into the user's home or this workspace.
- Default system Node is v20.11.0; `skills@1.7.0` requires `node >= 22.20.0` and crashes on Node 20 (`styleText` missing from `node:util`). Help/version were captured under nvm Node 22.23.1.

---

## 1. Repo overview

### Purpose

`skills` is Vercel Labs' package manager for the open agent-skills ecosystem. It installs `SKILL.md` packages into the per-agent directories used by Claude Code, Cursor, Codex, OpenCode, Windsurf, Cline, and 70+ other agents.

From the README:

> The CLI for the open agent skills ecosystem.  
> Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and 75 more.

GitHub description: *"The open agent skills tool - npx skills"* ([repo](https://github.com/vercel-labs/skills)).

Vercel framed it as "a package manager for agent context" (Vercel blog / KB). The CLI is the installer; [skills.sh](https://skills.sh) is the discovery/leaderboard site powered by CLI telemetry.

The repo also ships one bundled skill, `skills/find-skills`, installable as `npx skills add vercel-labs/skills@find-skills`. That is a *skill* that teaches agents how to use this CLI — it is not the CLI itself.

### License

MIT. `LICENSE` (commit `e173b8c`, 2026-07-22):

```
MIT License

Copyright (c) 2026 Vercel, Inc.
```

npm `license` field: `"MIT"`. GitHub license API: `spdx_id: MIT`.

### Maintainers / authorship

| Source | Value |
| --- | --- |
| `LICENSE` | Copyright (c) 2026 Vercel, Inc. |
| `package.json` `author` | `""` (empty) |
| npm `_npmUser` | GitHub Actions OIDC (`npm-oidc-no-reply@github.com`) — trusted publisher via GitHub |
| npm `maintainers` | `rauchg` (rauchg@gmail.com), `quuu` (qual1337@gmail.com) |
| GitHub top contributors (API, 2026-09-18) | `quuu` 234, `github-actions[bot]` 50, `huozhi` 21, `jonathanhefner` 11, then many 2–8-commit contributors |
| Latest commit author | `vercel-labs publish bot` `<qual1337@gmail.com>` |

`quuu` is the primary committer and the person who tags releases. Guillermo Rauch (`rauchg`) is an npm maintainer but is not the day-to-day committer. Releases are cut by `github-actions`.

Cannot independently verify a named "product owner" beyond that.

### Latest release / npm package

| Field | Value | Source |
| --- | --- | --- |
| npm name | `skills` | `package.json`, [npmjs.com/package/skills](https://www.npmjs.com/package/skills) |
| Latest version | **1.7.0** | GitHub tag `v1.7.0` (2026-09-17T15:00:30Z), npm published ~11h before this research, `npx skills --version` prints `1.7.0` |
| Git tag SHA | `7407f3893ad4dceab546ac002c3ef806e4000c73` | GitHub releases + npm `gitHead` |
| Previous tags | `v1.6.0` (2026-09-16), `v1.5.26` (2026-09-11), then 1.5.x | GitHub releases |
| Engines | `node: ">=22.20.0"` | `package.json` |
| Package manager (dev) | `pnpm@10.17.1` | `package.json` |
| Runtime deps | `tar@^7.5.20`, `yaml@^2.8.3` | `package.json` (everything else is bundled by `obuild`) |
| Bins | `skills` → `./bin/cli.mjs`, `add-skill` → same file | `package.json` |
| Published files | `dist/`, `bin/`, `README.md`, `ThirdPartyNoticeText.txt` | `package.json` `files` |
| `exports` / `main` | **none** | published `package.json` |
| Type | ESM (`"type": "module"`) | `package.json` |
| Weekly npm downloads | 4,173,672 (2026-09-10..16) | npm downloads API |
| Monthly npm downloads | 31,655,444 (2026-08-18..09-16) | npm downloads API |
| GitHub | 31,902 stars, 2,725 forks, 1,192 open issues, created 2026-01-14 | GitHub API 2026-09-18 |
| Homepage | https://skills.sh | GitHub `homepage` |
| Repo homepage field | https://github.com/vercel-labs/skills#readme | `package.json` |

`v1.7.0` GitHub release body is empty. The commit immediately before the version tag is `feat: add Notion skills integration` (`5a63194`, 2026-09-17). `v1.6.0` added Azure Repos URL parsing and Labs README badges.

There is also a snapshot publish script (`npm publish --tag snapshot`) — not investigated beyond `package.json`.

### What the published tarball is

The npm package is a **CLI-only bundle**:

- `bin/cli.mjs` enables Node compile cache, then `import('../dist/cli.mjs')`.
- `dist/cli.mjs` is a ~322 KB bundled ESM file.
- `dist/cli.d.mts` is literally `export { };`.
- No `exports`, no `main`, no documented library entry.

### Official docs (primary)

| URL | What it is |
| --- | --- |
| https://github.com/vercel-labs/skills | Source of truth for CLI behavior |
| https://www.npmjs.com/package/skills | Mirrors README |
| https://skills.sh | Leaderboard / directory |
| https://skills.sh/docs/cli | Thin CLI page (install + packs + telemetry) |
| https://skills.sh/docs/faq | Packs, leaderboard, telemetry FAQ |
| https://agentskills.io | Open Agent Skills format (originally Anthropic) |
| https://agentskills.io/specification | `SKILL.md` spec |
| https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context | Official Vercel KB (slightly behind current CLI on a few aliases) |

Mintlify (`vercel-labs-skills.mintlify.app`) is an unofficial/auto-generated docs site. Several of its pages are stale (e.g. it still documents a standalone `skills check` and older Node 18 requirement). Do not treat it as current.

---

## 2. Full CLI command surface

Captured from `npx skills@1.7.0 --help` and `src/cli.ts`. Subcommand `--help` currently reprints the **global** help except for `remove`/`rm`/`r`, which have a dedicated help page.

Running with no args prints an ASCII `SKILLS` banner and a short command list, then exits 0. Inside a detected agent the banner is suppressed.

### Global flags

| Flag | Effect |
| --- | --- |
| `--help`, `-h` | Print help |
| `--version`, `-v` | Print `package.json` version (`1.7.0`) |

Unknown top-level commands print `Unknown command: …` and set `process.exitCode = 1`.

### Command index (what actually exists in `src/cli.ts`)

| User-facing command | Aliases in source | Handler | In `--help`? |
| --- | --- | --- | --- |
| `add <package>` | `a`, **`install`**, **`i`** | `runAdd` | yes (`add` only) |
| `use <package>@<skill>` | — | `runUse` | yes |
| `remove [skills]` | `rm`, `r` | `removeCommand` | yes |
| `list` | `ls` | `runList` | yes |
| `find [query]` | `search`, `f`, `s` | `runFind` | yes (`find` only) |
| `update [skills…]` | `upgrade`, **`check`** | `runUpdate` | yes (`update` only) |
| `init [name]` | — | `runInit` (inline) | yes |
| `experimental_install` | — | `runInstallFromLock` | yes |
| `experimental_sync` | — | `runSync` | yes |

**Important source-vs-docs mismatches**

- `AGENTS.md` says `skills i` / `skills install` (no args) restore from `skills-lock.json`. **False in current code.** `i` and `install` are aliases of `add` and require a source. Restore is only `experimental_install`.
- `AGENTS.md` and the Vercel KB still mention `npx skills check` as a distinct command. In current code `check` is an **alias of `update`**. It is not listed in `--help`.
- `generate-lock` does **not** exist. Unofficial clones document it; this repo does not.
- `search` / `f` / `s` work but are undocumented in `--help`.

### 2.1 `add` (`a`, `install`, `i`)

Install skills from a source into one or more agent directories.

```
npx skills add <package> [options]
```

**Arguments**

- One or more non-flag tokens are collected as `source[]`. Only `source[0]` is used (`runAdd` reads `args[0]`). Extra positional sources are silently ignored.
- Missing source: prints usage and exits 1.

**Flags** (`parseAddOptions` in `src/add.ts`)

| Flag | Default | Behavior |
| --- | --- | --- |
| `-g`, `--global` | project scope | Install under home (`~/<agent>/skills` / `~/.agents/skills`) instead of the project |
| `-a`, `--agent <names…>` | detect / prompt | Target agents. `*` = every agent in `src/agents.ts`. Multiple values until next flag. |
| `-s`, `--skill <names…>` | prompt / all-if-one | Filter by skill name (case-insensitive exact match on `name` or display name). `*` = all skills. Multi-word names must be quoted. |
| `-l`, `--list` | off | Discover and print skills, then exit without installing |
| `-y`, `--yes` | off | Skip confirmation, scope, and method prompts |
| `--copy` | symlink (when multiple unique dirs) | Copy instead of symlink |
| `--all` | off | Shorthand for `--skill '*' --agent '*' -y` |
| `--full-depth` | off | Recurse the whole tree even if a root `SKILL.md` exists; also disables the blob fast path |
| `--json` | off | Machine-readable JSON array on stdout; **requires** `--yes` or `--all`; cannot combine with `--list`; well-known sources not supported |
| `--metadata <json>` | none | Attached to the install telemetry event. Must parse as JSON or the CLI errors. |
| `--subagent <names…>` | Eve root only | Eve only. `root` or `.` = `agent/skills`; other names = `agent/subagents/<name>/skills`. Implies Eve. |

`@skill` syntax on the source (`owner/repo@skill-name`) is merged into `--skill`.

**Interactive flow** (when not `-y` and stdin is a TTY)

1. Parse source, fetch/clone/discover skills.
2. If more than one skill and no `--skill`: multiselect (skills.sh packs preselect all).
3. Detect installed agents via `detectInstalledAgents()`.
4. If multiple agents: locked "Universal (`.agents/skills`)" section + searchable picker. Last selection is remembered in the global lock (`lastSelectedAgents`). Defaults if no history: `claude-code`, `opencode`, `codex`.
5. If any selected agent supports global: prompt Project vs Global.
6. If more than one unique target dir and not `--copy`: prompt Symlink vs Copy.
7. Show installation summary (paths, overwrites).
8. Optionally show a **Security Risk Assessments** table (advisory; never blocks).
9. Confirm: `Proceed with installation?`
10. After success, one-time prompt to globally install `find-skills` (dismissed forever either way).

**Non-interactive / agent-host behavior**

- `@vercel/detect-agent` + `src/detect-agent.ts`: if running *inside* an agent, `-y` is forced and the detected agent + universal agents are auto-selected unless `--agent` was given.
- Cursor is only treated as an agent if `CURSOR_AGENT` is set or `CURSOR_EXTENSION_HOST_ROLE=agent-exec` (plain `CURSOR_TRACE_ID` is not enough).
- No TTY + a prompt is required → exit 1 with a hint to pass `--agent` and `-y`.
- `--json` without `-y`/`--all` → exit 1.

**Output**

- Human: clack spinner + notes. Success outro: `Done!  Review skills before use; they run with full agent permissions.`
- `--list`: grouped by plugin name if a Claude plugin manifest is present.
- `--json`: one object per skill:

```json
{
  "name": "web-design-guidelines",
  "status": "installed" | "skipped" | "failed",
  "source": "vercel-labs/agent-skills",
  "ref": null,
  "hash": "<sha256 or snapshot hash>",
  "path": "/abs/path/.agents/skills/web-design-guidelines",
  "scope": "project" | "global",
  "agents": ["Claude Code", "Cursor"],
  "mode": "symlink" | "copy",
  "security": { "gen": "safe", "socket": "0 alerts", "snyk": "low", "details": "https://skills.sh/…" },
  "reason": "…",
  "error": "…"
}
```

Any failed/skipped skill sets `exitCode = 1`.

### 2.2 `use`

Use one skill **without installing**. Resolves the same sources as `add`, writes the skill to a temp dir, and either:

- prints a generated prompt to **stdout only** (default), or
- with `--agent`, starts one supported agent interactively with that prompt.

```
npx skills use vercel-labs/agent-skills@web-design-guidelines | claude
npx skills use vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
```

**Flags** (`src/use.ts`)

| Flag | Notes |
| --- | --- |
| `-s`, `--skill <name>` | Required unless the source uses `@skill`. Only one value. |
| `-a`, `--agent <name>` | Start that agent. Only `claude-code` (`claude`), `codex` (`codex`), `sarvam-code` (`sarvam-code`) are implemented. |
| `--full-depth` | Same meaning as `add`. |

Prompt shape (`buildUsePrompt`):

```
You are being given a Skill to execute for the user's next request.
Use the following SKILL.md as your instructions:
<SKILL.md>
…file contents…
</SKILL.md>

Supporting files for this skill were downloaded to:
/tmp/skills-use-…
```

### 2.3 `list` / `ls`

List installed skills. Similar to `npm ls`.

```
npx skills list
npx skills ls -g
npx skills ls -a claude-code -a cursor
npx skills ls --json
```

| Flag | Default | Behavior |
| --- | --- | --- |
| `-g`, `--global` | **project only** | List global skills. Without `-g`, project only. |
| `-a`, `--agent <names…>` | all detected | Filter. Invalid names exit 1. |
| `--json` | off | Structured JSON, no ANSI, untruncated agent lists |

Human output:

```
Project Skills

web-design-guidelines  ./.agents/skills/web-design-guidelines
  Agents: Claude Code, Cursor  Source: vercel-labs/agent-skills
```

Skills with a `pluginName` in the lock file are grouped under a title-cased plugin header; leftover skills go under `General`.

JSON fields: `name`, `path` (canonical), `scope`, `agents` (display names), `source`, `sourceUrl`, `sourceType`.

Empty: `No project skills found.` / `No global skills found.` plus a hint to try the other scope.

### 2.4 `find` / `search` / `f` / `s`

Search the **skills.sh registry**, not GitHub and not the local disk.

```
npx skills find
npx skills find typescript
npx skills find react --owner vercel
```

| Flag | Behavior |
| --- | --- |
| `--owner <owner>` / `--owner=<owner>` | Restrict to a GitHub owner. Must match `^[a-z0-9](?:[a-z0-9-]{0,38})$`. |

**Non-interactive** (query provided, or no TTY / inside an agent):

- Calls `GET ${SKILLS_API_URL||https://skills.sh}/api/search?q=…&limit=20[&owner=…]`.
- Prints `owner/repo@skill-name` plus install count and `https://skills.sh/<id>`.
- Inside an agent with no query: prints a tip (`npx skills find [query]` then `npx skills add <owner/repo@skill>`) and does not open the TUI.

**Interactive** (no query, TTY, not in an agent):

- fzf-style live search (min 2 chars, 150–250 ms debounce, 8 visible rows).
- Enter installs the selected skill via `runAdd([pkg, '--skill', skillName])`.
- Esc cancels.

Telemetry event: `find` with `query`, `resultCount`, optional `interactive=1`.

### 2.5 `update` / `upgrade` / `check`

Reinstall installed skills that have changed.

```
npx skills update
npx skills update my-skill
npx skills update frontend-design web-design-guidelines
npx skills update -g
npx skills update -p
npx skills update -y
```

| Flag | Behavior |
| --- | --- |
| `-g`, `--global` | Global lock only |
| `-p`, `--project` | Project lock only |
| `-y`, `--yes` | Skip scope prompt. Auto-scope: project if `skills-lock.json` or `.agents/skills/*/SKILL.md` exists, else global. Same auto-scope when stdin is not a TTY. |
| positional names | Update only those skill names (case-insensitive). Combined with neither `-g` nor `-p` → scope `both`. |

Interactive scope prompt (TTY, no `-y`/`-g`/`-p`): Project / Global / Both.

Implementation (`src/update.ts`):

- **Global:** compare `skillFolderHash` (GitHub tree SHA) via Trees API (`main` then `master`), then `gh api`, then authenticated clone. Changed skills are reinstalled by `spawnSync(process.execPath, [cli.mjs, 'add', url, '--skill', name, '-g', '-y'])` — **no shell**.
- **Project:** clone each source, detect deleted/relocated skills, then `spawnSync(…, ['add', url, '--skill', name, '-y', optional --subagent, optional --full-depth])`.
- Well-known skills with a stored `wellKnownDigest` are re-fetched and compared by digest.
- Local-path, generic git, and lock entries missing `skillPath`/`skillFolderHash` are **skipped** with a printed `npx skills add …` hint.

`check` is this same command. There is no read-only "check without install" path in current source (older `AGENTS.md` describes one; that text is stale).

### 2.6 `remove` / `rm` / `r`

```
npx skills remove
npx skills remove web-design-guidelines
npx skills remove frontend-design web-design-guidelines
npx skills remove --global web-design-guidelines
npx skills remove --agent claude-code cursor my-skill
npx skills remove --all
npx skills remove --skill '*' -a cursor
npx skills rm my-skill
```

| Flag | Behavior |
| --- | --- |
| `-g`, `--global` | Remove from `~/` instead of project |
| `-a`, `--agent` | Only those agents. Omitted → every known agent (to clean ghost symlinks). `*` is accepted as a name by the parser but is **not** specially expanded; pass a real agent name. README examples using `--agent '*'` are aspirational relative to `parseRemoveOptions`. |
| `-s`, `--skill` | Extra skill names (same list as positionals). `*` ⇒ `--all`. |
| `-y`, `--yes` | Skip confirm. Also forced when running inside a detected agent. |
| `--all` | Every installed skill + stale lock keys, and implies `-y`. **Cannot** be combined with named skills (exit 1). |

No names and not `--all` → interactive multiselect.

Behavior details:

- Only directories that contain `SKILL.md` are offered (dot-dirs like Codex `.system` are ignored).
- Names are matched after `sanitizeName()` so lock keys like `ce:review` match folder `ce-review`.
- Agent-specific copies/symlinks are deleted first. The canonical `.agents/skills/<name>` is deleted only if no remaining installed agent still has the skill (so `remove -a cursor foo` does not break Claude).
- Lock entry is dropped only when the canonical copy is gone.

### 2.7 `init [name]`

Scaffold a `SKILL.md`.

```
npx skills init            # ./SKILL.md, name = basename(cwd)
npx skills init my-skill   # ./my-skill/SKILL.md
```

If the file already exists: prints `Skill already exists at …` and returns (exit 0). No flags. Template is hardcoded in `src/cli.ts` (`name`, `description`, When to use, Instructions).

### 2.8 `experimental_install`

Restore **project** skills from `./skills-lock.json` into **universal** agents only (`.agents/skills/`).

- Groups lock entries by source and calls `runAdd(source, { skill, agent: universalAgents, yes: true })`.
- `sourceType === 'node_modules'` entries are handed to `experimental_sync`.
- Generic git/GitLab entries missing `sourceUrl` are skipped with an error.
- Empty lock: warning + hint to `npx skills add <package>` without `-g`.

This is **not** `npm install` and **not** an alias of `add`.

### 2.9 `experimental_sync`

Crawl `./node_modules` for `SKILL.md` (package root, `skills/`, `.agents/skills/`, including scoped packages) and install into agent dirs. Writes `sourceType: 'node_modules'` into `skills-lock.json`.

| Flag | Behavior |
| --- | --- |
| `-a`, `--agent` | Same as `add` |
| `-y`, `--yes` | Skip prompts |
| (internal) `force` | exists on the options type; not exposed in `--help` |

### 2.10 What is *not* a command

Verified absent from `src/cli.ts` switch:

- `generate-lock`
- `publish` / `login` / `logout`
- `config`
- `doctor`
- a distinct `check` (alias of `update` only)
- `search` as a separately implemented command (alias of `find`)

---

## 3. How discovery works

There are **four independent discovery paths**. The CLI does **not** scrape agentskills.io.

### 3.1 `skills find` → skills.sh search API

`src/find.ts`:

```ts
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';
// GET ${SEARCH_API_BASE}/api/search?q=<query>&limit=20[&owner=<owner>]
```

Live probe (2026-09-18):

```
GET https://skills.sh/api/search?q=react&limit=3
{
  "query": "react",
  "searchType": "fuzzy",
  "searchVersion": "legacy",
  "skills": [
    {
      "id": "vercel-labs/agent-skills/vercel-react-best-practices",
      "skillId": "vercel-react-best-practices",
      "name": "vercel-react-best-practices",
      "installs": 723346,
      "source": "vercel-labs/agent-skills"
    },
    …
  ],
  "count": 3
}
```

This is a **Vercel-hosted registry**, populated from CLI install telemetry (see §9), not a scrape of GitHub and not agentskills.io.

`SKILLS_API_URL` can retarget the search host. Not documented in the README env-var table.

### 3.2 `skills add` of a git/GitHub/GitLab/local source → walk the tree

After clone (or on a local path), `discoverSkills()` in `src/skills.ts` looks for `SKILL.md` in:

1. The search root itself (if it has `SKILL.md`, return that single skill unless `--full-depth`).
2. Bounded walks (depth 3) of known containers: `skills/`, `skills/.curated/`, `skills/.experimental/`, `skills/.system/`, plus every agent project dir (`.claude/skills`, `.agents/skills`, `.cursor` is **not** in the source-search list — see README "Skill Discovery").
3. Paths declared in `.claude-plugin/marketplace.json` / `plugin.json`.
4. If nothing found, **or** `--full-depth`: recursive walk (max depth 5), skipping `node_modules`, `.git`, `dist`, `build`, `__pycache__`.

A shallower `SKILL.md` shadows anything nested below it. Already-installed project skills sitting in agent dirs are ignored so a repo that happens to have `.claude/skills/` from a previous install is not re-discovered as a source.

### 3.3 Well-known HTTP hosts (RFC 8615) — **not** a scrape of skills.sh HTML

Any `http(s)` URL that is not GitHub/GitLab/raw.githubusercontent/`*.git` is typed `well-known`. The provider (`src/providers/wellknown.ts`) then GETs, in order, for both `.well-known/agent-skills` and `.well-known/skills`:

1. `{url-path}/.well-known/agent-skills/index.json` (preferred)
2. `{origin}/.well-known/agent-skills/index.json`
3. same two for `.well-known/skills/` (legacy)

Two index schemas:

- **v0.2.0** if `$schema === "https://schemas.agentskills.io/discovery/0.2.0/schema.json"`: each skill is `{ name, type: 'skill-md'|'archive', description, url, digest: 'sha256:<64 hex>' }`. Artifact is fetched and **rejected unless the sha256 matches**.
- **legacy / v0.1.0** if `$schema` is absent: `{ name, description, files: string[] }` and files are fetched from `{base}/{wellKnownPath}/{name}/…`. Must include a `SKILL.md`. Unknown `$schema` values are ignored.

Scoped URLs such as `https://host/s/my-list` **do not** fall back to the host root index (`WellKnownScopeNotFoundError`) — that used to silently install the host's entire catalog.

`https://skills.sh/.well-known/agent-skills/index.json` currently 308s to `www.skills.sh` and returns **HTML**, not an index. skills.sh is therefore **not** consumed as a well-known publisher. Packs use a different URL shape (below).

### 3.4 skills.sh packs

README + CLI help + `src/add.ts`:

```
npx skills add https://skills.sh/p/<pack-id>
```

Detected by `isSkillsShPackUrl`: hostname `skills.sh` (www stripped) and path `/p/<id>`. Treated as a well-known source; the picker **preselects every skill**. FAQ: packs are unlisted collections; creating them requires a Vercel login; installing a pack URL does not.

### 3.5 Blob / snapshot fast path (install, not search)

For GitHub sources owned by `vercel`, `vercel-labs`, `heygen-com`, `remotion-dev`, or the hard-coded repo `zapier/connectors`, `add` tries:

1. GitHub Trees API (`/repos/{owner}/{repo}/git/trees/{branch}?recursive=1`)
2. `raw.githubusercontent.com` for each `SKILL.md` frontmatter
3. Snapshot JSON from `https://skills.sh/api/download/{owner}/{repo}/{slug}` (overridable via `SKILLS_DOWNLOAD_URL`), or Zapier's self-hosted snapshot URL

An **explicit ref** (`#branch`, `/tree/branch`, commit SHA) disables this path so a cached snapshot cannot disagree with the requested revision. Failure falls back to `git clone`. `--full-depth` also skips it.

This is a **content CDN**, not the search index.

### 3.6 Notion (v1.7.0)

`src/notion-test.ts` (filename is historical; it is production code):

- Source alias `notion` lists/installs Notion Agent Plugin packs via the `ntn` CLI (`ntn api /v1/ai/plugins … --notion-version 2026-03-11`).
- `https://notion.so/…` / `https://notion.com/…` page URLs extract a page UUID and download that page as a skill.
- Requires the Notion CLI (`ntn`) and `ntn login`. ENOENT error points at https://developers.notion.com/cli/get-started/overview.
- Packs are staged under a temp dir with a generated `.claude-plugin/marketplace.json` so plugin grouping works.

### 3.7 What it does **not** do

- Does not scrape skills.sh HTML.
- Does not query agentskills.io.
- Does not crawl GitHub Search.
- Does not read a local JSON catalog shipped in the npm package.
- HuggingFace / Mintlify provider modules listed in stale `AGENTS.md` **do not exist** in current `src/providers/` (only `wellknown.ts`). Those hosts would be handled as generic well-known URLs if they publish an index.

---

## 4. How install works

### Scope

| Scope | Flag | Canonical copy | Use |
| --- | --- | --- | --- |
| Project (default) | (none) | `./.agents/skills/<skill>/` | Committed with the repo; `skills-lock.json` at project root |
| Global | `-g` | `~/.agents/skills/<skill>/` (or `$XDG_STATE_HOME` only for the **lock file**, not the skills themselves) | User-wide |

README table:

| Scope | Flag | Location | Use case |
| --- | --- | --- | --- |
| Project | (default) | `./<agent>/skills/` | Committed with your project |
| Global | `-g` | `~/<agent>/skills/` | Available across all projects |

The README simplifies. The **real** layout is: one canonical copy under `.agents/skills` (project) or `~/.agents/skills` (global), then either a symlink or a second copy in each agent-specific dir.

XDG: the **global lock** honors `$XDG_STATE_HOME/skills/.skill-lock.json`. Skill files themselves still go to `~/.<agent>/skills` or `~/.config/…` as hard-coded per agent. OpenCode/Amp/Goose global dirs use `xdg-basedir`'s `xdgConfig` (`~/.config/…`).

### Symlink vs copy

`src/installer.ts`:

1. **Symlink (default when >1 unique target dir):** copy the skill folder into the canonical dir, then `symlink(relativePath, agentDir)`. Windows uses a **junction**. If symlink fails, it falls back to copy and flags `symlinkFailed`.
2. **Copy (`--copy`, or a single unique dir, or all-Eve):** write straight into each agent dir; no canonical link step.
3. Universal agents (`skillsDir === '.agents/skills'`) already *are* the canonical dir, so no extra symlink is created for them. Global + universal skips the agent-specific global dir (e.g. does not also write `~/.copilot/skills`) to avoid duplicates.
4. Project installs **do not create** missing agent roots (`.windsurf/`, `.kiro/`, …) unless the user explicitly selected that agent or the agent sets `createProjectSkillsDirByDefault` (Claude Code does).
5. Eve is special: project-only, optional subagents under `agent/subagents/<name>/skills`, and `SKILL.md` frontmatter is stripped down to a whitelist (`name`, `description`, `license`, `compatibility`, `version`, `metadata`) on copy.

Excluded from copies: `metadata.json`, `.git`, `__pycache__`, `__pypackages__`. Symlinks inside a skill are dereferenced (`cp({ dereference: true })`); broken ones are skipped with a warning. File modes are preserved (`chmod` of `mode & 0o777`).

Claude Code has `createProjectSkillsDirByDefault: true` so project installs always materialize `.claude/skills/` (changelog: "claude-code symlink exemption").

### Target agent layouts (from README, generated from `src/agents.ts`)

Project path is relative to cwd. Global path is absolute under `$HOME` unless noted.

| Agent | `--agent` | Project | Global |
| --- | --- | --- | --- |
| AiderDesk | `aider-desk` | `.aider-desk/skills/` | `~/.aider-desk/skills/` |
| Amp, Replit, Universal | `amp`, `replit`, `universal` | `.agents/skills/` | `~/.config/agents/skills/` |
| Antigravity | `antigravity` | `.agents/skills/` | `~/.gemini/antigravity/skills/` |
| Antigravity CLI | `antigravity-cli` | `.agents/skills/` | `~/.gemini/antigravity-cli/skills/` |
| AstrBot | `astrbot` | `data/skills/` | `~/.astrbot/data/skills/` |
| Autohand Code CLI | `autohand-code` | `.autohand/skills/` | `$AUTOHAND_HOME/skills` or `~/.autohand/skills/` |
| Augment | `augment` | `.augment/skills/` | `~/.augment/skills/` |
| IBM Bob | `bob` | `.bob/skills/` | `~/.bob/skills/` |
| Claude Code | `claude-code` | `.claude/skills/` | `$CLAUDE_CONFIG_DIR/skills` or `~/.claude/skills/` |
| OpenClaw | `openclaw` | `skills/` | `~/.openclaw/skills/` (fallback `~/.clawdbot`, `~/.moltbot`) |
| Cline, Dexto, Kimi Code CLI, Loaf, Sarvam Code, Warp, Zed | `cline`, `dexto`, `kimi-code-cli`, `loaf`, `sarvam-code`, `warp`, `zed` | `.agents/skills/` | `~/.agents/skills/` |
| CodeArts Agent | `codearts-agent` | `.codeartsdoer/skills/` | `~/.codeartsdoer/skills/` |
| CodeBuddy | `codebuddy` | `.codebuddy/skills/` | `~/.codebuddy/skills/` |
| Codemaker | `codemaker` | `.codemaker/skills/` | `~/.codemaker/skills/` |
| Code Studio | `codestudio` | `.codestudio/skills/` | `~/.codestudio/skills/` |
| Codex | `codex` | `.agents/skills/` | `$CODEX_HOME/skills` or `~/.codex/skills/` |
| Command Code | `command-code` | `.commandcode/skills/` | `~/.commandcode/skills/` |
| Continue | `continue` | `.continue/skills/` | `~/.continue/skills/` |
| Cortex Code | `cortex` | `.cortex/skills/` | `~/.snowflake/cortex/skills/` |
| Crush | `crush` | `.crush/skills/` | `~/.config/crush/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
| Deep Agents | `deepagents` | `.agents/skills/` | `~/.deepagents/agent/skills/` |
| Devin for Terminal | `devin` | `.devin/skills/` | `~/.config/devin/skills/` |
| Droid | `droid` | `.agents/skills/` | `~/.factory/skills/` |
| Eve | `eve` | `agent/skills/` | **N/A (project-only)** |
| Firebender | `firebender` | `.agents/skills/` | `~/.firebender/skills/` |
| ForgeCode | `forgecode` | `.forge/skills/` | `~/.forge/skills/` |
| fx | `fx` | `.fx/skills/` | `~/.fx/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |
| Goose | `goose` | `.goose/skills/` | `~/.config/goose/skills/` |
| Grok Build | `grok` | `.grok/skills/` | `$GROK_HOME/skills` or `~/.grok/skills/` |
| Hermes Agent | `hermes-agent` | `.hermes/skills/` | `$HERMES_HOME/skills` or `~/.hermes/skills/` |
| inference.sh | `inference-sh` | `.inferencesh/skills/` | `~/.inferencesh/skills/` |
| Jazz | `jazz` | `.jazz/skills/` | `~/.jazz/skills/` |
| Junie | `junie` | `.junie/skills/` | `~/.junie/skills/` |
| iFlow CLI | `iflow-cli` | `.iflow/skills/` | `~/.iflow/skills/` |
| Kilo Code | `kilo` | `.agents/skills/` | `~/.kilo/skills/` |
| Kimchi | `kimchi` | `.kimchi/skills/` | `~/.config/kimchi/harness/skills/` |
| Kiro CLI | `kiro-cli` | `.kiro/skills/` | `~/.kiro/skills/` |
| Kode | `kode` | `.kode/skills/` | `~/.kode/skills/` |
| Lingma | `lingma` | `.lingma/skills/` | `~/.lingma/skills/` |
| MCPJam | `mcpjam` | `.mcpjam/skills/` | `~/.mcpjam/skills/` |
| MiniMax Code | `minimax-code` | `.minimax/skills/` | `~/.minimax/skills/` |
| Mistral Vibe | `mistral-vibe` | `.vibe/skills/` | `$VIBE_HOME/skills` or `~/.vibe/skills/` |
| Moxby | `moxby` | `.moxby/skills/` | `~/.moxby/skills/` |
| Mux | `mux` | `.mux/skills/` | `~/.mux/skills/` |
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |
| OpenHands | `openhands` | `.openhands/skills/` | `~/.openhands/skills/` |
| Ona | `ona` | `.ona/skills/` | `~/.ona/skills/` |
| Pi | `pi` | `.pi/skills/` | `~/.pi/agent/skills/` |
| Posit Assistant | `posit-assistant` | `.posit/assistant/skills/` | `~/.posit/assistant/skills/` |
| Qoder | `qoder` | `.qoder/skills/` | `~/.qoder/skills/` |
| Qoder CN | `qoder-cn` | `.qoder/skills/` | `~/.qoder-cn/skills/` |
| Qwen Code | `qwen-code` | `.qwen/skills/` | `~/.qwen/skills/` |
| Reasonix | `reasonix` | `.reasonix/skills/` | `~/.reasonix/skills/` |
| Rovo Dev | `rovodev` | `.rovodev/skills/` | `~/.rovodev/skills/` |
| Roo Code | `roo` | `.roo/skills/` | `~/.roo/skills/` |
| Tabnine CLI | `tabnine-cli` | `.tabnine/agent/skills/` | `~/.tabnine/agent/skills/` |
| Terramind | `terramind` | `.terramind/skills/` | `~/.terramind/skills/` |
| Tinycloud | `tinycloud` | `.tinycloud/skills/` | `~/.tinycloud/skills/` |
| Trae | `trae` | `.trae/skills/` | `~/.trae/skills/` |
| Trae CN | `trae-cn` | `.trae/skills/` | `~/.trae-cn/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |
| ZCode | `zcode` | `.zcode/skills/` | `~/.zcode/skills/` |
| Zencoder, Zenflow | `zencoder`, `zenflow` | `.zencoder/skills/` | `~/.zencoder/skills/` |
| Neovate | `neovate` | `.neovate/skills/` | `~/.neovate/skills/` |
| Pochi | `pochi` | `.pochi/skills/` | `~/.pochi/skills/` |
| PromptScript | `promptscript` | `.agents/skills/` | **N/A (project-only)** |
| AdaL | `adal` | `.adal/skills/` | `~/.adal/skills/` |

**Universal agents** (share `.agents/skills`, no extra symlink): every agent whose `skillsDir === '.agents/skills'` and `showInUniversalList !== false`. From the table: Amp, Replit, Universal, Antigravity, Antigravity CLI, Cline, Dexto, Kimi Code CLI, Loaf, Sarvam Code, Warp, Zed, Codex, Cursor, Deep Agents, Droid, Firebender, Gemini CLI, GitHub Copilot, Kilo, OpenCode, PromptScript. Antigravity / Antigravity CLI set `showInUniversalPrompt: false` so they install as universal but stay hidden in the locked picker section.

Detection is per-agent `existsSync` of a home/config dir (e.g. `~/.claude`, `$CODEX_HOME`, `/Applications/ZCode.app`). If none are detected and the user did not pass `--agent`, the CLI prompts; with `-y` it installs to **all** agents.

### Fetch / clone

`src/git.ts`:

- `git clone --depth 1 [--branch <ref>]` into `os.tmpdir()/skills-*`.
- `GIT_ALLOW_PROTOCOL=https:http:ssh:git:file`. `ext::` URLs are rejected.
- LFS is disabled (`filter.lfs.*` empty + `GIT_LFS_SKIP_SMUDGE=1`) so missing `git-lfs` cannot abort checkout.
- Full 40-char SHA refs: after `--branch` fails, `git init && fetch --depth 1 origin <sha> && checkout FETCH_HEAD`.
- GitHub HTTPS auth failure → `gh repo clone` if `gh auth status` works, then SSH (`ssh -o BatchMode=yes`). Does **not** run `gh auth token`.
- Timeout 300s, overridable with `SKILLS_CLONE_TIMEOUT_MS`.
- Temp cleanup is restricted to paths under `os.tmpdir()`.

Direct downloads (`src/download-source.ts`): 10 MiB download / 25 MiB extract / 1000 files. Env overrides: `SKILLS_DOWNLOAD_MAX_BYTES`, `SKILLS_EXTRACT_MAX_BYTES`, `SKILLS_EXTRACT_MAX_FILES`. Zip/tar/tar.gz/tgz by magic bytes, not extension. Path-traversal entries rejected. Single top-level dir is unwrapped (`__MACOSX` ignored).

---

## 5. How a skill is specified on the CLI

`parseSource()` in `src/source-parser.ts`, plus Notion special-case in `runAdd`.

### Accepted forms

| Input | Parsed type | Notes |
| --- | --- | --- |
| `owner/repo` | `github` (or `git` if `GH_HOST` ≠ github.com) | Most common |
| `owner/repo/path/to/skill` | `github` + `subpath` | Equivalent to a tree URL |
| `owner/repo@skill-name` | `github` + `skillFilter` | Merged into `--skill` |
| `owner/repo#ref` | `github` + `ref` | Fragment is a git ref |
| `owner/repo#ref@skill` | `github` + `ref` + `skillFilter` | |
| `github:owner/repo[…]` | rewritten to shorthand | |
| `gitlab:owner/repo` | `https://gitlab.com/owner/repo` | |
| `https://github.com/owner/repo` | `github` | `.git` stripped |
| `https://github.com/owner/repo/tree/<ref>` | `github` + `ref` | |
| `https://github.com/owner/repo/tree/<ref>/<path>` | `github` + `ref` + `subpath` | |
| `https://gitlab.com/group/sub/repo` | `gitlab` | subgroups OK |
| `https://gitlab.example/…/-/tree/<ref>[/<path>]` | `gitlab` | any host with `/-/tree/` |
| `https://dev.azure.com/org/project/_git/repo` | `git` | also `?path=` + `?version=GBbranch`/`GTtag` |
| `git@host:owner/repo.git` | `git` | SSH |
| `ssh://git@host/owner/repo.git` | `git` | |
| any other `*.git` URL | `git` | |
| `./rel`, `../rel`, `/abs`, `C:\…`, `.` | `local` | resolved with `path.resolve` |
| `https://…` not github/gitlab | `well-known` first, then `download` | |
| GitHub/GitLab archive or raw URLs | `download` | `codeload.github.com`, `/archive/`, `/raw/`, `/releases/download/`, `gitlab.com/-/archive|raw/` |
| `notion` | Notion packs via `ntn` | v1.7.0 |
| `https://notion.so/<page>` / `notion.com` | single Notion page | UUID extracted from last path segment |

### Well-known source aliases

Hard-coded in `SOURCE_ALIASES`:

```ts
'coinbase/agentWallet'      → 'coinbase/agentic-wallet-skills'
'vercel-labs/vercel-skills' → 'vercel-labs/agent-skills'
```

No other aliases. `notion` is a special-case string, not an alias map entry.

`GH_HOST` (hostname only) switches shorthand `owner/repo` to GitHub Enterprise and forces type `git` (no github.com API / blob fast path). Invalid `GH_HOST` values fall back to `github.com`.

Private repos use whatever Git / `gh` / SSH credentials are already configured. Optional `GITHUB_TOKEN` / `GH_TOKEN` for API (Trees, privacy check, updates). They are **not** required for clone if Git auth works.

---

## 6. Skill package format the CLI expects

The CLI claims compatibility with the [Agent Skills specification](https://agentskills.io/specification). It is **more permissive** than the spec on `name` (it accepts any string, then sanitizes the directory name) and **stricter** on parse failures (warns and skips).

### Required on disk

A directory containing `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill
…
```

`parseSkillMd` (`src/skills.ts`) requires:

- YAML frontmatter delimited by `---` (JS frontmatter engines are **intentionally not used** — `src/frontmatter.ts` uses the `yaml` package only, to avoid gray-matter `---js` RCE).
- `name` and `description` present **and strings**.
- Optional `metadata.internal: true` hides the skill unless `INSTALL_INTERNAL_SKILLS=1|true` or the user named it explicitly via `--skill` / `@skill`. The `*` wildcard does **not** include internals.

Malformed files are skipped with `⚠ Skipped <path> — …` (not a hard fail of the whole repo).

### Directory layout the CLI copies

Whatever is in the skill folder, except excluded names. README / agentskills.io convention:

```
my-skill/
├── SKILL.md          # required
├── scripts/          # optional
├── references/       # optional
├── assets/           # optional
└── …
```

Root-level `SKILL.md` repos (skill at repo root) copy the **entire repo** minus `.git` (issue #1603 / installer comment).

### Agent Skills spec fields the CLI does *not* enforce

From https://agentskills.io/specification:

| Field | Spec | CLI |
| --- | --- | --- |
| `name` | 1–64 chars, `[a-z0-9-]`, no leading/trailing/consecutive hyphen, must match parent dir | any string; directory name is `sanitizeName()` |
| `description` | 1–1024 chars | any string |
| `license`, `compatibility`, `allowed-tools` | optional | ignored for discovery; Eve copy keeps `license`/`compatibility` |
| `metadata` | string→string map | any object; `metadata.internal` is the only key the CLI interprets |

Well-known v0.2.0 **does** enforce the spec-like name regex `^[a-z0-9-]+$` (1–64, no leading/trailing `-`, no `--`) on index entries.

### Plugin manifests

If `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json` exists, declared `./relative` skill paths are added to discovery (unbounded depth) and `plugin.name` is stored for grouping. Remote plugin sources are skipped. Paths must start with `./` and stay inside the repo.

### Compatibility matrix (README)

Basic skills: yes across the listed agents. `allowed-tools` widely yes except Kiro CLI and Zencoder. `context: fork` only Claude Code. Hooks: Claude Code, Cline, Kiro CLI.

---

## 7. Update / remove / list-installed behavior

### List

`listInstalledSkills()` scans:

1. Canonical `.agents/skills` (project and/or global).
2. Each detected agent's skills dir (and Eve subagents).
3. On-disk agent dirs even if the agent is no longer detected (stale installs).

Dedupes by `scope:name`. Attribution prefers the agent dir being scanned; canonical-dir entries are matched to agents by folder name / sanitized name / reading `SKILL.md`.

Default `skills list` is **project only**. This surprised some docs that say "project and global".

### Update

See §2.5. Operationally:

1. Read the relevant lock(s).
2. For GitHub global entries with `skillFolderHash` + `skillPath`, compare remote tree SHA.
3. For project entries, clone and compare / just reinstall.
4. Deleted upstream skills are prompted (or auto-removed with `-y`) and dropped from the lock.
5. Relocated skills (`src/skill-relocation.ts`) get their `skillPath` rewritten.
6. Reinstall is a nested `node bin/cli.mjs add … -y` (global adds `-g`). `GH_HOST` is forced to `github.com` for github-typed updates so an ambient Enterprise host cannot redirect them.

Skills that cannot be checked (local path, generic git without URL, missing hash/path) are listed with a manual `npx skills add …` command.

### Remove

See §2.6. Disk + lock. Canonical copy stays if another agent still has the skill. Telemetry `remove` events are grouped by source.

---

## 8. Config files the CLI reads/writes

The CLI has **no** `~/.skillsrc` / `skills.config.json`. State lives in two lock files plus env vars.

### Global lock — `~/.agents/.skill-lock.json`

Or `$XDG_STATE_HOME/skills/.skill-lock.json` if that env is set.

```ts
// src/skill-lock.ts
{
  version: 3,                          // v1/v2 are wiped on read
  skills: {
    [skillName]: {
      source: string,                  // owner/repo, or raw URL, or SSH URL
      sourceType: string,              // github | gitlab | git | well-known | local | …
      sourceUrl: string,               // original URL
      ref?: string,
      skillPath?: string,              // e.g. "skills/foo/SKILL.md"
      skillFolderHash: string,         // GitHub tree SHA of the folder
      installedAt: string,             // ISO
      updatedAt: string,
      pluginName?: string,
      sourceBaseUrl?: string,
      wellKnownDigest?: string
    }
  },
  dismissed?: { findSkillsPrompt?: boolean },
  lastSelectedAgents?: string[]
}
```

Written on **global** (`-g`) installs only.

### Project lock — `./skills-lock.json` (intended to be committed)

```ts
// src/local-lock.ts  version: 1
{
  version: 1,
  skills: {
    [skillName]: {
      source: string,                  // portable; local paths stored relative (`./…`)
      sourceUrl?: string,              // required later for git/gitlab restore
      ref?: string,
      sourceType: string,              // github | gitlab | git | local | node_modules | well-known
      skillPath?: string,
      computedHash: string,            // SHA-256 of all files (path + bytes), not a git SHA
      subagents?: string[],            // Eve; '' = root agent
      wellKnownDigest?: string
    }
  }
}
```

Keys are sorted alphabetically on write. No timestamps (merge-friendly). Local sources are rewritten to project-relative POSIX paths.

### Other files touched

- Skill directories under `.agents/skills/` and each agent path (see §4).
- Temp clones under `os.tmpdir()/skills-*` and `skills-download-*`, `skills-use-*`, `skills-notion-*`.
- `init` writes `SKILL.md`.
- Eve: may rewrite `SKILL.md` frontmatter on copy.

### Environment variables

| Variable | Role | Documented in README? |
| --- | --- | --- |
| `INSTALL_INTERNAL_SKILLS` | `1`/`true` shows `metadata.internal` skills | yes |
| `DISABLE_TELEMETRY` | disable telemetry + audit | yes |
| `DO_NOT_TRACK` | same | yes |
| `GITHUB_TOKEN` | GitHub API | yes |
| `GH_TOKEN` | GitHub API fallback | yes |
| `GH_HOST` | GitHub Enterprise hostname for shorthand | no (code only) |
| `SKILLS_API_URL` | override find search host (default `https://skills.sh`) | no |
| `SKILLS_DOWNLOAD_URL` | override blob CDN (default `https://skills.sh`) | no |
| `SKILLS_DOWNLOAD_MAX_BYTES` | default 10 MiB | yes (README download paragraph) |
| `SKILLS_EXTRACT_MAX_BYTES` | default 25 MiB | yes |
| `SKILLS_EXTRACT_MAX_FILES` | default 1000 | yes |
| `SKILLS_CLONE_TIMEOUT_MS` | default 300000 | no (error text only) |
| `SKILLS_DEBUG` | `1` logs `ntn` argv to stderr | no |
| `XDG_STATE_HOME` | relocate global lock | no (code) |
| `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `VIBE_HOME`, `HERMES_HOME`, `AUTOHAND_HOME`, `GROK_HOME`, `SARVAM_HOME` | per-agent home overrides | no (code) |
| `CI` / `GITHUB_ACTIONS` / … | telemetry `ci=1` | no |
| `CURSOR_AGENT`, `CURSOR_EXTENSION_HOST_ROLE` | treat Cursor as an agent host | no |

---

## 9. Security

### Does it execute postinstall / skill scripts?

**No.** Install is copy/symlink of files. `copyDirectory` never `spawn`s anything from the skill. Git LFS filters are forcibly disabled. `experimental_sync` also only copies.

Skill `scripts/` are copied onto disk so that **the agent** may run them later. The CLI itself does not. The success outro is explicit:

> Review skills before use; they run with full agent permissions.

`skills use --agent` does spawn `claude` / `codex` / `sarvam-code` with a generated prompt — that is the user's agent, not a skill hook.

Update reinstalls via `spawnSync(process.execPath, [cli, 'add', …], { shell: false })`. Comments in `src/update.ts` call out Windows command-injection risk if a shell were used; they pass argv directly.

### Hash validation

| Path | Hash? |
| --- | --- |
| Well-known v0.2.0 artifact | **Yes.** `sha256:` of the downloaded bytes must equal `entry.digest` or the skill is dropped. |
| Well-known v0.1.0 file list | **No** content hash. Paths are sanitized (`..` / absolute rejected). |
| GitHub blob snapshot | Snapshot includes `hash`; installer stores it as `snapshotHash` / project `computedHash`. Not compared to a trusted digest before write. |
| Git clone | No content hash at install time. Global lock stores GitHub **tree SHA** for later update comparison. Project lock stores SHA-256 of on-disk files. |
| Direct download | Size/count limits only. |
| Notion | Same as download, with higher limits (50 / 100 MiB, 5000 files). |

There is **no** npm-style integrity field for git sources and no signature check on skills.sh snapshots.

### Trust / audit prompt

- Interactive `add` shows an optional **Security Risk Assessments** table (Gen / Socket / Snyk) fetched from `https://add-skill.vercel.sh/audit?source=…&skills=…` with a 3s timeout. Failures are swallowed. This is **advisory** and never blocks.
- Audit is skipped when telemetry is disabled.
- README: "GitHub repository and skill identifiers are sent only for repositories that GitHub positively confirms are public." `isRepoPrivate()` uses `GET https://api.github.com/repos/{owner}/{repo}`. Private or unknown → no install telemetry / no audit.
- There is no "do you trust this repo?" prompt beyond `Proceed with installation?` and the risk table.
- Frontmatter / search API strings are run through `sanitizeMetadata` (strip CSI/OSC/C1/control chars) before printing — CWE-150 defense.
- `sanitizeName` / `isSubpathSafe` / `sanitizeSubpath` block path traversal into install destinations.
- Zip/tar extractors reject `..`, absolute paths, and (well-known tar) hard/symlinks.

### Telemetry

`src/telemetry.ts`:

- Endpoint: `https://add-skill.vercel.sh/t` (query-string events).
- Events: `install`, `remove`, `update`, `find`, `experimental_sync`.
- Payload extras: CLI version, `ci=1`, detected host-agent name, skill names, agent list, optional `skillFiles` JSON, optional `--metadata`.
- Opt out: `DISABLE_TELEMETRY` or `DO_NOT_TRACK`.
- skills.sh leaderboard is this data. FAQ: "no personal or device information". Source also sends `agent` (detected host) and `ci`.

### Other hardening

- Frontmatter parser refuses `---js` (no `eval`).
- `ext::` git transport blocked.
- `simple-git` is given a large `unsafe.allowUnsafe*` list **and** a hard-coded env; comments say this is only so inherited Git credential/SSH config still works, and that clone URL/ref cannot set those knobs. Still worth noting if you wrap this.
- `gh auth token` is never invoked; `gh api` / `gh repo clone` run as subprocesses so the Node process never sees the stored credential.

---

## 10. Programmatic API

**There is no supported programmatic API.**

Evidence:

- Published `package.json` has no `main`, no `exports`, no `types`.
- `dist/cli.d.mts` is `export { };`.
- `files` is `dist`, `bin`, README, third-party notice.
- `bin.skills` / `bin.add-skill` are the only public interface.

The TypeScript source exports many functions (`runAdd`, `parseSource`, `discoverSkills`, `installSkillForAgent`, `registry`, …) but they are **not** in the npm tarball as a library. Importing `skills` from npm gives you nothing useful.

**Can NEOS import the package instead of shelling out?**

| Approach | Verdict |
| --- | --- |
| `import 'skills'` / `require('skills')` | No. Empty public surface. |
| Import a deep path like `skills/dist/cli.mjs` | Would execute the CLI, not return an API. |
| Depend on the GitHub repo / copy `src/` | Possible but unsupported, unstable (no semver API), and the source is a CLI (process.exit, stdout, clack prompts, telemetry). |
| `npx skills …` / `node node_modules/skills/bin/cli.mjs …` | This is the intended interface. Use `-y`, `--json`, `--agent`, `--skill`. Requires Node `>=22.20.0`. |
| Reimplement the small subset NEOS needs | See §11. |

`--json` on `add` and `list` is the closest thing to a machine API. `find` has no `--json` (it prints text, or you can call `https://skills.sh/api/search` yourself). `update` / `remove` have no JSON mode.

---

## 11. Exact mapping: reimplement vs wrap

NEOS already has its own skills catalog (bundled vs local, featured flag). The Vercel CLI is an **installer + multi-agent router + registry client**, not a skill runtime.

### Wrap (`npx skills` / vendored bin) if you want

| Operation | Wrap command | Why wrapping is enough |
| --- | --- | --- |
| Install from GitHub / URL / local | `npx skills add <src> --skill … --agent … -y [--copy] [--json]` | Full source parser, clone, blob CDN, well-known, Notion |
| Preview a repo | `npx skills add <src> --list` | |
| Search the public registry | `npx skills find <q> [--owner x]` **or** `GET https://skills.sh/api/search` | Search is just one HTTP call |
| List what *this CLI* installed | `npx skills list [--json] [-g] [-a …]` | Reads its own lock + agent dirs |
| Update those installs | `npx skills update -y [-g\|-p] [names]` | Hash compare + nested add |
| Remove those installs | `npx skills remove -y [-g] [-a …] <names>` | |
| Scaffold | `npx skills init <name>` | Trivial; probably not worth wrapping |
| Restore a committed `skills-lock.json` | `npx skills experimental_install` | |
| Sync from npm packages | `npx skills experimental_sync -y` | |

Constraints if wrapping:

- Must run under Node `>=22.20.0`.
- Always pass `-y` (and usually `--agent` / `--skill`) — no TTY in the desktop app.
- Prefer `--copy` if you do not want symlinks in the workspace.
- Telemetry fires unless you set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`.
- `add --json` is the only structured install result; well-known sources cannot use it yet.
- Wrapping will write `.agents/skills/`, agent-specific dirs, and `skills-lock.json` into whatever cwd you give it. That may collide with NEOS's own skill store.

### Reimplement if NEOS should own the store

Do **not** reimplement the whole CLI. Reimplement only the pieces that map onto NEOS concepts:

| CLI capability | Reimplement? | Notes |
| --- | --- | --- |
| `SKILL.md` parse (`name`+`description`, YAML only) | **Yes**, if not already | Tiny; you already have a skills catalog |
| Agent-directory router (75 agents, symlink/copy) | **No**, unless NEOS wants to install into Cursor/Claude/etc. on the user's machine | This is 90% of `installer.ts` + `agents.ts` |
| Git clone / GitHub Trees / blob CDN | **Only if** NEOS installs third-party GitHub skills | Otherwise keep using bundled/local |
| skills.sh search | **Optional HTTP client** | `GET /api/search` — do not scrape HTML |
| Well-known `index.json` + sha256 | **Only if** you want RFC 8615 publishers | |
| Notion / `ntn` | **No** | Unrelated to NEOS |
| Global `~/.agents/.skill-lock.json` | **No** | CLI-specific |
| `skills-lock.json` | **No**, unless you want CLI interop | Different hash scheme than NEOS |
| Telemetry / audit | **No** | |
| `use` prompt generator | **Maybe** as a "try this skill" preview | 20 lines |
| `update` via nested `add` | **No** | Reuse your own catalog versioning |
| `experimental_sync` from node_modules | **No** | |

### Practical recommendation for NEOS

1. **Do not take a runtime dependency on the `skills` npm package** — there is no library API, and the CLI will mutate agent dirs and emit telemetry.
2. If the product goal is "let a user pull a public skill from skills.sh / GitHub into NEOS's own catalog":
   - **Search:** call `https://skills.sh/api/search` directly.
   - **Fetch:** either wrap `npx skills add <owner/repo@skill> --skill <name> --agent universal -y --copy --json` into a temp/project dir and then import the resulting folder, **or** reimplement "clone or download `SKILL.md` + siblings" (much smaller than the full CLI).
   - **Do not** let the CLI write into `.claude/`, `~/.cursor/`, etc. unless that is an explicit user-facing feature.
3. If the product goal is "make NEOS skills installable via `npx skills add …`":
   - Publish a GitHub repo (or well-known index) of `SKILL.md` folders. There is no publish API. Listing on skills.sh happens via other people running `npx skills add`.
4. Node engine: wrapping the current CLI requires Node 22.20+ in the desktop sidecar. NEOS's existing engine may be on an older Node — verify before shelling out.

---

## 12. Key source quotes

### Entry / routing

`bin/cli.mjs` (published):

```js
#!/usr/bin/env node
import module from 'node:module';
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try { module.enableCompileCache(); } catch { /* Ignore errors */ }
}
await import('../dist/cli.mjs');
```

`src/cli.ts` dispatch (abridged):

```ts
switch (command) {
  case 'find':
  case 'search':
  case 'f':
  case 's':
    await runFind(restArgs); break;
  case 'init':
    runInit(restArgs); break;
  case 'experimental_install':
    await runInstallFromLock(restArgs); break;
  case 'i':
  case 'install':
  case 'a':
  case 'add':
    await runAdd(addSource, addOpts); break;
  case 'use':
    await runUse(useSource, useOptions, useErrors); break;
  case 'remove':
  case 'rm':
  case 'r':
    await removeCommand(skills, removeOptions); break;
  case 'experimental_sync':
    await runSync(restArgs, syncOptions); break;
  case 'list':
  case 'ls':
    await runList(restArgs); break;
  case 'check':
  case 'update':
  case 'upgrade':
    await runUpdate(restArgs); break;
  // …
}
```

### Source aliases + well-known fallback

```ts
// src/source-parser.ts
const SOURCE_ALIASES: Record<string, string> = {
  'coinbase/agentWallet': 'coinbase/agentic-wallet-skills',
  'vercel-labs/vercel-skills': 'vercel-labs/agent-skills',
};
```

```ts
// Direct download URLs are tried after well-known discovery.
if (isWellKnownUrl(input)) {
  return { type: 'well-known', url: input };
}
```

### Find → skills.sh

```ts
// src/find.ts
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';
const url = `${SEARCH_API_BASE}/api/search?${params.toString()}`;
```

### Install trust warning

```ts
p.outro(
  pc.green('Done!') +
    pc.dim('  Review skills before use; they run with full agent permissions.')
);
```

### Telemetry + audit

```ts
// src/telemetry.ts
const TELEMETRY_URL = 'https://add-skill.vercel.sh/t';
const AUDIT_URL = 'https://add-skill.vercel.sh/audit';

function isEnabled(): boolean {
  return !process.env.DISABLE_TELEMETRY && !process.env.DO_NOT_TRACK;
}
```

### Well-known digest check

```ts
// src/providers/wellknown.ts
const bytes = new Uint8Array(await response.arrayBuffer());
if (this.computeDigest(bytes) !== entry.digest) return null;
// …
private computeDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
```

### Update does not use a shell

```ts
// src/update.ts
const result = spawnSync(
  process.execPath,
  [cliEntry, 'add', installUrl, '--skill', update.name, ...fullDepthArgs, '-g', '-y'],
  { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf-8', shell: false }
);
```

### Frontmatter: no JS eval

```ts
// src/frontmatter.ts
/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid eval()-based RCE
 * that exists in gray-matter's built-in JS engine.
 */
```

### Published package is CLI-only

```json
{
  "name": "skills",
  "version": "1.7.0",
  "bin": {
    "skills": "./bin/cli.mjs",
    "add-skill": "./bin/cli.mjs"
  },
  "files": ["dist", "bin", "README.md", "ThirdPartyNoticeText.txt"],
  "engines": { "node": ">=22.20.0" },
  "license": "MIT"
}
```

No `exports`, no `main`.

### Live `--help` (1.7.0) — command list

```
Usage: skills <command> [options]

Manage Skills:
  add <package>        Add a skill package (alias: a)
                       e.g. vercel-labs/agent-skills
                            notion
                            https://notion.so/<skill-page>
                            https://github.com/vercel-labs/agent-skills
  use <package>@<skill>
                       Generate a prompt for using one skill without installing it
  remove [skills]      Remove installed skills
  list, ls             List installed skills
  find [query]         Search for skills interactively

Updates:
  update [skills...]   Update skills to latest versions (alias: upgrade)

Project:
  experimental_install Restore skills from skills-lock.json
  init [name]          Initialize a skill (creates <name>/SKILL.md or ./SKILL.md)
  experimental_sync    Sync skills from node_modules into agent directories
```

### Agent Skills spec (external, referenced by README)

A skill is a folder with `SKILL.md`. Required frontmatter: `name`, `description`. Optional: `license`, `compatibility`, `metadata`, `allowed-tools`. Optional dirs: `scripts/`, `references/`, `assets/`. Spec: https://agentskills.io/specification.

---

## Unverified / stale / do-not-trust

| Claim | Status |
| --- | --- |
| `skills check` is a distinct read-only command | **False** in 1.7.0 — alias of `update` |
| `skills i` / `install` restore `skills-lock.json` | **False** — those aliases go to `add`. Restore is `experimental_install` |
| `skills generate-lock` exists | **False** (unofficial clones only) |
| Node 18 is enough | **False** — `>=22.20.0` |
| HuggingFace / Mintlify first-class providers | **Not in current tree**; only well-known generic HTTP |
| skills.sh root well-known index | **Not a JSON index** (returns HTML) |
| `remove --agent '*'` expands to all agents | Parser does not treat `*` as a wildcard for agents (unlike `add`) |
| v1.7.0 changelog contents | GitHub release body is empty; inferred from the Notion commit |
| Exact Socket/Snyk/Gen audit scoring | Endpoint exists; scoring logic is server-side and not in this repo |
| Whether skills.sh search indexes private repos | Not verified. Install telemetry is gated on public GitHub repos; other sources may still appear |
| Mintlify auto-docs (`vercel-labs-skills.mintlify.app`) | Stale in multiple places; not used as authority |

---

## Source file map (fetched 2026-09-18 from `main`)

| Path | Role |
| --- | --- |
| `bin/cli.mjs` | Published bin |
| `src/cli.ts` | Router, help, `init` |
| `src/add.ts` | Install (~2500 lines) |
| `src/use.ts` | Ephemeral use / agent launch |
| `src/find.ts` | skills.sh search |
| `src/list.ts` | Installed listing |
| `src/remove.ts` | Uninstall |
| `src/update.ts` / `src/update-source.ts` | Update |
| `src/install.ts` | `experimental_install` |
| `src/sync.ts` | `experimental_sync` |
| `src/installer.ts` | Copy/symlink onto agent dirs |
| `src/skills.ts` | Discover + parse `SKILL.md` |
| `src/source-parser.ts` | URL / shorthand / alias parser |
| `src/git.ts` | Clone |
| `src/download-source.ts` | Direct SKILL.md / archive |
| `src/blob.ts` | skills.sh snapshot fast path |
| `src/skill-lock.ts` | Global lock |
| `src/local-lock.ts` | Project `skills-lock.json` |
| `src/agents.ts` | 75+ agent definitions |
| `src/detect-agent.ts` | Host-agent detection |
| `src/telemetry.ts` | Telemetry + audit client |
| `src/providers/wellknown.ts` | RFC 8615 discovery |
| `src/plugin-manifest.ts` | Claude plugin marketplace |
| `src/frontmatter.ts` / `src/sanitize.ts` | Safe parse / terminal sanitize |
| `src/notion-test.ts` | Notion packs / pages (v1.7.0) |
| `src/types.ts` / `src/constants.ts` | Shared types |

`AGENTS.md` in the repo is a useful map but is **out of date** on command aliases, the `check` command, and the provider list. Prefer `src/cli.ts` + `--help`.
