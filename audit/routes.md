# Routes inventory

**Total app routes: 24** (web 5 + desktop 19)

## Web — `apps/web/src/App.tsx` (**5**)

| Path | Element | Reachable | Def |
|------|---------|-----------|-----|
| `/` | `Connect` | entry + Sign out / Connection links | `apps/web/src/App.tsx:11` |
| `/projects` | `Projects` | Connect success + Links | `apps/web/src/App.tsx:12` |
| `/projects/:id` | `ProjectDetail` | Projects list Link | `apps/web/src/App.tsx:13` |
| `/settings` | `Settings` | Projects header Link | `apps/web/src/App.tsx:14` |
| `*` | `Navigate` | catch-all → / | `apps/web/src/App.tsx:15` |

## Desktop — `createBrowserRouter` in `apps/desktop/src/App.tsx` (**19**)

Routes only mount when engine is connected (`apps/desktop/src/App.tsx:68-76`). Otherwise `ModeSelection` is shown (not a router path).

| Path | Element | Sidebar? | Def |
|------|---------|----------|-----|
| `/` | `Dashboard` | yes | `apps/desktop/src/App.tsx:45` |
| `/sessions` | `Sessions` | yes | `apps/desktop/src/App.tsx:46` |
| `/workflows` | `Workflows` | yes | `apps/desktop/src/App.tsx:47` |
| `/workflows/:id` | `WorkflowEditor` | detail/deep | `apps/desktop/src/App.tsx:48` |
| `/projects` | `Projects` | yes | `apps/desktop/src/App.tsx:49` |
| `/projects/:id` | `ProjectWorkspace` | detail/deep | `apps/desktop/src/App.tsx:50` |
| `/harnesses` | `Harnesses` | yes | `apps/desktop/src/App.tsx:51` |
| `/domain-packs` | `DomainPacks` | yes | `apps/desktop/src/App.tsx:52` |
| `/blocks` | `Blocks` | yes | `apps/desktop/src/App.tsx:53` |
| `/templates` | `Templates` | yes | `apps/desktop/src/App.tsx:54` |
| `/skills` | `Skills` | yes | `apps/desktop/src/App.tsx:55` |
| `/memory` | `Memory` | yes | `apps/desktop/src/App.tsx:56` |
| `/settings` | `Settings` | yes | `apps/desktop/src/App.tsx:57` |
| `/design-systems` | `DesignSystems` | yes | `apps/desktop/src/App.tsx:58` |
| `/design-systems/:id` | `DesignSystemEditor` | detail/deep | `apps/desktop/src/App.tsx:59` |
| `/routines` | `Routines` | yes | `apps/desktop/src/App.tsx:60` |
| `/plugins` | `Plugins` | yes | `apps/desktop/src/App.tsx:61` |
| `/deployments` | `Deployments` | yes | `apps/desktop/src/App.tsx:62` |
| `/media` | `Media` | yes | `apps/desktop/src/App.tsx:63` |

### Sidebar NAV_ITEMS (`apps/desktop/src/components/Sidebar.tsx:8-25`)

- `/`
- `/sessions`
- `/workflows`
- `/projects`
- `/harnesses`
- `/domain-packs`
- `/blocks`
- `/templates`
- `/skills`
- `/memory`
- `/design-systems`
- `/routines`
- `/plugins`
- `/deployments`
- `/media`
- `/settings`

### Link/navigate targets in source (**15**)

- `/blocks`
- `/deployments`
- `/design-systems`
- `/design-systems/:param`
- `/media`
- `/plugins`
- `/projects`
- `/projects/:param`
- `/routines`
- `/sessions`
- `/settings`
- `/skills`
- `/templates`
- `/workflows`
- `/workflows/:param`

### Reachability summary

- All desktop NAV_ITEMS paths have matching routes. **confirmed**
- Detail routes (`/workflows/:id`, `/projects/:id`, `/design-systems/:id`) reached from list pages via Link/navigate. **confirmed** via link scan
- `ModeSelection` is not a registered route; it is a gate component. Deep-link while disconnected cannot mount target route until connect. Evidence: `App.tsx:68-76`.
