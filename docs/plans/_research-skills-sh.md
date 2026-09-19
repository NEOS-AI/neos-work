# Research: skills.sh (Vercel Agent Skills Directory)

**Researched:** 2026-09-18  
**Method:** Live HTTP fetches of `https://www.skills.sh` and related URLs, official docs pages, and public GitHub sources. No invented endpoints. Unverified items are labeled as such.

**Primary sources**

- Site: [https://www.skills.sh/](https://www.skills.sh/), [https://skills.sh/](https://skills.sh/)
- Docs: [docs](https://www.skills.sh/docs), [CLI](https://www.skills.sh/docs/cli), [API](https://www.skills.sh/docs/api), [FAQ](https://www.skills.sh/docs/faq), [packs](https://www.skills.sh/docs/packs), [customize](https://www.skills.sh/docs/customize)
- Legal: [terms](https://www.skills.sh/terms), [privacy](https://www.skills.sh/privacy), [about](https://www.skills.sh/about), [contact](https://www.skills.sh/contact)
- Discovery: [robots.txt](https://www.skills.sh/robots.txt), [sitemap.xml](https://www.skills.sh/sitemap.xml)
- CLI: [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills) (MIT, v1.7.0 as of 2026-09-17)
- Skill format: [agentskills.io](https://agentskills.io/home), [specification](https://agentskills.io/specification)
- Well-known serving: [github.com/vercel-labs/skills-handler](https://github.com/vercel-labs/skills-handler)
- Official Vercel skill collection: [github.com/vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)
- Product context: [Vercel changelog](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem), [Vercel KB](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context), [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills)

---

## 1. What skills.sh is

**skills.sh is Vercel’s public directory and leaderboard for AI agent skills.** The homepage title is “The Agent Skills Directory.” Meta description: “Discover and install skills for AI agents.” Tagline: “The Open Agent Skills Ecosystem.” ([homepage](https://www.skills.sh/), HTML `<title>` / `<meta name="description">` fetched 2026-09-18)

The About page states the product purpose directly:

> skills.sh is the open directory for AI agent skills.  
> We index every public skill that ships through the open skills CLI and rank them by anonymous install telemetry. Every skill page shows the source repo, install count, originating organization, agents the skill is most-used on, and security audit results from our partners.  
> skills.sh is operated by Vercel as part of the open agent skills ecosystem.

Source: [https://www.skills.sh/about](https://www.skills.sh/about)

**Who it is for**

- Developers who want to **discover** reusable agent capabilities (`SKILL.md` packages) and **install** them into coding agents via `npx skills`.
- Skill authors who publish GitHub (or well-known HTTP) skill packages and want leaderboard / search visibility via CLI install telemetry. There is **no separate publish command**. ([FAQ](https://www.skills.sh/docs/faq), [Vercel KB](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context))
- Teams that want **unlisted skill packs** (Vercel-account-owned collections). ([docs/packs](https://www.skills.sh/docs/packs))
- Apps that want programmatic catalog access via the **authenticated `/api/v1` API**. ([docs/api](https://www.skills.sh/docs/api))

Vercel’s changelog frames the same product as “a directory and leaderboard for skill packages” alongside the `skills` CLI. ([changelog](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem))

Malte Ubl (Vercel CTO) is quoted in Vercel’s Skills Night post as calling it “a package manager for agent context.” That quote is from [vercel.com/blog/skills-night-62000-ways-agents-are-getting-smarter](https://vercel.com/blog/skills-night-62000-ways-agents-are-getting-smarter) (secondary product narrative; the live site itself uses “directory” / “open ecosystem”).

**What it is not**

- Not a hosted package store that vendors skill blobs as the source of truth. Installs fetch from GitHub / git / well-known URLs / local paths. skills.sh caches snapshots for a **download fast path** (`/api/download/...`) used by the CLI, but listing is telemetry-driven. ([CLI blob.ts](https://github.com/vercel-labs/skills/blob/main/src/blob.ts), [KB](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context))
- Not a replacement for the Agent Skills file format. Skills follow [agentskills.io](https://agentskills.io/specification).
- Not a private enterprise registry. Packs are “unlisted, not access-controlled.” ([docs/packs](https://www.skills.sh/docs/packs))

Canonical host: `https://www.skills.sh`. `https://skills.sh` returns HTTP 308 to `https://www.skills.sh/`. The API docs still document the base URL as `https://skills.sh`; both hosts serve the same API routes.

---

## 2. How the website works

The site is a **Next.js app on Vercel** (response headers: `server: Vercel`, `x-matched-path`, `vary: rsc, next-router-state-tree, ...`, `data-dpl-id=dpl_AmWrGY5rn67VFEApZCZ41dnHoGnL`). Dark UI, Geist + Fira Mono, ASCII “SKILLS” banner.

### 2.1 Global navigation

Header (desktop + mobile): **Packs, Topics, Official, Audits, Docs**. Footer also exposes Browse / Agents / Docs / Project. Fetched from homepage HTML.

Footer browse groups (homepage HTML, 2026-09-18):

| Group | Links |
| --- | --- |
| Browse | All skills `/`, Trending `/trending`, Hot `/hot`, Official `/official`, Packs `/packs`, Security audits `/audits` |
| Topics | React, Next.js, Design & UI, Mobile, Agent workflows, Databases, Testing, Marketing, All topics |
| Agents | Claude Code, Cursor, Codex, GitHub Copilot, Windsurf, Gemini, Cline, AMP, Antigravity, OpenClaw, All agents |
| Docs | Overview, CLI, Customize pages, API, FAQ |
| Project | About, Contact, Privacy, Terms, GitHub |

### 2.2 Browse / leaderboard

`/` is the **Skills Leaderboard**. Columns observed on the homepage: rank (`#`), skill name, source (`owner/repo` or a hostname), 8-week sparkline (“8W Activity”), and **Installs**.

Homepage copy:

> Skills are reusable capabilities for AI agents. Install them with a single command to enhance your agents with access to procedural knowledge.  
> Try it now: `$ npx skills update`

There is also a “Available for these agents” logo row. Homepage HTML preloads agent icons including `claude-code`, `cursor`, `codex`, `copilot`, `windsurf`, `gemini`, `cline`, `amp`, `antigravity`, `openclaw`, `droid`, `goose`, `kilo`, `kiro-cli`, `nous-research`, `opencode`, `roo`, `trae`, `vscode`, `zed`.

Leaderboard ranking is **deduplicated install telemetry from the CLI**, not stars or editorial votes. ([docs](https://www.skills.sh/docs), [FAQ](https://www.skills.sh/docs/faq), [about](https://www.skills.sh/about))

**View tabs** (footer + homepage links):

| Path | Title | Meaning |
| --- | --- | --- |
| `/` | All-time leaderboard | Default ranking by total installs. Homepage HTML contains the string `All-time`. |
| `/trending` | “Trending AI Agent Skills — This Week” | “fastest-growing … this week” ([trending](https://www.skills.sh/trending)) |
| `/hot` | “Hot AI Agent Skills — Right Now” | API docs: last hour vs same hour yesterday ([docs/api](https://www.skills.sh/docs/api), [hot](https://www.skills.sh/hot)) |
| `/picks` | “Picks — Daily Skill Highlights” | Editorial daily highlights ([picks](https://www.skills.sh/picks)) |
| `/official` | “Official Skills from Technology Makers” | Curated first-party / maker skills ([official](https://www.skills.sh/official)) |

API `GET /api/v1/skills?view=all-time|trending|hot` is the programmatic equivalent of the first three views. ([docs/api](https://www.skills.sh/docs/api))

Homepage rows observed 2026-09-18 (install counts move; these are snapshots):

| Rank | Skill | Source | Installs |
| --- | --- | --- | --- |
| 1 | find-skills | vercel-labs/skills | 3.4M |
| 2 | grill-me | mattpocock/skills | 1.2M |
| 6 | frontend-design | anthropics/skills | 896.9K |
| 7 | agent-browser | vercel-labs/agent-browser | 877.3K |
| 12 | vercel-react-best-practices | vercel-labs/agent-skills | 722.8K |

Skill rows link to `/owner/repo/skill` or `/site/domain/skill`.

### 2.3 Search

- UI: `/search` — title “Search AI Agent Skills”; description “Search the agent skills directory by skill, repo, owner, or use case.” Placeholder: “Start typing to search skills...” ([search](https://www.skills.sh/search))
- `robots.txt` **disallows `/search`**.
- CLI `npx skills find [query] [--owner <owner>]` calls the **legacy JSON search API** `GET https://skills.sh/api/search?q=...&limit=20` ([find.ts](https://github.com/vercel-labs/skills/blob/main/src/find.ts)).
- Official documented search is `GET /api/v1/skills/search` (OIDC required). Single-word = fuzzy, multi-word = semantic. ([docs/api](https://www.skills.sh/docs/api))
- Live `/api/search` (no auth) also switches: `q=react` → `"searchType":"fuzzy","searchVersion":"legacy"`; `q=frontend%20design` → `"searchType":"semantic","searchVersion":"legacy"`.

### 2.4 Filter / taxonomy surfaces

There is **no general faceted filter UI** (license, agent, language) on the homepage beyond leaderboard view tabs. Taxonomy is split into dedicated pages:

- **Topics** (`/topic`): curated domain collections. Eight topics listed on 2026-09-18, each with a small hand-picked set (5–21 skills), not the full catalog. ([topic](https://www.skills.sh/topic))
- **Official** (`/official`): maker/org table (Creator / Repos / Skills). Same dataset as `/api/v1/skills/curated`.
- **Agents** (`/agent/<slug>`): per-agent landing pages, e.g. “Skills for Claude Code — Install via the skills CLI.” ([agent/claude-code](https://www.skills.sh/agent/claude-code))
- **Package ecosystems** (`/package/npm|go|cargo|pip`): “Packages that ship agent skills, synced via `npx skills sync`.” npm page showed **0 packages / 0 total syncs** on 2026-09-18. ([package/npm](https://www.skills.sh/package/npm))
- **Sites** (`/site/<domain>`): well-known HTTP skill hosts (Lark, Stripe docs, etc.).

### 2.5 Page types (from `x-matched-path` and sitemap)

| Pattern | Example | Role |
| --- | --- | --- |
| `/` | homepage | All-time leaderboard |
| `/[owner]` | `/vercel-labs` | Owner: sources, skill count, total installs |
| `/[owner]/[repo]` | `/vercel-labs/agent-skills` | Repo: install command + grouped skills |
| `/[owner]/[repo]/[skill]` | `/vercel-labs/skills/find-skills` | Skill detail |
| `/[owner]/[repo]/[skill]/security/[provider]` | `/vercel-labs/skills/find-skills/security/socket` | Partner audit detail |
| `/site/[domain]` | `/site/open.feishu.cn` | Well-known host |
| `/site/[domain]/[skill]` | `/site/open.feishu.cn/lark-doc` | Well-known skill |
| `/p/<pack-id>` | (unlisted) | Pack install URL |
| `/b/<owner>/<repo>` | `/b/vercel-labs/skills` | Install-count SVG badge |

Owner page example (`/vercel-labs`, 2026-09-18):

- Meta description: “Browse 314 agent skills published by vercel-labs across 52 repositories.”
- Visible body: **50 sources, 202 skills, 6.8M total installs**.  
  Meta vs body disagree; treat counts as approximate / cached.

Repo page example (`/vercel-labs/agent-skills`):

- Header: `16 skills`, `2.4M total installs`, GitHub link
- Install: `` $ npx skills add vercel-labs/agent-skills ``
- Groupings from repo-root `skills.sh.json` (React / Vercel / Design) plus “Other skills”

### 2.6 Skill detail page (what users see)

Example: [find-skills](https://www.skills.sh/vercel-labs/skills/find-skills)

Observed sections:

1. Title + optional topic chip (`Agent workflows` → `/topic/agent-workflows`)
2. **Installation** command prompt:
   ```
   $ npx skills add https://github.com/vercel-labs/skills --skill find-skills
   ```
3. **Summary** bullets (generated/extracted from SKILL.md)
4. **SKILL.md** body (truncated with “Show more”)
5. Related skills in the same topic
6. Sidebar stats: **Installs**, **Repository** (GitHub link), **GitHub Stars**, **First Seen**, **Security Audits**

Well-known example: [lark-doc](https://www.skills.sh/site/open.feishu.cn/lark-doc)

```
$ npx skills add https://open.feishu.cn/lark-cli/skills/regular
```

Source link is the well-known/base URL, not GitHub. First Seen: Apr 14, 2026. Installs: 705.3K (snapshot).

### 2.7 Install instructions shown to users

| Surface | Command shown |
| --- | --- |
| Homepage hero | `npx skills update` |
| Hot page hero | `npx skills find <query>` |
| Repo page | `npx skills add owner/repo` |
| GitHub skill page | `npx skills add https://github.com/owner/repo --skill <slug>` |
| Well-known skill page | `npx skills add https://<host>/...` |
| Packs docs | `npx skills add https://skills.sh/p/<pack-id>` |
| Agent landing | `npx skills add <owner>/<repo>` |
| Badge snippet ([docs](https://www.skills.sh/docs)) | `[![skills.sh](https://skills.sh/b/owner/repo)](https://skills.sh/owner/repo)` |

The site does **not** run install itself. It copies/displays CLI commands. Actual install is the `skills` npm package (`npx skills` / `npx add-skill`).

### 2.8 Packs

[docs/packs](https://www.skills.sh/docs/packs) (fetched 2026-09-18):

- Packs are **unlisted collections** of public skills.sh skills, private files/folders/zips, and GitHub repo skills.
- Create/manage requires **Sign in with Vercel**. `/packs` shows “Sign in to see your packs.”
- Anyone with the pack URL can view/install. **Not access-controlled.**
- Install: `npx skills add https://skills.sh/p/<pack-id>`
- Update: `npx skills update`
- File rules: each skill needs `SKILL.md` with `name` + `description`; invalid files skipped; binary files and files **> 2 MB** omitted.
- “Do not include secrets or credentials in a pack.”

`GET /api/packs` without auth (2026-09-18):

```json
{"authenticated":false,"orgs":[],"message":"Sign in with Vercel to continue."}
```

### 2.9 Repo page customization

Owners commit `skills.sh.json` at the repo default-branch root. Schema: [https://www.skills.sh/schemas/skills.sh.schema.json](https://www.skills.sh/schemas/skills.sh.schema.json) (`Access-Control-Allow-Origin: *`). Display-only; does not change CLI install. Picked up after a CLI install **with telemetry enabled**. Limits: 50 groups, 500 skills/group. ([docs/customize](https://www.skills.sh/docs/customize))

---

## 3. Public APIs / data feeds

### 3.1 robots.txt and sitemap

[https://www.skills.sh/robots.txt](https://www.skills.sh/robots.txt):

```
User-Agent: *
Allow: /
Disallow: /internal/
Disallow: /debug-security/
Disallow: /search
Disallow: /api/

Sitemap: https://www.skills.sh/sitemap.xml
```

**Implication:** crawlers are told not to hit `/api/` or `/search`. The official API still exists for authenticated clients; `robots.txt` is not a license, but it is a published access policy.

[https://www.skills.sh/sitemap.xml](https://www.skills.sh/sitemap.xml) is a sitemap index:

| Child | URLs (2026-09-18) | Notes |
| --- | --- | --- |
| [sitemap-misc.xml](https://www.skills.sh/sitemap-misc.xml) | 207 | Home, docs, legal, topics, agents, packages, `/site/*` hosts |
| [sitemap-owners.xml](https://www.skills.sh/sitemap-owners.xml) | 16,738 | `/<owner>` pages |
| [sitemap-skills-1.xml](https://www.skills.sh/sitemap-skills-1.xml) | 10,000 | Skill pages, ranked-ish from the top |
| [sitemap-skills-2.xml](https://www.skills.sh/sitemap-skills-2.xml) | 10,000 | Continuation; last URLs are long-tail |
| `sitemap-skills-3.xml` | **404** | No third skill sitemap |

**Verified indexed skill URLs in sitemap: 20,000.** That is a sitemap file cap (`<urlset>` of 10k × 2), **not** a verified total catalog size. Owner pages (16,738) imply many more sources than 20k skills if most owners have ≥1 skill, **or** many owners with zero/few skills. Do not treat 20k as the full catalog.

### 3.2 Endpoints that do not exist (probed)

| URL | Result | Notes |
| --- | --- | --- |
| `/api` | 404 HTML, `x-matched-path: /[owner]` | Caught by owner route |
| `/api/v1` | 404 HTML, same | No index document |
| `/llms.txt`, `/llms-full.txt` | 404 | No LLM txt feed |
| `/openapi.json`, `/swagger.json` | 404 | No public OpenAPI file |
| `/.well-known.json` | 404 | |
| `/.well-known/skills` | 404 | skills.sh does not host its own well-known skill index |
| `/.well-known/skills/index.json` | 200 HTML, matched as `/[owner]/[repo]/[skill]` | **Not** a JSON discovery index |
| `/docs/specification` | 404 | Spec lives at agentskills.io |

### 3.3 Official API: `https://skills.sh/api/v1/`

Documented at [https://www.skills.sh/docs/api](https://www.skills.sh/docs/api).

**Auth:** Vercel OIDC only. No API-key signup.

- Header: `Authorization: Bearer <VERCEL_OIDC_TOKEN>`
- Alternate: `x-vercel-oidc-token: <token>`
- Token from `process.env.VERCEL_OIDC_TOKEN` or `@vercel/oidc` `getVercelOidcToken()`
- Verified against `oidc.vercel.com`
- Logged fields: `owner_id` (team), `project_id`, `environment` (`production` / `preview` / `development`). Raw token is not stored.

**Unauthenticated call** to `GET /api/v1/skills` (live 2026-09-18):

```json
{
  "error": "authentication_required",
  "message": "This endpoint requires authentication. Pass a Vercel OIDC token (Authorization: Bearer <VERCEL_OIDC_TOKEN>) — see https://skills.sh/docs/api#authentication."
}
```

HTTP 401, `content-type: application/json`.

Same 401 body for `/api/v1/skills/search?q=react`, `/api/v1/skills/curated`, and `/api/v1/skills/vercel-labs/skills/find-skills`.

**Documented rate limits**

| Tier | Limit | Scope |
| --- | --- | --- |
| Authenticated | 600 req / min | Per (team, project) |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. 429 includes `Retry-After`.

**Documented errors**

```json
{ "error": "error_code", "message": "Human-readable description." }
```

| Status | Meaning |
| --- | --- |
| 400 | Invalid request parameters |
| 401 | Missing/invalid/expired OIDC token |
| 404 | Skill not found |
| 429 | Rate limited |
| 503 | Temporarily unavailable |

**Caching (docs):** leaderboard/search 30–60s; detail and curated 5 minutes.

#### `GET /api/v1/skills`

Paginated leaderboard.

Query: `view=all-time|trending|hot` (default `all-time`), `page` (0-indexed, default 0), `per_page` (1–500, default 100).

Documented response shape:

```json
{
  "data": [
    {
      "id": "vercel-labs/skills/find-skills",
      "slug": "find-skills",
      "name": "find-skills",
      "source": "vercel-labs/skills",
      "installs": 24531,
      "sourceType": "github",
      "installUrl": "https://github.com/vercel-labs/skills",
      "url": "https://skills.sh/vercel-labs/skills/find-skills"
    }
  ],
  "pagination": {
    "page": 0,
    "perPage": 10,
    "total": 8420,
    "hasMore": true
  }
}
```

`pagination.total: 8420` is a **documentation example**, not a live measurement. This research did not obtain a live authenticated leaderboard total.

Hot view adds `installsYesterday` and `change`.

#### `GET /api/v1/skills/search`

Query: `q` (required, min 2 chars), `limit` (1–200, default 50), `owner` (GitHub owner).

Documented response:

```json
{
  "data": [
    {
      "id": "expo/skills/react-native",
      "slug": "react-native",
      "name": "React Native",
      "source": "expo/skills",
      "installs": 3842,
      "sourceType": "github",
      "installUrl": "https://github.com/expo/skills",
      "url": "https://skills.sh/expo/skills/react-native"
    }
  ],
  "query": "react native",
  "searchType": "semantic",
  "count": 5,
  "durationMs": 142
}
```

#### `GET /api/v1/skills/curated`

Official maker set (same as `/official`). Documented shape:

```json
{
  "data": [
    {
      "owner": "vercel-labs",
      "totalInstalls": 89240,
      "featuredRepo": "skills",
      "featuredSkill": "find-skills",
      "skills": [ { "...V1Skill..." : true } ]
    }
  ],
  "totalOwners": 87,
  "totalSkills": 342,
  "generatedAt": "2026-03-31T08:00:00.000Z"
}
```

`totalOwners` / `totalSkills` in that snippet are documentation examples. The live `/official` HTML lists far more than 87 creator rows (on the order of ~80–100+ named orgs; exact live API totals not fetched without OIDC).

#### `GET /api/v1/skills/:source/:skill`

GitHub: `/api/v1/skills/vercel-labs/skills/find-skills`  
Well-known: `/api/v1/skills/mintlify.com/mintlify`  
Construct as `/api/v1/skills/{id}`.

Documented response:

```json
{
  "id": "vercel-labs/skills/find-skills",
  "source": "vercel-labs/skills",
  "slug": "find-skills",
  "installs": 24531,
  "hash": "a1b2c3d4e5f6...",
  "files": [
    { "path": "SKILL.md", "contents": "---\nname: Next.js Development\n..." },
    { "path": "examples/app-router.ts", "contents": "// Example code..." }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `{source}/{slug}` |
| `source` | string | `owner/repo` or `domain.com` |
| `slug` | string | URL-safe skill slug |
| `installs` | integer | Deduplicated install count |
| `hash` | string \| null | SHA-256 of skill file contents; null if no snapshot |
| `files` | array \| null | `{path, contents}` for every file in the skill folder |

**Not independently verified live** (401 without OIDC). The unofficial `/api/download/...` returns the same `{files, hash}` shape and was verified (see §3.4).

#### `GET /api/v1/skills/audit/:source/:skill`

Docs say authentication is required. **Live unauthenticated GET succeeded** on 2026-09-18:

```
GET https://www.skills.sh/api/v1/skills/audit/vercel-labs/skills/find-skills
```

```json
{
  "id": "vercel-labs/skills/find-skills",
  "source": "vercel-labs/skills",
  "slug": "find-skills",
  "audits": [
    {
      "provider": "Gen Agent Trust Hub",
      "slug": "agent-trust-hub",
      "status": "pass",
      "summary": "This skill facilitates the discovery and installation of agent extensions using a dedicated command-line interface. ...",
      "auditedAt": "2026-09-15T08:00:05.922Z",
      "riskLevel": "SAFE",
      "categories": ["COMMAND_EXECUTION", "EXTERNAL_DOWNLOADS", "INDIRECT_PROMPT_INJECTION"]
    },
    {
      "provider": "Socket",
      "slug": "socket",
      "status": "pass",
      "summary": "No alerts",
      "auditedAt": "2026-09-15T08:00:19.647Z"
    },
    {
      "provider": "Snyk",
      "slug": "snyk",
      "status": "warn",
      "summary": "Risk: MEDIUM · 1 issue",
      "auditedAt": "2026-09-15T07:59:46.904821+00:00",
      "riskLevel": "MEDIUM"
    },
    {
      "provider": "Runlayer",
      "slug": "runlayer",
      "status": "pass",
      "summary": "1 file scanned · No issues",
      "auditedAt": "2026-03-14T07:45:27.566Z",
      "riskLevel": "NONE"
    },
    {
      "provider": "ZeroLeaks",
      "slug": "zeroleaks",
      "status": "pass",
      "summary": "Score: 93/100 · 2 sections analyzed",
      "auditedAt": "2026-04-16T07:47:59.444Z",
      "riskLevel": "NONE"
    }
  ]
}
```

Audit `status`: `pass` | `warn` | `fail`. `riskLevel`: `NONE` | `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` (live also returned `SAFE` from Gen).

Missing audits: `GET /api/v1/skills/audit/open.feishu.cn/lark-doc` →

```json
{
  "error": "not_found",
  "message": "No security audits found for this skill. Audits are generated automatically after a skill is installed for the first time."
}
```

#### Documented `V1Skill` listing object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | `{source}/{slug}` |
| `slug` | string | URL-safe slug |
| `name` | string | Human-readable name |
| `source` | string | GitHub `owner/repo` or well-known `domain.com` |
| `installs` | integer | Deduplicated installs |
| `sourceType` | string | `"github"` or `"well-known"` |
| `installUrl` | string \| null | Passed to `npx skills add {installUrl}` |
| `url` | string | skills.sh page |
| `isDuplicate` | boolean | Present and `true` if detected fork/copy; omitted when false |

### 3.4 Unofficial / CLI-used APIs (live, mostly unauthenticated)

These are **not listed** in `/docs/api` except where noted. They are network-visible and used by the open-source CLI.

#### `GET /api/search` — legacy search (CLI `skills find`)

- Matched path: `/api/search`
- `robots.txt` disallows `/api/`
- No auth required (2026-09-18)
- `q` min 2 chars; 1 char → `{"error":"Query must be at least 2 characters"}` (HTTP 400)
- `limit` honored (`q=react&limit=3` returned `count: 3`)
- `owner` filter accepted (`q=react&owner=vercel-labs` returned vercel-labs-only results; owner-less `find-skills` still appeared because the name matched)
- Header: `x-search-version: legacy`, `server-timing: search;dur=...`

Live shape (`q=react`, truncated):

```json
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
    }
  ],
  "count": 100,
  "duration_ms": 760
}
```

CLI consumer type ([find.ts](https://github.com/vercel-labs/skills/blob/main/src/find.ts)):

```ts
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';
// GET `${SEARCH_API_BASE}/api/search?q=...&limit=20&owner=...`
// expects { skills: Array<{ id, name, installs, source }> }
```

Default unscoped search returned **100** skills for `q=react`.

#### `GET /api/download/:owner/:repo/:skill` — snapshot blob (CLI fast path)

Matched path: `/api/download/[owner]/[repo]/[skill]`.  
`content-type: application/json`, `cache-control: public`, no auth.

Live `GET /api/download/vercel-labs/skills/find-skills`:

```json
{
  "files": [
    { "path": "SKILL.md", "contents": "---\nname: find-skills\n..." }
  ],
  "hash": "b146008599c31057cef1c145774cea5d5afb30e8f43fa802e47a4b461419aaaf"
}
```

Live `GET /api/download/vercel-labs/agent-skills/vercel-react-best-practices`: `76` files (`SKILL.md`, `AGENTS.md`, `README.md`, `metadata.json`, `rules/*.md`, …), hash `ca7b0c0c6e5f2750043f7f0cd72d16ac4e2abc48f9b5500d047a4b77a2506212`.

Missing skill: `{"error":"not_found"}`.

CLI ([blob.ts](https://github.com/vercel-labs/skills/blob/main/src/blob.ts)):

```ts
const DOWNLOAD_BASE_URL = process.env.SKILLS_DOWNLOAD_URL || 'https://skills.sh';
// GET `${DOWNLOAD_BASE_URL}/api/download/${owner}/${repo}/${slug}`
// SkillDownloadResponse { files: {path, contents}[], hash: string /* skillsComputedHash */ }
```

Zapier is special-cased to self-host snapshots at `https://connectors-skills.zapier.com/download/${slug}/snapshot.json`.

#### Telemetry and CLI audit (separate Vercel app)

CLI ([telemetry.ts](https://github.com/vercel-labs/skills/blob/main/src/telemetry.ts)):

```ts
const TELEMETRY_URL = 'https://add-skill.vercel.sh/t';
const AUDIT_URL = 'https://add-skill.vercel.sh/audit';
```

Install event query params include `event=install`, `source`, `skills`, `agents`, optional `global=1`, `skillFiles` (JSON map), `installUrl`, `metadata`, `sourceType`, plus `v` (CLI version), `ci=1`, `agent` (detected agent).

Live `GET https://add-skill.vercel.sh/audit?source=vercel-labs/skills&skills=find-skills`:

```json
{
  "find-skills": {
    "ath": { "risk": "safe", "analyzedAt": "2026-09-15T08:00:05.922Z" },
    "socket": { "risk": "safe", "alerts": 0, "score": 90, "analyzedAt": "2026-09-15T08:00:19.647Z" },
    "snyk": { "risk": "medium", "analyzedAt": "2026-09-15T07:59:46.904821+00:00" },
    "zeroleaks": { "risk": "safe", "score": 93, "analyzedAt": "2026-04-16T07:47:59.444Z" }
  }
}
```

`https://add-skill.vercel.sh/t` exists (`x-matched-path: /t`, HTTP 200). This is the ingestion endpoint named in [privacy](https://www.skills.sh/privacy).

#### Other probes

| URL | Result |
| --- | --- |
| `/api/packs` | JSON 401-style body, authenticated:false (see §2.8) |
| `/api/leaderboard`, `/api/find`, `/api/hot`, `/api/topics`, `/api/agents` | 404 HTML (owner/repo catch-all) |
| `/api/skills/leaderboard` | 200 HTML (route collision, not JSON) |
| `/b/vercel-labs/skills` | SVG badge, `content-type: image/svg+xml`, `Skills: 3.5M`, cache 300s, `access-control-allow-origin: *` |
| `/schemas/skills.sh.schema.json` | JSON Schema 2020-12, CORS `*` |

### 3.5 Next.js data routes

No `/_next/data/...` JSON catalog was found. Pages are App Router RSC HTML. There is no public unauthenticated dump of the full leaderboard.

### 3.6 Related GitHub org repos (vercel-labs)

Verified public repos relevant to this ecosystem:

| Repo | Role |
| --- | --- |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) | CLI (`npx skills`). MIT. Issues for both CLI **and directory**. |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Official Vercel skill collection |
| [vercel-labs/skills-handler](https://github.com/vercel-labs/skills-handler) | Serve `/.well-known/skills/*` |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Popular skill source on the leaderboard |
| [vercel-labs/vercel-kb-skills](https://github.com/vercel-labs/vercel-kb-skills) | KB companion skills (`.skill` zips + CLI) |
| [vercel-labs/next-skills](https://github.com/vercel-labs/next-skills) | Moved to `vercel/next.js` `skills/` |

About says “the CLI, the ingestion pipeline, and this site are open source.” The **website/ingestion source is not in `vercel-labs/skills`** (that repo is CLI-only: `src/`, `bin/`, `skills/find-skills`). A separate public website repo was **not found**. Treat “site is open source” as a claim that is **not independently verified** from a public tree.

---

## 4. Skill identity model

A skill’s **stable ID** on skills.sh is:

```
{source}/{slug}
```

Examples:

| Kind | `id` | `source` | `slug` / `skillId` | Website path |
| --- | --- | --- | --- | --- |
| GitHub | `vercel-labs/skills/find-skills` | `vercel-labs/skills` | `find-skills` | `/vercel-labs/skills/find-skills` |
| GitHub | `vercel-labs/agent-skills/vercel-react-best-practices` | `vercel-labs/agent-skills` | `vercel-react-best-practices` | `/vercel-labs/agent-skills/vercel-react-best-practices` |
| Well-known | `open.feishu.cn/lark-doc` (API style) | `open.feishu.cn` | `lark-doc` | `/site/open.feishu.cn/lark-doc` |

`sourceType` is `"github"` or `"well-known"`. ([docs/api](https://www.skills.sh/docs/api))

### 4.1 Name vs directory vs slug

- **Frontmatter `name`**: required by Agent Skills spec. 1–64 chars, `[a-z0-9-]`, no leading/trailing/consecutive hyphens. Spec says it **must match the parent directory name**. ([agentskills.io/specification](https://agentskills.io/specification))
- **Directory name**: kebab-case folder containing `SKILL.md`. CLI **installs under `name`**, not necessarily the source directory ([issue #917](https://github.com/vercel-labs/skills/issues/917)).
- **Slug**: CLI `toSkillSlug()` lowercases, turns spaces/underscores into hyphens, strips non `[a-z0-9-]`, collapses hyphens ([blob.ts](https://github.com/vercel-labs/skills/blob/main/src/blob.ts)). skills.sh matching treats spaces/underscores as hyphens, case-insensitive ([docs/customize](https://www.skills.sh/docs/customize)).
- **Legacy search `skillId`**: same as slug in live `/api/search` results.

Addressing a skill for install:

```
npx skills add <owner/repo>
npx skills add <owner/repo> --skill <name>
npx skills add <owner/repo>@<skill-name>          # CLI ParsedSource.skillFilter
npx skills add https://github.com/<owner>/<repo>/tree/<ref>/skills/<dir>
npx skills add https://skills.sh/p/<pack-id>
npx skills add https://<well-known-host>/...
```

CLI also accepts GitLab, Azure Repos, any git URL, local paths, and direct `SKILL.md` / zip / tar downloads. ([README](https://github.com/vercel-labs/skills/blob/main/README.md))

### 4.2 Version and hash

**There is no registry-assigned semver.** Version, if any, is optional frontmatter:

```yaml
metadata:
  version: "1.0.0"
```

CLI can pin a **git ref / commit SHA** (`ref` on lock entries; README changelog: “support installing skills pinned to a commit SHA”).

**Two hashes exist:**

| Hash | Where | What it is |
| --- | --- | --- |
| GitHub **tree SHA** (`skillFolderHash`) | Global lock `~/.agents/.skill-lock.json` | Git Trees API SHA of the skill folder. Changes if any file in the folder changes. Empty for private repos if unauthenticated. ([skill-lock.ts](https://github.com/vercel-labs/skills/blob/main/src/skill-lock.ts)) |
| **SHA-256 of file contents** (`hash` / `computedHash` / `skillsComputedHash`) | `/api/v1` detail, `/api/download`, project `skills-lock.json` | SHA-256 over sorted relative paths + file bytes. Used for cache invalidation and local update detection. ([local-lock.ts](https://github.com/vercel-labs/skills/blob/main/src/local-lock.ts), [docs/api](https://www.skills.sh/docs/api)) |

Well-known installs may also store `wellKnownDigest`.

Global lock entry shape (`SkillLockEntry`, lock version 3):

```ts
{
  source: string;            // "owner/repo" or "mintlify/bun.com"
  sourceType: string;        // "github" | "mintlify" | "huggingface" | "local" | ...
  sourceUrl: string;
  ref?: string;
  skillPath?: string;        // e.g. "skills/react-best-practices/SKILL.md"
  skillFolderHash: string;   // GitHub tree SHA
  installedAt: string;
  updatedAt: string;
  pluginName?: string;
  sourceBaseUrl?: string;
  wellKnownDigest?: string;
}
```

Project lock `skills-lock.json` (`LocalSkillLockEntry`): `source`, `sourceUrl?`, `ref?`, `sourceType`, `skillPath?`, `computedHash`, `subagents?`, `wellKnownDigest?`. Designed to be committed.

### 4.3 Source aliases

CLI `SOURCE_ALIASES` remaps some shorthands (e.g. `vercel-labs/vercel-skills` → `vercel-labs/agent-skills`, `coinbase/agentWallet` → `coinbase/agentic-wallet-skills`). ([source-parser.ts](https://github.com/vercel-labs/skills/blob/main/src/source-parser.ts))

---

## 5. Skill package format expected by the registry

skills.sh does **not** define a private package format. It indexes **Agent Skills** (`SKILL.md`) that the CLI can install.

### 5.1 Agent Skills spec (agentskills.io)

Originally from Anthropic; now the open standard. ([agentskills.io](https://agentskills.io/home))

Minimum:

```
skill-name/
└── SKILL.md
```

`SKILL.md` = YAML frontmatter + Markdown body.

| Field | Required | Constraints |
| --- | --- | --- |
| `name` | yes | 1–64, `[a-z0-9-]`, no leading/trailing/consecutive `-`, must match directory |
| `description` | yes | 1–1024 chars; what + when |
| `license` | no | License name or bundled file |
| `compatibility` | no | ≤500 chars; environment requirements |
| `metadata` | no | `map[string]string` |
| `allowed-tools` | no | Experimental space-separated tool grants |

Recommended optional dirs: `scripts/`, `references/`, `assets/`. Progressive disclosure: metadata always, body on activation, resources on demand. Validate with `skills-ref validate`. ([specification](https://agentskills.io/specification))

### 5.2 CLI discovery (what actually gets listed)

The CLI walks known containers up to 3 levels ([README](https://github.com/vercel-labs/skills/blob/main/README.md)):

- Repo root `SKILL.md`
- `skills/`, `skills/.curated/`, `skills/.experimental/`, `skills/.system/`
- Dozens of agent dirs (`.agents/skills/`, `.claude/skills/`, `.grok/skills/`, …)
- `.claude-plugin/marketplace.json` / `plugin.json` declared paths
- Fallback recursive search if nothing is found
- `--full-depth` for `examples/` / `tests/` etc.

Internal skills (`metadata.internal: true`) are hidden unless `INSTALL_INTERNAL_SKILLS=1`.

**How a skill gets onto skills.sh:** put it in a git repo (or well-known URL), have someone run `npx skills add` **with telemetry on**. No registry submission. ([FAQ](https://www.skills.sh/docs/faq), [KB](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context))

### 5.3 Well-known HTTP skills

CLI treats non-GitHub/GitLab HTTP(S) URLs as `type: 'well-known'`, then tries:

1. `/.well-known/agent-skills/index.json`
2. `/.well-known/skills/index.json`
3. Direct `SKILL.md` or archive download (10 MiB / 25 MiB extract / 1000 files defaults)

([source-parser.ts](https://github.com/vercel-labs/skills/blob/main/src/source-parser.ts), README)

[skills-handler](https://github.com/vercel-labs/skills-handler) implements:

- `GET /.well-known/skills/index.json`
- `GET /.well-known/skills/{name}/SKILL.md`
- `GET /.well-known/skills/{name}/{file}`

Live example (2026-09-18): `GET https://open.feishu.cn/.well-known/skills/index.json` → HTTP 200, `{"skills":[...]}` with **28** entries. Each entry has `name`, `description`, `files[]`. First skill `lark-approval` lists `SKILL.md` plus many `references/*.md`.

Mintlify `/.well-known/skills/index.json` and `/.well-known/agent-skills/index.json` were **404** at fetch time (API docs still use `mintlify.com` as the well-known example).

RFC referenced by skills-handler: [cloudflare/agent-skills-discovery-rfc](https://github.com/cloudflare/agent-skills-discovery-rfc). Community implementations also mention `sha256` on index entries (e.g. agentskills.io schema `v0.2.0`); the live Feishu index fetched here did **not** include hashes.

### 5.4 Claude skills vs agentskills.io

They are the **same file format**. Claude Code is one of many install targets. CLI also reads Claude plugin marketplace manifests. Compatibility table in the CLI README: all listed agents support “Basic skills”; `allowed-tools` / hooks / `context: fork` vary (Claude Code has the most extras).

---

## 6. Trust / security model

### 6.1 What exists

1. **Automated partner audits** after first install. Partners named on the live audit API and `/audits`: **Gen Agent Trust Hub**, **Socket**, **Snyk**, plus **Runlayer** and **ZeroLeaks** on the v1 audit payload. `/audits` table shows Gen / Socket / Snyk columns. ([audits](https://www.skills.sh/audits), [docs/api](https://www.skills.sh/docs/api), [about](https://www.skills.sh/about))
2. **About:** “Skills that fail every partner audit are excluded from the directory entirely.” Not independently verified (no public fail-exclusion list).
3. **Duplicate detection:** `isDuplicate: true` on listing objects. ([docs/api](https://www.skills.sh/docs/api))
4. **CLI path sanitization** against directory traversal ([PR #8](https://github.com/vercel-labs/skills/pull/8)).
5. **Telemetry only for public GitHub** (GitHub-confirmed public). Other remotes may still send identifiers. Security-audit requests limited to confirmed-public GitHub repos. ([README Telemetry](https://github.com/vercel-labs/skills/blob/main/README.md))
6. **Install-count dedup:** privacy page says IP-derived hash + JA4 fingerprint, discarded after hourly aggregation. ([privacy](https://www.skills.sh/privacy))
7. **Disclosure:** [security.vercel.com](https://security.vercel.com/) ([contact](https://www.skills.sh/contact), [docs](https://www.skills.sh/docs))

### 6.2 What does **not** exist (or is weak)

- No human review gate before listing.
- No signed package attestations / Sigstore-style provenance observed.
- Hashes are **content hashes / git tree SHAs**, not author signatures.
- “Official” is an editorial maker list, not a cryptographic identity.
- Docs: “We cannot guarantee the quality or security of every skill.” ([docs](https://www.skills.sh/docs), [terms](https://www.skills.sh/terms), [about](https://www.skills.sh/about))
- Many well-known skills (Lark family on `/audits`) show **Pending** for all partners.
- Historical supply-chain issue: namespace squatting via frontmatter `name` hijack ([issue #353](https://github.com/vercel-labs/skills/issues/353)). Current mitigation status was not re-audited here.
- Contact claims hidden/redirected skills are managed via a **manifest in vercel-labs/skills README**. The current public README **does not document** that format. Unverified.

Vercel Skills Night post describes partnerships with Gen, Socket, and Snyk to scan the catalog. ([blog](https://vercel.com/blog/skills-night-62000-ways-agents-are-getting-smarter))

---

## 7. How install is supposed to work

### 7.1 From the website

User copies a command and runs it locally. The site never installs into the browser.

Typical GitHub skill:

```bash
npx skills add https://github.com/vercel-labs/skills --skill find-skills
```

Typical repo (all / prompted skills):

```bash
npx skills add vercel-labs/agent-skills
```

Pack:

```bash
npx skills add https://skills.sh/p/<pack-id>
```

### 7.2 CLI behavior (source of truth: vercel-labs/skills README + src)

Package: npm `skills` v1.7.0, bin `skills` and `add-skill`, Node `>=22.20.0`, MIT, homepage skills.sh.

**Add flow (conceptual):**

1. Parse source (GitHub shorthand, URL, well-known, git, local, pack URL).
2. Prefer **blob fast path**: GitHub Trees API → raw frontmatter → `GET skills.sh/api/download/{owner}/{repo}/{slug}`. Fall back to `git clone`.
3. Discover `SKILL.md` files; filter by `--skill` / `@name`.
4. Detect installed agents (or prompt).
5. Write canonical copy (usually `.agents/skills/<name>/`) and **symlink** into each agent dir (or `--copy`).
6. Update global `~/.agents/.skill-lock.json` and/or project `skills-lock.json`.
7. Fire telemetry to `https://add-skill.vercel.sh/t` unless `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`.
8. Optionally fetch audits from `https://add-skill.vercel.sh/audit` (3s timeout, never blocks install).

**Scope**

| Scope | Flag | Location |
| --- | --- | --- |
| Project | default | `./<agent-or-.agents>/skills/` |
| Global | `-g` | `~/...` per agent |

**Common flags:** `-a/--agent`, `-s/--skill` (`*` = all), `-l/--list`, `--copy`, `-y/--yes`, `--all`.

**Other commands:** `use`, `list`/`ls`, `find`, `remove`/`rm`, `update`, `init`, `check`, `experimental_install` (restore from lock), `experimental_sync` (node_modules → agent dirs).

**Opt out of ranking:** `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`. ([docs/cli](https://www.skills.sh/docs/cli), README)

---

## 8. Volume / taxonomy

### 8.1 Volume (only what is verified)

| Signal | Value | Confidence |
| --- | --- | --- |
| Skill URLs in sitemap | **20,000** (10k+10k) | High — counted `<loc>` |
| Owner URLs in sitemap | **16,738** | High |
| Misc URLs | **207** | High |
| Live `/api/v1` `pagination.total` | **not fetched** (401) | — |
| Docs example `total` | 8,420 | Example only |
| Docs curated example | 87 owners / 342 skills | Example only |
| vercel-labs owner page | 50 sources / 202 skills / 6.8M installs (body); meta says 314 skills / 52 repos | Observed, internally inconsistent |
| Official page | Dozens of maker orgs (Anthropic, AWS, Cloudflare, GitHub, Microsoft, OpenAI, Stripe, Supabase, Vercel, …) | Observed HTML table |
| find-skills installs | ~3.4M–3.5M | Homepage + badge |
| Historical Vercel blog | “62,000 skills” (2026-02-20 Skills Night) | Dated snapshot |
| Third-party tweets | “630k skills” (2026-06) | **Not verified** against live API |

**Do not treat any single number as the current catalog size.** The sitemap is capped at 20k skill URLs; telemetry-indexed skills may be larger; many indexed rows can be stale, duplicated, or empty (see GitHub issues about missing snapshots).

### 8.2 Topics (curated, small)

From [https://www.skills.sh/topic](https://www.skills.sh/topic) (2026-09-18):

| Topic | Slug | Skills listed |
| --- | --- | --- |
| Frontend & React | `/topic/react` | 6 |
| Next.js | `/topic/nextjs` | 7 |
| Design & UI | `/topic/design` | 16 |
| Mobile | `/topic/mobile` | 6 |
| Agent workflows | `/topic/agent-workflows` | 20 |
| Databases | `/topic/databases` | 13 |
| Testing | `/topic/testing` | 5 |
| Marketing | `/topic/marketing` | 21 |

These are **starting collections**, not exhaustive category indexes.

### 8.3 Agents

**Website agent pages** (sitemap + footer): Claude Code, Cursor, Codex, GitHub Copilot, Windsurf, Gemini, Cline, AMP, Antigravity, OpenClaw (`/agent/clawdbot`), Droid, Goose, Kilo, Kiro CLI, Nous Research, OpenCode, Roo, Trae, VS Code, Zed.

**CLI `AgentType` union** (vercel-labs/skills `src/types.ts`, v1.7.0) — 79 identifiers including: `aider-desk`, `amp`, `antigravity`, `antigravity-cli`, `astrbot`, `autohand-code`, `augment`, `bob`, `claude-code`, `openclaw`, `cline`, `codearts-agent`, `codebuddy`, `codemaker`, `codestudio`, `codex`, `command-code`, `continue`, `cortex`, `crush`, `cursor`, `deepagents`, `devin`, `dexto`, `droid`, `eve`, `firebender`, `forgecode`, `fx`, `gemini-cli`, `github-copilot`, `goose`, `grok`, `hermes-agent`, `inference-sh`, `iflow-cli`, `jazz`, `junie`, `kilo`, `kimchi`, `kimi-code-cli`, `kiro-cli`, `kode`, `lingma`, `loaf`, `mcpjam`, `minimax-code`, `mistral-vibe`, `moxby`, `mux`, `neovate`, `opencode`, `openhands`, `ona`, `pi`, `posit-assistant`, `qoder`, `qoder-cn`, `qwen-code`, `replit`, `reasonix`, `roo`, `rovodev`, `sarvam-code`, `tabnine-cli`, `terramind`, `tinycloud`, `trae`, `trae-cn`, `warp`, `windsurf`, `zed`, `zcode`, `zencoder`, `zenflow`, `pochi`, `promptscript`, `adal`, `universal`.

README claims “OpenCode, Claude Code, Codex, Cursor, and 75 more.”

Vercel product docs (2026-09-15) say “18+ AI agents.” That is a marketing subset of the CLI table.

**Grok / NEOS-relevant:** CLI supports `grok` → project `.grok/skills/`, global `~/.grok/skills/`.

### 8.4 Official makers (sample from `/official`)

Includes (non-exhaustive): aave, anthropics, apify, apollographql, astronomer, auth0, automattic, aws, axiomhq, better-auth, bitwarden, brave, browser-use, browserbase, callstackincubator, clerk, clickhouse, cloudflare, coderabbitai, coinbase, convex-dev, datadog-labs, denoland, elevenlabs, expo, facebook/react, firebase, firecrawl, flutter, getsentry, github, google-gemini, hashicorp, huggingface, langchain-ai, microsoft, mongodb, n8n-io, neondatabase, openai, pinecone-io, planetscale, posthog, prisma, remotion-dev, resend, sanity-io, shopify, stripe, supabase, sveltejs, temporalio, vercel, vercel-labs, webflow, wordpress, …

---

## 9. Licensing / ToS constraints for embedding in NEOS Work

### 9.1 skills.sh terms ([/terms](https://www.skills.sh/terms))

Plain-language terms. Material points:

1. **Directory of third-party skills.** Vercel indexes public content and runs automated scans. **No guarantee** of quality, safety, correctness, or security. Review `SKILL.md` and the source repo before install.
2. **No warranty** for the site, CLI, or public API.
3. **Skill content ownership:**  
   > Skills shown in the directory are the property of their authors and distributed under the licenses present in the source repositories. We do not own, host, or relicense skill content. Linking to a skill on skills.sh does not transfer rights.
4. **Public API:**  
   > Use of the public API is rate-limited per IP. Programmatic abuse, scraping that bypasses the rate limit, or use that materially degrades service for others may result in IP-level blocks. **Reasonable use, including caching results on your own infrastructure, is encouraged and not restricted.**
5. Takedowns via [/contact](https://www.skills.sh/contact). Terms may change; continued use = acceptance.

**Tension:** `/docs/api` says OIDC + 600/min per (team, project). `/terms` says rate-limited **per IP**. Live audit + legacy search + download APIs currently work **without** OIDC. Treat official embedding as **OIDC `/api/v1`**, and treat unauthenticated `/api/search` + `/api/download` as undocumented surfaces that could change or be blocked.

### 9.2 Privacy ([/privacy](https://www.skills.sh/privacy))

Telemetry: skill id, agent name, coarse timestamp, short fingerprint (IP hash + JA4) for hourly dedup. No prompts, session content, or personal info (their claim). Site uses Vercel Analytics / Speed Insights without cookies. Listings, install counts, and audit results are **public** and “also available through the public API.”

Authenticated `/api/v1` usage **logs Vercel team/project/environment**.

### 9.3 robots.txt

`Disallow: /api/` and `Disallow: /search`. A product crawler that scrapes HTML search or hammers undocumented `/api/search` is contrary to robots. The documented API is the intended integration path.

### 9.4 CLI license

[vercel-labs/skills LICENSE](https://github.com/vercel-labs/skills/blob/main/LICENSE): **MIT**, Copyright (c) 2026 Vercel, Inc. NEOS Work may depend on or vendor the CLI under MIT terms (copyright notice required).

### 9.5 Skill file licenses (per author)

skills.sh **does not relicense** skill bodies. Embedding **SKILL.md contents** (or `/api/download` snapshots) in NEOS Work is a **per-skill / per-repo license** problem.

Examples:

| Skill | Repo license / frontmatter |
| --- | --- |
| find-skills | CLI repo MIT (Vercel, 2026) |
| vercel-react-best-practices | frontmatter `license: MIT`; **no LICENSE file at agent-skills repo root** on 2026-09-18 (README historically says MIT — verify before shipping) |
| frontend-design | frontmatter `license: Complete terms in LICENSE.txt`; file is **Apache-2.0** |

Many community skills have no license. Those cannot be safely redistributed.

### 9.6 Practical NEOS Work guidance (not legal advice)

**Safer**

- Use **authenticated `/api/v1`** if NEOS Work (or a Vercel-hosted companion) can present a Vercel OIDC token.
- Cache listing metadata (`id`, `name`, `source`, `installs`, `url`, `installUrl`, audit summaries) as terms explicitly allow.
- Deep-link to `https://www.skills.sh/{id}` and/or the source repo.
- Install by **shelling out to `npx skills add`** (or implementing the same git/well-known fetch) so users get upstream licenses and hashes.
- Respect rate limits; back off on 429.
- Honor takedowns / `isDuplicate`.
- Show “third-party, review before install” like skills.sh does.

**Riskier / avoid**

- Scraping the HTML leaderboard or `/search` as a catalog substitute (`robots.txt` + ToS anti-abuse).
- Bulk-mirroring all `/api/download` snapshots into NEOS Work as a first-party catalog (relicense + stale snapshot + malware risk).
- Presenting skills.sh content as NEOS-owned.
- Assuming “Official” = legally cleared for redistribution.

**Open questions (not verified)**

- Whether Vercel’s corporate ToS at vercel.com impose extra restrictions beyond skills.sh/terms.
- Whether unauthenticated `/api/search` and `/api/download` are intentionally public or leftover internals.
- Current live `pagination.total` (requires OIDC).
- Hidden/redirected skill manifest format claimed on the contact page.

---

## 10. Concrete examples

### Example A — `find-skills` (directory meta-skill)

| Field | Value |
| --- | --- |
| **ID** | `vercel-labs/skills/find-skills` |
| **Slug / name** | `find-skills` |
| **Source** | `vercel-labs/skills` (`sourceType: github`) |
| **Website** | https://www.skills.sh/vercel-labs/skills/find-skills |
| **Repo** | https://github.com/vercel-labs/skills |
| **SKILL.md** | https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md |
| **Install (site)** | `npx skills add https://github.com/vercel-labs/skills --skill find-skills` |
| **Install (shorthand)** | `npx skills add vercel-labs/skills --skill find-skills` |
| **Snapshot** | `GET /api/download/vercel-labs/skills/find-skills` → 1 file, hash `b146008599c31057cef1c145774cea5d5afb30e8f43fa802e47a4b461419aaaf` |
| **Installs** | ~3.4M–3.5M (homepage / badge, 2026-09-18) |
| **First seen** | Jan 26, 2026 (detail page) |
| **Topic** | Agent workflows |
| **License** | MIT (CLI repo) |
| **Frontmatter** | `name: find-skills`; description starts “Helps users discover and install agent skills…” |

### Example B — `vercel-react-best-practices`

| Field | Value |
| --- | --- |
| **ID** | `vercel-labs/agent-skills/vercel-react-best-practices` |
| **Slug / name** | `vercel-react-best-practices` |
| **Source** | `vercel-labs/agent-skills` |
| **Website** | https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices |
| **Repo** | https://github.com/vercel-labs/agent-skills |
| **SKILL.md on disk** | `skills/react-best-practices/SKILL.md` (**directory ≠ slug**) |
| **Raw** | https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md |
| **Install (site)** | `npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices` |
| **Install (repo)** | `npx skills add vercel-labs/agent-skills` |
| **Snapshot** | `/api/download/vercel-labs/agent-skills/vercel-react-best-practices` → **76 files**, hash `ca7b0c0c6e5f2750043f7f0cd72d16ac4e2abc48f9b5500d047a4b77a2506212` |
| **Installs** | ~723K (2026-09-18) |
| **First seen** | Jan 19, 2026 |
| **Frontmatter** | `name: vercel-react-best-practices`; `license: MIT`; `metadata.author: vercel`; `metadata.version: "1.0.0"` |
| **Repo grouping** | `skills.sh.json` → group “React” |

This is the important identity lesson: **GitHub folder `react-best-practices` vs frontmatter/slug `vercel-react-best-practices`.** skills.sh IDs follow the **name/slug**, not the folder.

### Example C — `frontend-design` (Anthropic)

| Field | Value |
| --- | --- |
| **ID** | `anthropics/skills/frontend-design` |
| **Website** | https://www.skills.sh/anthropics/skills/frontend-design |
| **Repo** | https://github.com/anthropics/skills |
| **SKILL.md** | https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md |
| **Install (site)** | `npx skills add https://github.com/anthropics/skills --skill frontend-design` |
| **Installs** | ~895K–897K (2026-09-18) |
| **First seen** | Jan 19, 2026 |
| **Topic** | Design & UI |
| **Stars** | ~176.7K (detail page) |
| **License** | Apache-2.0 via `skills/frontend-design/LICENSE.txt`; frontmatter `license: Complete terms in LICENSE.txt` |

### Example D — well-known `lark-doc` (not GitHub)

| Field | Value |
| --- | --- |
| **Website** | https://www.skills.sh/site/open.feishu.cn/lark-doc |
| **Source** | `open.feishu.cn` |
| **Install** | `npx skills add https://open.feishu.cn/lark-cli/skills/regular` |
| **Discovery index** | https://open.feishu.cn/.well-known/skills/index.json (28 skills, 2026-09-18) |
| **Installs** | ~705K |
| **Audits** | Pending / `not_found` on v1 audit API |
| **First seen** | Apr 14, 2026 |

---

## Appendix A — Live URL inventory (2026-09-18)

### Confirmed HTML

`/`, `/hot`, `/trending`, `/picks`, `/official`, `/audits`, `/packs`, `/search`, `/topic`, `/topic/{react,nextjs,design,mobile,agent-workflows,databases,testing,marketing}`, `/agent`, `/agent/{claude-code,cursor,codex,...}`, `/package/{npm,go,cargo,pip}`, `/docs`, `/docs/cli`, `/docs/api`, `/docs/faq`, `/docs/packs`, `/docs/customize`, `/about`, `/contact`, `/privacy`, `/terms`, `/[owner]`, `/[owner]/[repo]`, `/[owner]/[repo]/[skill]`, `/[owner]/[repo]/[skill]/security/[provider]`, `/site/[domain]`, `/site/[domain]/[skill]`

### Confirmed JSON / assets

- `GET /api/v1/skills` and most v1 routes → 401 JSON without OIDC
- `GET /api/v1/skills/audit/{id}` → 200 JSON **without** OIDC (observed)
- `GET /api/search?q=` → 200 JSON without OIDC
- `GET /api/download/{owner}/{repo}/{skill}` → 200 JSON without OIDC
- `GET /api/packs` → JSON, requires Vercel sign-in
- `GET /schemas/skills.sh.schema.json` → JSON Schema
- `GET /b/{owner}/{repo}` → SVG
- `GET https://add-skill.vercel.sh/t` → telemetry ingest
- `GET https://add-skill.vercel.sh/audit?source=&skills=` → partner audit JSON

### Confirmed missing

`/api`, `/api/v1` index, `/openapi.json`, `/llms.txt`, `/.well-known/skills/index.json` on skills.sh itself, `/docs/specification`

---

## Appendix B — `skills.sh.json` schema (verbatim summary)

Source: [https://www.skills.sh/schemas/skills.sh.schema.json](https://www.skills.sh/schemas/skills.sh.schema.json)

- `$id`: `https://skills.sh/schemas/skills.sh.schema.json`
- additionalProperties: false
- required: `groupings`
- `notGrouped`: `"top"` \| `"bottom"` (default bottom)
- `groupings[]`: 1–50 items; each requires `title` (1–120) and `skills` (1–500 strings, 1–120 chars); optional `description` (≤500)

This file customizes **repo pages only**.

---

## Appendix C — What could not be verified

1. Live authenticated `GET /api/v1/skills` `pagination.total` (catalog size).
2. Public source repository for the skills.sh **website / ingestion pipeline** (About claims it is open source).
3. Hidden/redirected skill **manifest format** claimed on the contact page.
4. Whether skills that “fail every partner audit” are actually excluded.
5. Whether `/api/search` and `/api/download` are stable public contracts or internal leftovers.
6. Mintlify well-known index (404 at fetch time).
7. Per-agent install breakdowns mentioned on About (“agents the skill is most-used on”) — not visible in the fetched skill-page text extract; may be client-rendered.
8. Vercel corporate ToS beyond skills.sh/terms.
9. Third-party “630k skills” figures.

---

## Appendix D — Implications for NEOS Work (product, not legal)

If NEOS Work wants a “browse skills.sh” surface:

1. **Identity:** store `id = source/slug`, plus `installUrl`, `sourceType`, and `hash` when a snapshot exists. Do not key only on `name` (collisions are common: many `frontend-design` / `react-best-practices` rows).
2. **Install:** prefer `npx skills add {installUrl} --skill {slug}` so NEOS Work stays compatible with GitHub, well-known, and packs.
3. **Local layout:** CLI already writes `.grok/skills/` for the `grok` agent. That is the native install target if NEOS Work is registered as / compatible with Grok Build.
4. **Catalog sync:** official path is OIDC `/api/v1` + cache. Sitemap (20k) is an incomplete SEO slice. Legacy `/api/search` is what `skills find` uses today.
5. **Trust:** surface partner audits (`/api/v1/skills/audit/{id}` or `add-skill.vercel.sh/audit`) and never treat install count as safety.
6. **Licensing:** ship metadata + links; fetch skill files at install time from the source repo or snapshot; respect each skill’s license.

End of report.
