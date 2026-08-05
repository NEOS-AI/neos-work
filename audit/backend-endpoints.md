# Backend endpoints inventory

**Total count: 210**

Generated from Hono route registrations in `apps/server/src/routes/*.ts` and `apps/server/src/index.ts`.

**Auth default:** All `/api/*` paths require `Authorization: Bearer <NEOS_AUTH_TOKEN>` unless listed in `isAuthExemptPath` (`apps/server/src/lib/auth-paths.ts`).

**CORS:** Origins include localhost:1420, localhost:5173, tauri://localhost + `NEOS_CORS_ORIGINS`. Allow-Headers: Content-Type, Authorization. Note: `x-neos-session-id` is **not** in allowHeaders (`apps/server/src/index.ts:88-95`).

| # | Method | Path | Path params | Body | Query used | Def |
|---|--------|------|-------------|------|------------|-----|
| 1 | `GET` | `/` | — | none | — | `apps/server/src/index.ts:230` |
| 2 | `GET` | `/api` | — | none | — | `apps/server/src/index.ts:200` |
| 3 | `GET` | `/api/artifacts` | — | none/stream | yes | `apps/server/src/routes/artifacts.ts:31` |
| 4 | `POST` | `/api/artifacts` | — | json | — | `apps/server/src/routes/artifacts.ts:75` |
| 5 | `DELETE` | `/api/artifacts/:id` | id | json | — | `apps/server/src/routes/artifacts.ts:216` |
| 6 | `GET` | `/api/artifacts/:id` | id | none/stream | — | `apps/server/src/routes/artifacts.ts:44` |
| 7 | `PATCH` | `/api/artifacts/:id` | id | json | — | `apps/server/src/routes/artifacts.ts:175` |
| 8 | `PUT` | `/api/artifacts/:id` | id | json | — | `apps/server/src/routes/artifacts.ts:150` |
| 9 | `GET` | `/api/artifacts/:id/preview` | id | json | — | `apps/server/src/routes/artifacts.ts:56` |
| 10 | `POST` | `/api/artifacts/:id/refresh` | id | json | — | `apps/server/src/routes/artifacts.ts:230` |
| 11 | `GET` | `/api/blocks` | — | json | yes | `apps/server/src/routes/blocks.ts:27` |
| 12 | `POST` | `/api/blocks` | — | json | — | `apps/server/src/routes/blocks.ts:45` |
| 13 | `DELETE` | `/api/blocks/:id` | id | maybe | — | `apps/server/src/routes/blocks.ts:212` |
| 14 | `GET` | `/api/blocks/:id` | id | json | — | `apps/server/src/routes/blocks.ts:140` |
| 15 | `PUT` | `/api/blocks/:id` | id | json | — | `apps/server/src/routes/blocks.ts:152` |
| 16 | `GET` | `/api/cli-agents` | — | none/stream | yes | `apps/server/src/routes/cli-agents.ts:49` |
| 17 | `GET` | `/api/cli-agents/catalog` | — | none/stream | yes | `apps/server/src/routes/cli-agents.ts:33` |
| 18 | `GET` | `/api/collab/status` | — | none | — | `apps/server/src/index.ts:180` |
| 19 | `POST` | `/api/connection-test` | — | json | — | `apps/server/src/routes/connection-test.ts:29` |
| 20 | `GET` | `/api/deploy` | — | none/stream | yes | `apps/server/src/routes/deploy.ts:122` |
| 21 | `POST` | `/api/deploy` | — | json | — | `apps/server/src/routes/deploy.ts:212` |
| 22 | `DELETE` | `/api/deploy/:id` | id | json | — | `apps/server/src/routes/deploy.ts:204` |
| 23 | `GET` | `/api/deploy/:id` | id | none/stream | — | `apps/server/src/routes/deploy.ts:140` |
| 24 | `POST` | `/api/deploy/:id/refresh` | id | maybe | — | `apps/server/src/routes/deploy.ts:151` |
| 25 | `POST` | `/api/deploy/check-link` | — | json | yes | `apps/server/src/routes/deploy.ts:107` |
| 26 | `POST` | `/api/deploy/preflight` | — | json | — | `apps/server/src/routes/deploy.ts:54` |
| 27 | `GET` | `/api/design-systems` | — | json | — | `apps/server/src/routes/design-systems.ts:30` |
| 28 | `POST` | `/api/design-systems` | — | json | — | `apps/server/src/routes/design-systems.ts:38` |
| 29 | `DELETE` | `/api/design-systems/:id` | id | json | — | `apps/server/src/routes/design-systems.ts:78` |
| 30 | `GET` | `/api/design-systems/:id` | id | none/stream | — | `apps/server/src/routes/design-systems.ts:70` |
| 31 | `GET` | `/api/design-systems/:id/content` | id | json | — | `apps/server/src/routes/design-systems.ts:86` |
| 32 | `PUT` | `/api/design-systems/:id/content` | id | json | — | `apps/server/src/routes/design-systems.ts:94` |
| 33 | `GET` | `/api/design-systems/:id/tokens` | id | none/stream | — | `apps/server/src/routes/design-systems.ts:126` |
| 34 | `GET` | `/api/domain-packs` | — | none/stream | — | `apps/server/src/routes/domain-packs.ts:31` |
| 35 | `DELETE` | `/api/domain-packs/:id` | id | maybe | — | `apps/server/src/routes/domain-packs.ts:159` |
| 36 | `GET` | `/api/domain-packs/:id` | id | none/stream | — | `apps/server/src/routes/domain-packs.ts:169` |
| 37 | `POST` | `/api/domain-packs/:id/toggle` | id | json | — | `apps/server/src/routes/domain-packs.ts:144` |
| 38 | `POST` | `/api/domain-packs/install` | — | json | — | `apps/server/src/routes/domain-packs.ts:81` |
| 39 | `POST` | `/api/domain-packs/install-zip` | — | maybe | — | `apps/server/src/routes/domain-packs.ts:93` |
| 40 | `POST` | `/api/domain-packs/validate` | — | json | — | `apps/server/src/routes/domain-packs.ts:59` |
| 41 | `GET` | `/api/harness` | — | json | — | `apps/server/src/routes/harness.ts:77` |
| 42 | `POST` | `/api/harness` | — | json | — | `apps/server/src/routes/harness.ts:101` |
| 43 | `DELETE` | `/api/harness/:id` | id | maybe | — | `apps/server/src/routes/harness.ts:246` |
| 44 | `GET` | `/api/harness/:id` | id | json | — | `apps/server/src/routes/harness.ts:88` |
| 45 | `PUT` | `/api/harness/:id` | id | json | — | `apps/server/src/routes/harness.ts:170` |
| 46 | `GET` | `/api/harnesses` | — | json | — | `apps/server/src/routes/harness.ts:77` |
| 47 | `POST` | `/api/harnesses` | — | json | — | `apps/server/src/routes/harness.ts:101` |
| 48 | `DELETE` | `/api/harnesses/:id` | id | maybe | — | `apps/server/src/routes/harness.ts:246` |
| 49 | `GET` | `/api/harnesses/:id` | id | json | — | `apps/server/src/routes/harness.ts:88` |
| 50 | `PUT` | `/api/harnesses/:id` | id | json | — | `apps/server/src/routes/harness.ts:170` |
| 51 | `GET` | `/api/health` | — | none/stream | — | `apps/server/src/routes/health.ts:9` |
| 52 | `GET` | `/api/live-artifacts` | — | json | — | `apps/server/src/routes/live-artifacts.ts:39` |
| 53 | `POST` | `/api/live-artifacts` | — | json | — | `apps/server/src/routes/live-artifacts.ts:81` |
| 54 | `DELETE` | `/api/live-artifacts/:id` | id | json | — | `apps/server/src/routes/live-artifacts.ts:178` |
| 55 | `GET` | `/api/live-artifacts/:id` | id | none/stream | — | `apps/server/src/routes/live-artifacts.ts:112` |
| 56 | `PATCH` | `/api/live-artifacts/:id` | id | json | — | `apps/server/src/routes/live-artifacts.ts:147` |
| 57 | `GET` | `/api/live-artifacts/:id/preview` | id | none/stream | yes | `apps/server/src/routes/live-artifacts.ts:122` |
| 58 | `POST` | `/api/live-artifacts/:id/refresh` | id | json | — | `apps/server/src/routes/live-artifacts.ts:188` |
| 59 | `GET` | `/api/live-artifacts/:id/refreshes` | id | json | yes | `apps/server/src/routes/live-artifacts.ts:135` |
| 60 | `POST` | `/api/live-artifacts/tool-tokens` | — | json | — | `apps/server/src/routes/live-artifacts.ts:50` |
| 61 | `GET` | `/api/marketplace/catalog` | — | none/stream | yes | `apps/server/src/routes/marketplace.ts:50` |
| 62 | `GET` | `/api/marketplace/catalog-url` | — | json | yes | `apps/server/src/routes/marketplace.ts:30` |
| 63 | `PUT` | `/api/marketplace/catalog-url` | — | json | yes | `apps/server/src/routes/marketplace.ts:34` |
| 64 | `POST` | `/api/marketplace/install` | — | maybe | — | `apps/server/src/routes/marketplace.ts:85` |
| 65 | `GET` | `/api/mcp-servers` | — | none/stream | yes | `apps/server/src/routes/mcp.ts:241` |
| 66 | `POST` | `/api/mcp-servers` | — | json | — | `apps/server/src/routes/mcp.ts:368` |
| 67 | `DELETE` | `/api/mcp-servers/:id` | id | json | — | `apps/server/src/routes/mcp.ts:465` |
| 68 | `POST` | `/api/mcp-servers/:id/toggle` | id | json | — | `apps/server/src/routes/mcp.ts:452` |
| 69 | `POST` | `/api/mcp-servers/from-preset` | — | json | — | `apps/server/src/routes/mcp.ts:267` |
| 70 | `DELETE` | `/api/mcp-servers/oauth/:serverId` | serverId | maybe | — | `apps/server/src/routes/mcp.ts:802` |
| 71 | `POST` | `/api/mcp-servers/oauth/:serverId/refresh` | serverId | json | — | `apps/server/src/routes/mcp.ts:720` |
| 72 | `GET` | `/api/mcp-servers/oauth/:serverId/status` | serverId | json | — | `apps/server/src/routes/mcp.ts:708` |
| 73 | `GET` | `/api/mcp-servers/oauth/callback` | — | none/stream | yes | `apps/server/src/routes/mcp.ts:563` |
| 74 | `POST` | `/api/mcp-servers/oauth/start` | — | json | — | `apps/server/src/routes/mcp.ts:483` |
| 75 | `GET` | `/api/mcp-servers/presets` | — | json | yes | `apps/server/src/routes/mcp.ts:247` |
| 76 | `GET` | `/api/mcp-servers/tradingview/cdp-health` | — | json | yes | `apps/server/src/routes/mcp.ts:252` |
| 77 | `GET` | `/api/mcp/install-info` | — | none/stream | yes | `apps/server/src/routes/mcp-expose.ts:80` |
| 78 | `DELETE` | `/api/mcp/install/codex` | — | maybe | — | `apps/server/src/routes/mcp-expose.ts:224` |
| 79 | `POST` | `/api/mcp/install/codex` | — | json | — | `apps/server/src/routes/mcp-expose.ts:162` |
| 80 | `GET` | `/api/mcp/install/codex/status` | — | json | — | `apps/server/src/routes/mcp-expose.ts:151` |
| 81 | `GET` | `/api/mcp/oauth/callback` | — | none | — | `apps/server/src/index.ts:150` |
| 82 | `GET` | `/api/mcp/tools` | — | json | — | `apps/server/src/routes/mcp-expose.ts:139` |
| 83 | `POST` | `/api/media/audio` | — | json | — | `apps/server/src/routes/media.ts:194` |
| 84 | `GET` | `/api/media/config` | — | none/stream | — | `apps/server/src/routes/media.ts:86` |
| 85 | `DELETE` | `/api/media/file/:filename` | filename | maybe | — | `apps/server/src/routes/media.ts:334` |
| 86 | `GET` | `/api/media/file/:filename` | filename | none/stream | — | `apps/server/src/routes/media.ts:242` |
| 87 | `GET` | `/api/media/files` | — | none/stream | yes | `apps/server/src/routes/media.ts:73` |
| 88 | `POST` | `/api/media/generate` | — | json | — | `apps/server/src/routes/media.ts:273` |
| 89 | `POST` | `/api/media/image` | — | json | — | `apps/server/src/routes/media.ts:144` |
| 90 | `GET` | `/api/media/jobs` | — | json | yes | `apps/server/src/routes/media.ts:126` |
| 91 | `GET` | `/api/media/jobs/:id` | id | none/stream | yes | `apps/server/src/routes/media.ts:104` |
| 92 | `GET` | `/api/media/providers` | — | none/stream | — | `apps/server/src/routes/media.ts:94` |
| 93 | `GET` | `/api/memory` | — | json | — | `apps/server/src/routes/memory.ts:50` |
| 94 | `POST` | `/api/memory` | — | json | — | `apps/server/src/routes/memory.ts:60` |
| 95 | `DELETE` | `/api/memory/:id` | id | maybe | — | `apps/server/src/routes/memory.ts:140` |
| 96 | `GET` | `/api/memory/:id` | id | json | — | `apps/server/src/routes/memory.ts:94` |
| 97 | `PUT` | `/api/memory/:id` | id | json | — | `apps/server/src/routes/memory.ts:102` |
| 98 | `PUT` | `/api/memory/:id/toggle` | id | maybe | — | `apps/server/src/routes/memory.ts:148` |
| 99 | `GET` | `/api/memory/export` | — | json | — | `apps/server/src/routes/memory.ts:55` |
| 100 | `GET` | `/api/models` | — | none/stream | — | `apps/server/src/routes/session.ts:898` |
| 101 | `GET` | `/api/plugins` | — | none/stream | — | `apps/server/src/routes/plugins.ts:27` |
| 102 | `GET` | `/api/plugins/:id` | id | json | — | `apps/server/src/routes/plugins.ts:135` |
| 103 | `POST` | `/api/plugins/:id/run` | id | json | — | `apps/server/src/routes/plugins.ts:144` |
| 104 | `POST` | `/api/plugins/:id/run/:runId/resume` | id, runId | json | — | `apps/server/src/routes/plugins.ts:194` |
| 105 | `GET` | `/api/plugins/atoms` | — | json | — | `apps/server/src/routes/plugins.ts:46` |
| 106 | `POST` | `/api/plugins/upgrade-from-skill` | — | json | — | `apps/server/src/routes/plugins.ts:60` |
| 107 | `GET` | `/api/projects` | — | json | — | `apps/server/src/routes/projects.ts:145` |
| 108 | `POST` | `/api/projects` | — | json | — | `apps/server/src/routes/projects.ts:176` |
| 109 | `DELETE` | `/api/projects/:id` | id | maybe | yes | `apps/server/src/routes/projects.ts:372` |
| 110 | `GET` | `/api/projects/:id` | id | none/stream | — | `apps/server/src/routes/projects.ts:296` |
| 111 | `PUT` | `/api/projects/:id` | id | json | — | `apps/server/src/routes/projects.ts:327` |
| 112 | `POST` | `/api/projects/:id/collab/heartbeat` | id | json | — | `apps/server/src/routes/projects.ts:471` |
| 113 | `GET` | `/api/projects/:id/collab/locks` | id | none/stream | — | `apps/server/src/routes/projects.ts:489` |
| 114 | `POST` | `/api/projects/:id/collab/locks` | id | json | — | `apps/server/src/routes/projects.ts:598` |
| 115 | `GET` | `/api/projects/:id/collab/peers` | id | json | — | `apps/server/src/routes/projects.ts:455` |
| 116 | `POST` | `/api/projects/:id/collab/selection` | id | json | — | `apps/server/src/routes/projects.ts:527` |
| 117 | `GET` | `/api/projects/:id/collab/selections` | id | json | — | `apps/server/src/routes/projects.ts:507` |
| 118 | `GET` | `/api/projects/:id/collab/stream` | id | none/stream | yes | `apps/server/src/routes/projects.ts:387` |
| 119 | `GET` | `/api/projects/:id/conversations` | id | json | — | `apps/server/src/routes/projects.ts:969` |
| 120 | `POST` | `/api/projects/:id/conversations` | id | json | — | `apps/server/src/routes/projects.ts:976` |
| 121 | `GET` | `/api/projects/:id/conversations/:conversationId/messages` | id, conversationId | none/stream | — | `apps/server/src/routes/projects.ts:989` |
| 122 | `POST` | `/api/projects/:id/conversations/:conversationId/messages` | id, conversationId | maybe | — | `apps/server/src/routes/projects.ts:997` |
| 123 | `GET` | `/api/projects/:id/events/stream` | id | none/stream | — | `apps/server/src/routes/projects.ts:657` |
| 124 | `GET` | `/api/projects/:id/export.zip` | id | none/stream | — | `apps/server/src/routes/projects.ts:304` |
| 125 | `GET` | `/api/projects/:id/files` | id | none/stream | — | `apps/server/src/routes/projects.ts:700` |
| 126 | `DELETE` | `/api/projects/:id/files/*` | id | json | — | `apps/server/src/routes/projects.ts:798` |
| 127 | `GET` | `/api/projects/:id/files/*` | id | none/stream | — | `apps/server/src/routes/projects.ts:716` |
| 128 | `PUT` | `/api/projects/:id/files/*` | id | maybe | — | `apps/server/src/routes/projects.ts:734` |
| 129 | `POST` | `/api/projects/:id/mkdir` | id | maybe | — | `apps/server/src/routes/projects.ts:830` |
| 130 | `GET` | `/api/projects/:id/preview-comments` | id | none/stream | yes | `apps/server/src/routes/projects.ts:928` |
| 131 | `POST` | `/api/projects/:id/preview-comments` | id | maybe | — | `apps/server/src/routes/projects.ts:936` |
| 132 | `DELETE` | `/api/projects/:id/preview-comments/:commentId` | id, commentId | json | — | `apps/server/src/routes/projects.ts:957` |
| 133 | `GET` | `/api/projects/:id/revisions` | id | none/stream | yes | `apps/server/src/routes/projects.ts:861` |
| 134 | `GET` | `/api/projects/:id/revisions/:revisionId` | id, revisionId | json | — | `apps/server/src/routes/projects.ts:869` |
| 135 | `POST` | `/api/projects/:id/revisions/:revisionId/restore` | id, revisionId | json | — | `apps/server/src/routes/projects.ts:879` |
| 136 | `POST` | `/api/projects/import-token` | — | json | — | `apps/server/src/routes/projects.ts:153` |
| 137 | `POST` | `/api/projects/import.zip` | — | maybe | — | `apps/server/src/routes/projects.ts:221` |
| 138 | `GET` | `/api/routines` | — | json | — | `apps/server/src/routes/routines.ts:44` |
| 139 | `POST` | `/api/routines` | — | json | — | `apps/server/src/routes/routines.ts:56` |
| 140 | `DELETE` | `/api/routines/:id` | id | maybe | — | `apps/server/src/routes/routines.ts:192` |
| 141 | `GET` | `/api/routines/:id` | id | json | — | `apps/server/src/routes/routines.ts:48` |
| 142 | `PUT` | `/api/routines/:id` | id | json | — | `apps/server/src/routes/routines.ts:129` |
| 143 | `POST` | `/api/routines/:id/run` | id | maybe | yes | `apps/server/src/routes/routines.ts:201` |
| 144 | `GET` | `/api/routines/:id/runs` | id | none/stream | yes | `apps/server/src/routes/routines.ts:214` |
| 145 | `POST` | `/api/routines/:id/runs/:runId/crystallize` | id, runId | json | — | `apps/server/src/routes/routines.ts:228` |
| 146 | `GET` | `/api/runs` | — | json | yes | `apps/server/src/routes/runs.ts:208` |
| 147 | `POST` | `/api/runs` | — | json | — | `apps/server/src/routes/runs.ts:215` |
| 148 | `GET` | `/api/runs/:id` | id | none/stream | yes | `apps/server/src/routes/runs.ts:355` |
| 149 | `POST` | `/api/runs/:id/cancel` | id | maybe | — | `apps/server/src/routes/runs.ts:412` |
| 150 | `GET` | `/api/runs/:id/events` | id | none/stream | yes | `apps/server/src/routes/runs.ts:363` |
| 151 | `GET` | `/api/runs/:id/events/stream` | id | none/stream | — | `apps/server/src/routes/runs.ts:374` |
| 152 | `GET` | `/api/session` | — | json | yes | `apps/server/src/routes/session.ts:166` |
| 153 | `POST` | `/api/session` | — | json | — | `apps/server/src/routes/session.ts:176` |
| 154 | `DELETE` | `/api/session/:id` | id | maybe | — | `apps/server/src/routes/session.ts:253` |
| 155 | `GET` | `/api/session/:id` | id | none/stream | — | `apps/server/src/routes/session.ts:245` |
| 156 | `POST` | `/api/session/:id/agent` | id | json | — | `apps/server/src/routes/session.ts:571` |
| 157 | `POST` | `/api/session/:id/cancel` | id | json | — | `apps/server/src/routes/session.ts:44` |
| 158 | `POST` | `/api/session/:id/chat` | id | json | — | `apps/server/src/routes/session.ts:274` |
| 159 | `GET` | `/api/session/:id/messages` | id | json | — | `apps/server/src/routes/session.ts:263` |
| 160 | `POST` | `/api/session/:id/tool-confirm/:toolUseId` | id, toolUseId | json | — | `apps/server/src/routes/session.ts:63` |
| 161 | `GET` | `/api/settings` | — | none/stream | — | `apps/server/src/routes/settings.ts:35` |
| 162 | `DELETE` | `/api/settings/:key` | key | json | — | `apps/server/src/routes/settings.ts:98` |
| 163 | `GET` | `/api/settings/:key` | key | json | — | `apps/server/src/routes/settings.ts:45` |
| 164 | `PUT` | `/api/settings/:key` | key | json | — | `apps/server/src/routes/settings.ts:56` |
| 165 | `POST` | `/api/settings/verify-key` | — | json | — | `apps/server/src/routes/settings.ts:107` |
| 166 | `GET` | `/api/skills` | — | none/stream | — | `apps/server/src/routes/skills.ts:186` |
| 167 | `DELETE` | `/api/skills/:id` | id | maybe | — | `apps/server/src/routes/skills.ts:289` |
| 168 | `POST` | `/api/skills/:id/toggle` | id | json | — | `apps/server/src/routes/skills.ts:276` |
| 169 | `POST` | `/api/skills/scan` | — | maybe | — | `apps/server/src/routes/skills.ts:233` |
| 170 | `GET` | `/api/templates` | — | none/stream | yes | `apps/server/src/routes/templates.ts:357` |
| 171 | `POST` | `/api/tools/live-artifacts/create` | — | json | — | `apps/server/src/routes/tools-live-artifacts.ts:54` |
| 172 | `GET` | `/api/tools/live-artifacts/list` | — | json | yes | `apps/server/src/routes/tools-live-artifacts.ts:85` |
| 173 | `POST` | `/api/tools/live-artifacts/refresh` | — | json | — | `apps/server/src/routes/tools-live-artifacts.ts:132` |
| 174 | `POST` | `/api/tools/live-artifacts/update` | — | json | — | `apps/server/src/routes/tools-live-artifacts.ts:100` |
| 175 | `POST` | `/api/webhook/:workflowId` | workflowId | maybe | — | `apps/server/src/routes/webhooks.ts:75` |
| 176 | `GET` | `/api/webhook/:workflowId/rate-limit` | workflowId | none/stream | — | `apps/server/src/routes/webhooks.ts:55` |
| 177 | `POST` | `/api/webhook/:workflowId/regenerate` | workflowId | maybe | — | `apps/server/src/routes/webhooks.ts:64` |
| 178 | `GET` | `/api/webhook/:workflowId/secret` | workflowId | none/stream | — | `apps/server/src/routes/webhooks.ts:38` |
| 179 | `GET` | `/api/workers` | — | json | yes | `apps/server/src/routes/workers.ts:110` |
| 180 | `POST` | `/api/workers` | — | json | — | `apps/server/src/routes/workers.ts:132` |
| 181 | `DELETE` | `/api/workers/:id` | id | maybe | — | `apps/server/src/routes/workers.ts:274` |
| 182 | `GET` | `/api/workers/:id` | id | json | — | `apps/server/src/routes/workers.ts:119` |
| 183 | `PUT` | `/api/workers/:id` | id | json | — | `apps/server/src/routes/workers.ts:197` |
| 184 | `GET` | `/api/workflow` | — | json | — | `apps/server/src/routes/workflow.ts:73` |
| 185 | `POST` | `/api/workflow` | — | json | — | `apps/server/src/routes/workflow.ts:85` |
| 186 | `GET` | `/api/workflow-revisions/:workflowId` | workflowId | none/stream | — | `apps/server/src/routes/workflow-revisions.ts:33` |
| 187 | `DELETE` | `/api/workflow-revisions/:workflowId/:id` | workflowId, id | maybe | — | `apps/server/src/routes/workflow-revisions.ts:161` |
| 188 | `GET` | `/api/workflow-revisions/:workflowId/:id` | workflowId, id | none/stream | — | `apps/server/src/routes/workflow-revisions.ts:41` |
| 189 | `PATCH` | `/api/workflow-revisions/:workflowId/:id` | workflowId, id | json | — | `apps/server/src/routes/workflow-revisions.ts:142` |
| 190 | `POST` | `/api/workflow-revisions/:workflowId/:id/restore` | workflowId, id | maybe | — | `apps/server/src/routes/workflow-revisions.ts:55` |
| 191 | `DELETE` | `/api/workflow/:id` | id | json | — | `apps/server/src/routes/workflow.ts:229` |
| 192 | `GET` | `/api/workflow/:id` | id | json | — | `apps/server/src/routes/workflow.ts:77` |
| 193 | `PUT` | `/api/workflow/:id` | id | json | — | `apps/server/src/routes/workflow.ts:141` |
| 194 | `POST` | `/api/workflow/:id/duplicate` | id | maybe | — | `apps/server/src/routes/workflow.ts:378` |
| 195 | `GET` | `/api/workflow/:id/export` | id | none/stream | — | `apps/server/src/routes/workflow.ts:386` |
| 196 | `GET` | `/api/workflow/:id/export.zip` | id | none/stream | — | `apps/server/src/routes/workflow.ts:402` |
| 197 | `POST` | `/api/workflow/:id/preflight` | id | maybe | — | `apps/server/src/routes/workflow.ts:866` |
| 198 | `POST` | `/api/workflow/:id/run` | id | json | — | `apps/server/src/routes/workflow.ts:886` |
| 199 | `DELETE` | `/api/workflow/:id/runs` | id | maybe | yes | `apps/server/src/routes/workflow.ts:822` |
| 200 | `GET` | `/api/workflow/:id/runs` | id | none/stream | yes | `apps/server/src/routes/workflow.ts:812` |
| 201 | `DELETE` | `/api/workflow/:id/runs/:runId` | id, runId | maybe | — | `apps/server/src/routes/workflow.ts:840` |
| 202 | `GET` | `/api/workflow/:id/runs/:runId` | id, runId | none/stream | — | `apps/server/src/routes/workflow.ts:851` |
| 203 | `POST` | `/api/workflow/import` | — | json | — | `apps/server/src/routes/workflow.ts:239` |
| 204 | `POST` | `/api/workflow/import.zip` | — | maybe | — | `apps/server/src/routes/workflow.ts:639` |
| 205 | `POST` | `/api/workflow/import/claude-design` | — | maybe | yes | `apps/server/src/routes/workflow.ts:793` |
| 206 | `POST` | `/api/workflow/migrate` | — | json | — | `apps/server/src/routes/workflow.ts:319` |
| 207 | `GET` | `/api/workspace` | — | json | — | `apps/server/src/routes/session.ts:804` |
| 208 | `POST` | `/api/workspace` | — | json | — | `apps/server/src/routes/session.ts:809` |
| 209 | `DELETE` | `/api/workspace/:id` | id | maybe | — | `apps/server/src/routes/session.ts:885` |
| 210 | `PUT` | `/api/workspace/:id` | id | json | — | `apps/server/src/routes/session.ts:853` |

## Notes
- Response schema is generally `{ ok: boolean, data?: T, error?: string }` unless binary/SSE/HTML.
- SSE endpoints: project collab/stream, project events/stream, run events/stream, session chat streams.
- Duplicate mounts: `/api/harness` and `/api/harnesses` share the same handler (deprecation alias).
