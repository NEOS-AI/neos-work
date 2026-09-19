# NEOS Work skills / marketplace surfaces — as-is inventory

**Date:** 2026-09-18  
**Scope:** Existing discovery, storage, APIs, UI, CLI, marketplace, OpenCode compatibility, and trust. No design proposals.  
**Purpose:** Cite real functions, routes, types, and paths so a skills.sh / `npx skills` migration can plug into what already exists.

---

## 1. Skill discovery (`packages/core/src/skills/`)

### Files

| Path | Role |
|---|---|
| `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/discovery.ts` | Filesystem scan, shadowing, bundled-root resolution |
| `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/parser.ts` | YAML frontmatter + markdown body |
| `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/index.ts` | Re-exports |
| `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/discovery.test.ts` | Package layout, symlink refusal, bundled catalog |
| `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/parser.test.ts` | Frontmatter hygiene |
| `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/index.ts` | `export * from './skills/index.js'` |

### Exported functions (`packages/core/src/skills/index.ts`)

- `parseSkillFile`
- `discoverSkills`
- `scanSkillRoot`
- `mergeSkillsByPrecedence`
- `resolveBundledSkillsDir`
- `GLOBAL_SKILL_DIR`
- type `DiscoverSkillsOptions`

### `scanSkillRoot(dir, source)`

Scans one root. For each non-hidden, non-symlink child (cap `ENTRY_MAX = 500`):

- **Directory** → `loadPackageSkill`: requires `<dir>/SKILL.md` (file, not symlink, ≤ `FILE_MAX_BYTES` = 1 MiB). Attaches:
  - `packageDir`
  - `assets` from `assets/` (filenames only, max 100)
  - `references` from `references/`
  - `examples` from `examples/*.html` / `*.htm` as `SkillExampleCard` (`id = "${skillName}:${key}"`, max 40)
- **File** → legacy flat `*.md` with frontmatter. Root-level `SKILL.md` as a loose file is skipped (“package-less file name”).
- Hidden names (`.…`), control chars, planted symlinks, and files > 1 MiB are skipped.

`scripts/` (mentioned in `docs/plans/INITIAL_PLAN.md` §11.2) is **not** scanned.

### `discoverSkills(workspacePath?, opts?)`

Precedence (first name wins, case-insensitive `manifest.name`):

1. **local** — `{workspacePath}/.neos-work/skills` via `scanSkillRoot(..., 'local')` if `workspacePath` is a safe string
2. **global** — `GLOBAL_SKILL_DIR` = `join(homedir(), '.config', 'neos-work', 'skills')` unless `includeGlobal === false`
3. **bundled** — `resolveBundledSkillsDir(opts.bundledRoot)` unless `includeBundled === false`

`mergeSkillsByPrecedence` then sorts remaining names alphabetically.

**Not scanned (planned in INITIAL_PLAN §11.3, never implemented):**

- `{workspace}/.opencode/skills/`
- `~/.config/opencode/skills/`
- `{workspace}/.opencode/skill` (older INITIAL_PLAN wording)

`SkillSource` includes `'opencode'` but discovery never assigns it.

### `resolveBundledSkillsDir(explicit?, cwd = process.cwd())`

Order: explicit existing path → `process.env.NEOS_BUNDLED_SKILLS` → `cwd/skills`, `../skills`, `../../skills`, `../../../skills`.

Scan route hard-codes monorepo candidate:

```15:19:apps/server/src/routes/skills.ts
/** Monorepo `skills/` catalog (apps/server/src/routes → repo root). */
const REPO_SKILLS_CANDIDATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../skills',
);
```

### `parseSkillFile(content, filePath, source)`

- Requires `---\n…\n---` frontmatter; otherwise `null`.
- Simple YAML only: `key: value` lines, no nesting. Nested `metadata:` from INITIAL_PLAN is **not** parsed (`SkillManifest.metadata` is never set).
- Rejects null-byte files, missing/control-char `name`.
- Caps: name 200, description 4_000, body 500_000, examplePrompt 4_000, triggers 50, version 64.
- `featured` is `true` **only** when YAML value is the string `true` (`raw.featured === 'true'`).
- Aliases: `example-prompt` → `examplePrompt`; `design-system-required` → `designSystemRequired`.
- `triggers` is a comma-separated string, not a YAML list.
- `source` normalized to `'global' | 'local' | 'bundled' | 'opencode'`, else `'local'`.

### Runtime consumption of discovered skills

`discoverSkills` is used **only** by `POST /api/skills/scan`.  
`packages/agent-runtime` has **zero** skill references. Session/workflow/run paths do not inject enabled `SKILL.md` bodies into prompts.

The only runtime injection of skill text is **plugin** execution: `apps/server/src/lib/plugin-runner.ts` prepends `plugin.skillContent` (from sibling `SKILL.md`) onto **execute** stages (32_000 char cap).

---

## 2. Skill storage

### 2.1 SQLite table `skill`

Defined in `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS skill (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  source       TEXT NOT NULL,
  path         TEXT NOT NULL,
  version      TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  manifest_json TEXT,
  installed_at TEXT DEFAULT (datetime('now'))
);
```

DB file: `{NEOS_DATA_DIR}/data.db` or legacy `~/.neos-work/data.db` (`resolveDbDir` / `resolveDbPath`).

**`name` is the unique key.** Scan upserts `ON CONFLICT(name)` and updates description/source/path/version/`manifest_json`. It does **not** update `enabled` or `installed_at`.

`source` is a free string in the DB, not the `SkillSource` union. Observed values:

| source | Writer |
|---|---|
| `local` / `global` / `bundled` | `POST /api/skills/scan` from `discoverSkills` |
| `crystallize` | `POST /api/routines/:id/runs/:runId/crystallize` |
| default `'local'` | `upsertSkill` if source empty |

`manifest_json` on scan is **not** only frontmatter — it is:

```ts
{ ...skill.manifest, packageDir, examples, assets, references }
```

Skill **body is not stored** in SQLite.

### 2.2 User global dir `~/.config/neos-work/skills`

Hard-coded in:

- `packages/core/src/skills/discovery.ts` → `GLOBAL_SKILL_DIR`
- `apps/server/src/lib/plugin-store.ts` → `SKILLS_DIR`
- `apps/server/src/routes/routines.ts` crystallize (`os.homedir() + '/.config/neos-work/skills'`)

Layout: `~/.config/neos-work/skills/<name>/SKILL.md` plus optional `assets/`, `references/`, `examples/`, and for plugins `open-design.json` (+ marketplace `neos-remote.json`).

**Does not honor `NEOS_DATA_DIR`.**

### 2.3 Marketplace install root (different resolver)

`apps/server/src/lib/marketplace-catalog.ts` `userSkillsDir()`:

- if `NEOS_DATA_DIR` set → `{NEOS_DATA_DIR}/skills`
- else → `~/.config/neos-work/skills`

`installCatalogEntry` writes **only** `open-design.json` + `neos-remote.json` under `{skillsRoot}/{id}/`. **No `SKILL.md`.**

If `NEOS_DATA_DIR` is set (Docker, server vitest, e2e), marketplace install and plugin-store/discovery **diverge**.

`marketplaceInstallRootExists()` exists and is **unused** (no callers).

### 2.4 Repo bundled catalog `skills/`

`/Users/yeonwoosung/Desktop/neos-work/skills/`

| Dir | `name` | `featured` | `mode` | `category` | Extra |
|---|---|---|---|---|---|
| `code-review/` | code-review | true | agent | code | |
| `design-critique/` | design-critique | true | design | design | |
| `docx-report/` | docx-report | true | agent | docs | |
| `pptx-deck/` | pptx-deck | true | agent | docs | |
| `web-landing/` | web-landing | true | design | design | `examples/hero.html` |
| `api-docs/` | api-docs | (unset) | agent | code | `references/conventions.md` |
| `refactor-safe/` | refactor-safe | (unset) | agent | code | `assets/README.txt` |
| `video-analyze/` | video-analyze | (unset) | (unset) | (unset) | desktop Video studio playbook |

### 2.5 Workspace local skills

`{workspacePath}/.neos-work/skills/` — package `SKILL.md` or flat `*.md`.

Scan workspace selection (`apps/server/src/routes/skills.ts`):

```ts
const workspaces = db.listWorkspaces(); // ORDER BY created_at ASC
const defaultWs = workspaces[0];
const workspacePath = defaultWs?.path ?? undefined;
```

Seeded workspace (`schema.ts`): `id='default', name='Starter', path=NULL`. So **local workspace skills are not scanned** unless the oldest workspace has a non-null `path`. There is no per-session or per-project scan parameter.

### 2.6 Bundled plugins (separate tree)

`/Users/yeonwoosung/Desktop/neos-work/plugins/`

- `plugins/_official/code-critique/` — `open-design.json` + `SKILL.md`, channel `official`
- `plugins/_official/landing-gen/` — same
- `plugins/community/hello-plugin/` — channel `community`

Resolved via `resolveBundledPluginsDir` / `NEOS_BUNDLED_PLUGINS`. User plugins with the same `id` shadow bundled (`listPlugins`).

These are **not** skill-scan roots. They appear on Plugins, not Skills, unless also copied under a skills dir with `SKILL.md`.

---

## 3. Skill APIs (`apps/server/src/routes/skills.ts`)

Mounted at `/api/skills` in `apps/server/src/index.ts` (`app.route('/api/skills', skills)`). Auth: Bearer on all non-exempt routes.

| Method | Path | Handler behavior |
|---|---|---|
| `GET` | `/api/skills` | `listSkillRows()` → sanitized list |
| `POST` | `/api/skills/scan` | `discoverSkills` + `upsertSkill` per name |
| `POST` | `/api/skills/:id/toggle` | body `{ enabled: boolean }` |
| `DELETE` | `/api/skills/:id` | DB row only |

**No** `GET /api/skills/:id`, **no** body/content endpoint, **no** install-from-URL/GitHub, **no** file delete, **no** prune-missing.

### `GET /api/skills` response fields

Per row:

`id`, `name`, `description`, `source`, `path` (`publicPathTail` — last 3 segments), `version`, `enabled`, `installedAt`, plus from `manifest_json`: `mode`, `category`, `featured` (`=== true`), `triggers`, `examplePrompt`, `packageDir` (basename only), `exampleCount`, `examples` (sanitized), `assets`, `references`.

Absolute host paths are redacted (`publicPathTail`, `packageDirLabel`).

### `POST /api/skills/scan`

- Bundled: `resolveBundledSkillsDir(REPO_SKILLS_CANDIDATE) ?? resolveBundledSkillsDir(null)`
- `includeBundled: true`, `includeGlobal: true`
- Returns `{ ok, data: { scanned, total } }`
- Does not delete DB rows for skills that disappeared from disk
- Does not flip `enabled`

### `upsertSkill` (exported for tests)

Control-char / length hygiene on name, description (4_000), source, path (1_000), version (64), `manifest_json` (256 KiB else `{truncated:true}`). New UUID on insert; conflict keeps existing `id`.

### `DELETE /api/skills/:id`

`DELETE FROM skill WHERE id = ?` only. Files remain. Next scan re-inserts if still on disk. Desktop delete has **no confirm**; web uses `window.confirm`.

### Related write path: crystallize

`POST /api/routines/:id/runs/:runId/crystallize` in `apps/server/src/routes/routines.ts`.

- Completed runs only
- Name: slug of body.name/routine.name + first 8 chars of `routine_run.id` (e.g. `cand-skill-<8hex>`)
- Writes `~/.config/neos-work/skills/<skillName>/SKILL.md` (frontmatter `source: crystallize`, version `0.1.0`)
- Upserts DB `source = 'crystallize'`, `manifest_json = { mode: 'reference', category: 'crystallized', featured: false }`
- Desktop Routines UI: `EngineOpsClient.crystallizeRoutineRun` (`apps/desktop/src/lib/engine-ops.ts`)
- **Web has no crystallize client or UI**

---

## 4. Desktop / web Skills UI

### Desktop — `/Users/yeonwoosung/Desktop/neos-work/apps/desktop/src/pages/Skills.tsx`

- Route: `/skills` (`App.tsx`); sidebar item `skills` (`Sidebar.tsx`)
- Client: `EngineMediaClient` in `apps/desktop/src/lib/engine-media.ts`
  - `listSkills` → `GET /api/skills`
  - `scanSkills` → `POST /api/skills/scan`
  - `toggleSkill` → `POST /api/skills/:id/toggle`
  - `deleteSkill` → `DELETE /api/skills/:id`
  - `upgradeSkillToPlugin` → `POST /api/plugins/upgrade-from-skill` `{ skillId }`
- Local type `SkillData` (not shared `Skill` / `InstalledSkill`)
- Sort: `featured` first, then `name`
- Filters: search, enabled (`all`/`enabled`/`disabled` via `enabled-filter-prefs`), category chips (`skills-prefs.ts` key `neos-skills-category`)
- `SkillCard`: yellow `★` when `skill.featured`; badges for source, version, mode, package, example count, category; triggers; relative `installedAt`
- Actions: View (detail drawer), `→ Plugin`, Try (example prompt + copy), enable toggle, delete
- Info copy still says “Each skill is a `.md` file…” — package `SKILL.md` is preferred
- Lists global + `{workspace}/.neos-work/skills`; does **not** mention repo `skills/` or OpenCode paths
- Dashboard (`Dashboard.tsx`) only counts `listSkills()` for catalog health

### Web — `/Users/yeonwoosung/Desktop/neos-work/apps/web/src/pages/Skills.tsx`

- Route: `/skills`; nav `WebNav` (`nav-skills`)
- Client: `WebApiClient` (`apps/web/src/lib/api.ts`) — `listSkills`, `scanSkills`, `toggleSkill`, `deleteSkill`
- **No** featured sort, category chips, search, detail drawer, Try, or `→ Plugin`
- List: name, category, off badge, description; Enable/Disable; Delete (confirm)

### i18n

- Used: `common.skill.tryPrompt` (“Try” / “사용해 보기”) in desktop Skills
- Stale namespace `/Users/yeonwoosung/Desktop/neos-work/packages/ui/src/i18n/locales/en/skills.json`:
  - `installFromPackage`: “Install from OpenPackage”
  - `installPlaceholder`: `github:owner/repo`
  - `importLocal`: “Import local skill”
  - **No desktop/web page reads this namespace** (loaded for locale parity tests only)

---

## 5. Marketplace already present (plugins, not SKILL.md)

### Catalog lib — `apps/server/src/lib/marketplace-catalog.ts`

| Export | Meaning |
|---|---|
| `MARKETPLACE_SCHEMA` | `'neos-marketplace/v1'` |
| `TrustTier` | `'official' \| 'community' \| 'unverified'` |
| `CatalogEntry` | `id`, `name`, `description?`, `version`, `trust`, `packageUrl`, `sha256?` |
| `RemoteCatalog` | `schemaVersion`, `name?`, `updatedAt?`, `entries` |
| `parseRemoteCatalog` | no network; drops bad ids / missing URL; max 200 entries |
| `fetchRemoteCatalog` | `fetchPublicHttp` + JSON parse; catalog ≤ 512_000 bytes; UA `neos-work-marketplace/0.7.1` |
| `installCatalogEntry` | fetch package JSON; optional sha256; require `schemaVersion === 'od-plugin/v1'`; write files |
| `trustRank` | official=0, community=1, unverified=2 |
| `normalizeCatalogUrl` | http/https only, ≤ 2048 chars |
| `marketplaceInstallRootExists` | unused |

Entry `id` must match `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` (max 100). Path-like `../evil` is dropped.

### HTTP — `apps/server/src/routes/marketplace.ts`

Mounted at `/api/marketplace`.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/marketplace/catalog-url` | setting `marketplace.catalogUrl` |
| `PUT` | `/api/marketplace/catalog-url` | persist or clear (empty string deletes) |
| `GET` | `/api/marketplace/catalog?url=` | fetch/parse; sort `trustRank` then name; `sourceUrl` |
| `POST` | `/api/marketplace/install` | `{ id, url? }` (lookup in catalog) **or** `{ entry }` (direct) |

No default catalog URL. 400 if neither query nor setting. Fetch errors → 502. Install errors → 400.

Setting key: `marketplace.catalogUrl` via `apps/server/src/db/settings.ts`.

### Sample catalog fixture

`/Users/yeonwoosung/Desktop/neos-work/e2e/fixtures/marketplace/sample-catalog.json`

```json
{
  "schemaVersion": "neos-marketplace/v1",
  "name": "NEOS sample remote catalog",
  "entries": [{
    "id": "sample-remote-hello",
    "trust": "community",
    "packageUrl": "https://example.com/plugins/sample-remote-hello.json"
  }]
}
```

### Plugin marketplace UI

**Desktop** `apps/desktop/src/pages/Plugins.tsx` — `RemoteMarketplaceSection` (`data-testid="remote-marketplace"`):

- URL input, Save URL, Fetch catalog
- Trust badges: official / community / unverified
- Unverified → `window.confirm` before install
- Install sends **full `entry`** (`installMarketplaceEntry({ entry })`)
- Reloads local plugin list after install
- Installed grid: channel filter `all | official | community | user | bundled`, search, **Run** (SSE `PipelineRunner`)

**Web** `apps/web/src/pages/Plugins.tsx` (v0.25 Track A):

- Installed list (no Run)
- Marketplace: catalog URL save, refresh, install **by `id` only** (`installMarketplaceEntry({ id })`)
- **No unverified confirm**
- Footer: “Plugin pipeline run SSE stays on desktop.”

### Plugin list API (local catalog, not remote)

`apps/server/src/routes/plugins.ts` + `apps/server/src/lib/plugin-store.ts`

| Method | Path |
|---|---|
| `GET` | `/api/plugins` |
| `GET` | `/api/plugins/atoms` |
| `POST` | `/api/plugins/upgrade-from-skill` |
| `GET` | `/api/plugins/:id` |
| `POST` | `/api/plugins/:id/run` (SSE) |
| `POST` | `/api/plugins/:id/run/:runId/resume` |

`GET /api/plugins` strips `skillContent` and `dir`; keeps `channel`. `meta.channels` counts user/official/community/bundled.

`listPlugins`: scan `SKILLS_DIR` as `user`, then bundled `plugins/` (`_official`/`official` → official, `community` → community, else `bundled`). Same `id` → user wins.

### `od-plugin/v1` (`PluginManifest` in plugin-store)

`schemaVersion`, `id`, `name`, `description?`, `version`, `pipeline?`, `inputFields?`, `capabilityGates?`, plus loaded `skillContent?`, `dir?`, `channel?`.

Pipeline kinds: `discovery | plan | execute | critique | form | choice`.

Atom trust (separate from marketplace `TrustTier`): `AtomTrustLevel = 'builtin' | 'local' | 'untrusted'` in `packages/plugin-runtime/src/types.ts`.

---

## 6. How marketplace install writes “skills”

`installCatalogEntry(entry, { fetchImpl?, skillsDir? })`:

1. SSRF-safe GET `packageUrl` (`fetchPublicHttp`, DNS check). Package ≤ 256_000 bytes, non-empty.
2. If `entry.sha256` present, hex digest must match.
3. Parse JSON; require `schemaVersion === 'od-plugin/v1'`.
4. Force `m.id = sanitized catalog id`; fill name/version from entry if missing.
5. `dir = join(skillsRoot, id)`; refuse if not under root; refuse if `dir` is a symlink.
6. Write `{dir}/open-design.json`
7. Write `{dir}/neos-remote.json`:

```json
{
  "source": "remote-catalog",
  "trust": "<TrustTier>",
  "packageUrl": "<url>",
  "installedAt": "<ISO>"
}
```

8. Return `{ dir, id, version }`.

**Does not:** write `SKILL.md`, upsert `skill` table, run `discoverSkills`, or appear on Skills until a `SKILL.md` exists and scan runs.

`upgradeSkillToPlugin` is the inverse: writes `open-design.json` next to an existing **user-global** `SKILL.md` with a default 4-stage pipeline. Only looks under `~/.config/neos-work/skills/<sanitizedDir>`. Bundled repo `skills/<name>` is **not** a valid upgrade target unless copied there. Desktop “→ Plugin” on bundled rows typically fails with `Skill directory not found`.

---

## 7. CLI (`apps/cli`)

Router: `apps/cli/src/cli.ts` — `skills` / `skill` → `cmdSkills`; `plugin` / `plugins` → `cmdPlugin`.

### `neos skills` — `apps/cli/src/commands/skills.ts`

| Subcommand | API | Output |
|---|---|---|
| `list` / `ls` (default) | `GET /api/skills` | `id\tname\ton|off\tsource\tvversion` |
| `scan` | `POST /api/skills/scan` | `skills scan complete` |

Usage error: `usage: neos skills list|scan`.  
**No** install, add, search, toggle, delete, upgrade, marketplace.

### `neos plugin` — `apps/cli/src/commands/plugin.ts`

| Subcommand | API |
|---|---|
| `list` / `ls` | `GET /api/plugins` |
| `atoms` | `GET /api/plugins/atoms` |

**No** marketplace fetch/install, **no** run.

Client methods: `NeosApiClient.listSkills` / `scanSkills` / `listPlugins` in `apps/cli/src/client.ts`. No marketplace methods.

---

## 8. OpenCode compatibility

| Claim | Status |
|---|---|
| Parser “Compatible with OpenCode SKILL.md format” (`parser.ts`) | **Partial:** name/description/version/license/compatibility + OD extras. No nested `metadata`. No YAML lists. |
| `SkillSource = '…' \| 'opencode'` | Type + parser accept; **discovery never sets it** |
| Scan `.opencode/skills` and `~/.config/opencode/skills` (`INITIAL_PLAN.md` §11.3, `PLAN_FOR_V0_1_1.md` K2) | **Not implemented** |
| `npx opkg install` / `neos-work skill install github:` (`INITIAL_PLAN.md` §11.4) | **Not implemented** |
| i18n `github:owner/repo` / OpenPackage | Strings only; unused UI |
| `compatibility: opencode` frontmatter | Parsed onto `SkillManifest.compatibility`; unused at runtime |
| CLI agent `cli-opencode` | Separate: `packages/agent-runtime/src/defs/catalog.ts` binary `opencode`; Settings `CLI_PATH_OPENCODE`. Not a skill path. |

Open Design spec (`docs/reference/open-design-repository-spec-ko.md` §9) describes a richer `SkillInfo` (i18n, surface, craftRequires, etc.). Implemented `SkillManifest` is a subset.

---

## 9. Gaps vs a skills.sh / `npx skills` browse–search–install UX

skills.sh (Vercel Labs) as of this inventory: public catalog of `SKILL.md` packages; `npx skills add <owner>/<repo>` or `owner/repo@skill` or pack URL; installs into agent skill dirs; browse/search/leaderboard; optional `-a` agent targeting.

| skills.sh-like capability | NEOS today |
|---|---|
| Public browse of remote **SKILL.md** packages | **None.** Remote catalog is `neos-marketplace/v1` of **`od-plugin/v1` JSON** |
| Search remote skills | **None.** Desktop Skills search is **installed DB rows only** |
| One-command install from GitHub / slug | **None.** Marketplace install fetches a JSON `packageUrl` |
| Install writes `SKILL.md` into a skills dir | Crystallize and hand-authored files only. Marketplace writes `open-design.json` |
| Multi-agent target dirs (Claude, Cursor, …) | **None** |
| `npx skills add` / pack URL | **None.** CLI is `neos skills list\|scan` against the daemon |
| Leaderboard / install telemetry | **None** |
| Inspect remote SKILL.md before install | Desktop detail drawer is **installed** metadata only; body never in API |
| Update / pin commit | Marketplace overwrite of `open-design.json` only; no version check UX |
| Remove installed package files | Delete = DB row; files stay |
| Default public catalog | Catalog URL opt-in, empty by default |
| Skills page as marketplace | Skills = local registry. Marketplace lives on **Plugins** |

What already exists that a migration can reuse:

- SKILL.md parser + package layout + shadowing
- Scan → `skill` table → Skills UI
- User global dir `~/.config/neos-work/skills/<id>/`
- Remote fetch + SSRF + sha256 + trust tiers + catalog URL setting
- Desktop/web Plugins catalog UI (URL, list, install)
- Dual-surface policy for marketplace (Q29)

---

## 10. Security / trust already in marketplace and skills

### Marketplace trust

- `TrustTier`: `official | community | unverified`; unknown → `unverified`
- Catalog sort: official first
- Desktop: confirm only for `unverified`
- Web: no confirm
- `sha256` optional; if present, mismatch throws
- Provenance sidecar `neos-remote.json` (not a secret)

### SSRF (`apps/server/src/lib/ssrf.ts`)

`fetchPublicHttp` + `SsrfError`: http(s) only; blocks private/loopback/link-local/CGNAT/metadata IPv4 (and mapped IPv6); optional DNS so any private A/AAAA fails. Used by catalog and package fetch.

### Skill / plugin filesystem hygiene

- Refuse SKILL.md / open-design.json / skill-dir **symlinks**
- Control-char rejection before `trim`
- Size caps on files, catalog, package, manifests
- `publicPathTail` / `packageDirLabel` hide home paths
- Plugin `capabilityGates` + atom deny in `plugin-runner.ts`
- Install path must stay under `skillsRoot`; id sanitized

### Not present

- No signature / publisher identity beyond optional sha256
- No review of SKILL.md body on remote install (no SKILL.md is installed)
- `enabled` flag is UI-only; unused as an execution gate
- Marketplace install does not require matching local skill scan

---

## 11. Key types — `packages/shared/src/types/skill.ts`

Re-exported from `@neos-work/shared` (`packages/shared/src/index.ts`). **No Zod envelope** for skills in `packages/shared/src/schemas/`.

```ts
export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;      // typed, never populated by parser
  mode?: string;
  platform?: string;
  category?: string;
  featured?: boolean;
  examplePrompt?: string;
  triggers?: string[];
  designSystemRequired?: boolean;
  fidelity?: string;
}

export interface SkillExampleCard {
  id: string;   // `<parent-name>:<example-key>`
  key: string;
  path: string;
  title?: string;
}

export type SkillSource = 'local' | 'global' | 'bundled' | 'opencode';

export interface Skill {
  manifest: SkillManifest;
  content: string;
  path: string;
  source: SkillSource;
  packageDir?: string;
  assets?: string[];
  references?: string[];
  examples?: SkillExampleCard[];
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  version: string | null;
  installedAt: string;
}
```

`InstalledSkill` has **no production importers** (dead type). UI/API use ad-hoc row shapes (`SkillData`, GET mapper).

Related but separate:

- `PluginManifest` / `PluginChannel` in `apps/server/src/lib/plugin-store.ts`
- Desktop `Plugin` / `PluginChannel` in `apps/desktop/src/lib/engine-project-core.ts`
- `CatalogEntry` / `TrustTier` in `marketplace-catalog.ts`
- `AtomTrustLevel` in `packages/plugin-runtime/src/types.ts`

---

## 12. Dual-surface policy (desktop vs web)

Source of truth: `/Users/yeonwoosung/Desktop/neos-work/docs/reference/dual-surface.md`

| Surface | Skills | Plugins / marketplace |
|---|---|---|
| **Desktop** | Full: list, scan, filter, featured, detail, try, upgrade, toggle, delete | Full: channels, Run SSE, remote catalog URL, fetch, install, unverified confirm |
| **Web (v0.25–0.26)** | Thin: list, scan, toggle, delete | Thin: list, catalog URL, fetch, install by id; **no Run SSE** |
| **CLI** | `list` / `scan` | `list` / `atoms` |

Q29: “Desktop-only **full** marketplace UI”; web got catalog + install + URL later. Plugin-run SSE stays desktop.

**Stale sentence** in the same file (Client architecture “Don't”):

> Assume web marketplace install (workflows yes since v0.24; plugins still desktop-only)

This contradicts Q29 and current `apps/web/src/pages/Plugins.tsx`.

Web Settings (`apps/web/src/pages/Settings.tsx`) restates: catalog URL + install + pack zip on web; desktop keeps plugin-run studio.

Web has **no** skill→plugin upgrade and **no** routine crystallize.

---

## 13. Stale / unused / inconsistent (cite as-is)

| Item | Fact |
|---|---|
| OpenCode skill directories | Documented in INITIAL_PLAN / v0.1.1; not in `discoverSkills` |
| `SkillSource 'opencode'` | Parser-only |
| `InstalledSkill` | Unused |
| `SkillManifest.metadata` | Unused |
| `marketplaceInstallRootExists` | Unused export |
| i18n `skills.json` OpenPackage / `github:owner/repo` | Unused by pages |
| dual-surface “plugins still desktop-only” | Stale vs web Plugins |
| `NEOS_DATA_DIR` vs `~/.config/neos-work/skills` | Marketplace install honors data dir; discovery, plugin-store, crystallize do not |
| Scan workspace | Always `listWorkspaces()[0].path`; seed path is `NULL` |
| Scan prune | Missing skills stay in DB |
| Delete | Registry only |
| Featured | Manifest flag, not user favorite |
| Enabled | Not an execution gate |
| Skill body | Not in GET /api/skills; unused by agent-runtime |
| Marketplace → Skills page | No automatic link (no SKILL.md, no DB upsert) |
| Bundled skill `→ Plugin` | Looks only under user global skills dir |
| `scripts/` in skill packages | Not discovered |
| Auto-scan on server start | **None.** Empty Skills until user/CLI hits Scan |
| Default marketplace URL | None |

---

## 14. File index (absolute)

### Core / types

- `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/discovery.ts`
- `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/parser.ts`
- `/Users/yeonwoosung/Desktop/neos-work/packages/core/src/skills/index.ts`
- `/Users/yeonwoosung/Desktop/neos-work/packages/shared/src/types/skill.ts`
- `/Users/yeonwoosung/Desktop/neos-work/packages/plugin-runtime/src/types.ts`

### Server

- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/routes/skills.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/routes/skills.test.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/routes/marketplace.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/routes/marketplace.test.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/routes/plugins.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/lib/marketplace-catalog.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/lib/marketplace-catalog.test.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/lib/plugin-store.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/lib/plugin-runner.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/lib/ssrf.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/db/schema.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/server/src/routes/routines.ts` (crystallize)

### Clients

- `/Users/yeonwoosung/Desktop/neos-work/apps/desktop/src/pages/Skills.tsx`
- `/Users/yeonwoosung/Desktop/neos-work/apps/desktop/src/pages/Plugins.tsx`
- `/Users/yeonwoosung/Desktop/neos-work/apps/desktop/src/lib/engine-media.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/desktop/src/lib/engine-plugins.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/web/src/pages/Skills.tsx`
- `/Users/yeonwoosung/Desktop/neos-work/apps/web/src/pages/Plugins.tsx`
- `/Users/yeonwoosung/Desktop/neos-work/apps/web/src/lib/api.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/cli/src/commands/skills.ts`
- `/Users/yeonwoosung/Desktop/neos-work/apps/cli/src/commands/plugin.ts`

### Catalogs / policy

- `/Users/yeonwoosung/Desktop/neos-work/skills/*`
- `/Users/yeonwoosung/Desktop/neos-work/plugins/_official/*`
- `/Users/yeonwoosung/Desktop/neos-work/plugins/community/hello-plugin/`
- `/Users/yeonwoosung/Desktop/neos-work/e2e/fixtures/marketplace/sample-catalog.json`
- `/Users/yeonwoosung/Desktop/neos-work/docs/reference/dual-surface.md`
- `/Users/yeonwoosung/Desktop/neos-work/docs/reference/open-design-repository-spec-ko.md`
- `/Users/yeonwoosung/Desktop/neos-work/docs/plans/INITIAL_PLAN.md` (§11, partly unimplemented)
