# Routes inventory

**Total routes: 25**

| # | Surface | Path | Page component | Declared | Reachability |
|---|---------|------|----------------|----------|--------------|
| 1 | web | `/` | `Connect` | `apps/web/src/App.tsx:11` | Entry; also Navigate from `*` and Settings logout |
| 2 | web | `/projects` | `Projects` | `apps/web/src/App.tsx:12` | After Connect success (`Connect.tsx` navigate); ProjectDetail back links |
| 3 | web | `/projects/:id` | `ProjectDetail` | `apps/web/src/App.tsx:13` | From Projects list click (programmatic) |
| 4 | web | `/settings` | `Settings` | `apps/web/src/App.tsx:14` | Linked from web chrome / Projects |
| 5 | web | `*` | `Navigate` | `apps/web/src/App.tsx:15` | catch-all → `/` |
| 6 | desktop | `/` | `Dashboard` | `apps/desktop/src/App.tsx:45` | `Sidebar.tsx` nav |
| 7 | desktop | `/sessions` | `Sessions` | `apps/desktop/src/App.tsx:46` | `Sidebar.tsx` nav |
| 8 | desktop | `/workflows` | `Workflows` | `apps/desktop/src/App.tsx:47` | `Sidebar.tsx` nav, `apps/desktop/src/pages/WorkflowEditor.tsx:721`, `apps/desktop/src/pages/WorkflowEditor.tsx:740` |
| 9 | desktop | `/workflows/:id` | `WorkflowEditor` | `apps/desktop/src/App.tsx:48` | **no static link** (router-only / programmatic) |
| 10 | desktop | `/projects` | `Projects` | `apps/desktop/src/App.tsx:49` | `Sidebar.tsx` nav, `apps/desktop/src/pages/ProjectWorkspace.tsx:1264` |
| 11 | desktop | `/projects/:id` | `ProjectWorkspace` | `apps/desktop/src/App.tsx:50` | **no static link** (router-only / programmatic) |
| 12 | desktop | `/harnesses` | `Harnesses` | `apps/desktop/src/App.tsx:51` | `Sidebar.tsx` nav |
| 13 | desktop | `/domain-packs` | `DomainPacks` | `apps/desktop/src/App.tsx:52` | `Sidebar.tsx` nav |
| 14 | desktop | `/blocks` | `Blocks` | `apps/desktop/src/App.tsx:53` | `Sidebar.tsx` nav |
| 15 | desktop | `/templates` | `Templates` | `apps/desktop/src/App.tsx:54` | `Sidebar.tsx` nav, `apps/desktop/src/pages/Workflows.tsx:425` |
| 16 | desktop | `/skills` | `Skills` | `apps/desktop/src/App.tsx:55` | `Sidebar.tsx` nav |
| 17 | desktop | `/memory` | `Memory` | `apps/desktop/src/App.tsx:56` | `Sidebar.tsx` nav |
| 18 | desktop | `/settings` | `Settings` | `apps/desktop/src/App.tsx:57` | `Sidebar.tsx` nav |
| 19 | desktop | `/design-systems` | `DesignSystems` | `apps/desktop/src/App.tsx:58` | `Sidebar.tsx` nav, `apps/desktop/src/pages/DesignSystemEditor.tsx:135`, `apps/desktop/src/pages/DesignSystemEditor.tsx:190` |
| 20 | desktop | `/design-systems/:id` | `DesignSystemEditor` | `apps/desktop/src/App.tsx:59` | **no static link** (router-only / programmatic) |
| 21 | desktop | `/routines` | `Routines` | `apps/desktop/src/App.tsx:60` | `Sidebar.tsx` nav, `apps/desktop/src/pages/WorkflowEditor.tsx:1303` |
| 22 | desktop | `/plugins` | `Plugins` | `apps/desktop/src/App.tsx:61` | `Sidebar.tsx` nav |
| 23 | desktop | `/deployments` | `Deployments` | `apps/desktop/src/App.tsx:62` | `Sidebar.tsx` nav |
| 24 | desktop | `/media` | `Media` | `apps/desktop/src/App.tsx:63` | `Sidebar.tsx` nav |
| 25 | desktop | `(gate)` | `ModeSelection` | `apps/desktop/src/App.tsx:72` | shown when engine disconnected (`App.tsx:72-74`) |
