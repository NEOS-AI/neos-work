# Frontend HTTP/SSE call inventory

**Total call sites: 220** (web=24, desktop=170, cli=26)

Primary clients: web `apps/web/src/lib/api.ts`, desktop `apps/desktop/src/lib/engine.ts`, cli `apps/cli/src/client.ts`.

| # | Surface | Method | URL | Kind | Site |
|---|---------|--------|-----|------|------|
| 1 | cli | `GET` | `/api/cli-agents` | request | `apps/cli/src/client.ts:317` |
| 2 | cli | `GET` | `/api/deploy` | request | `apps/cli/src/client.ts:223` |
| 3 | cli | `GET` | `/api/design-systems` | request | `apps/cli/src/client.ts:237` |
| 4 | cli | `GET` | `/api/live-artifacts` | request | `apps/cli/src/client.ts:270` |
| 5 | cli | `POST` | `/api/live-artifacts` | request | `apps/cli/src/client.ts:281` |
| 6 | cli | `POST` | `/api/live-artifacts/${encodeURIComponent(artifactId)}/refresh` | request | `apps/cli/src/client.ts:288` |
| 7 | cli | `GET` | `/api/mcp-servers` | request | `apps/cli/src/client.ts:254` |
| 8 | cli | `GET` | `/api/mcp/install-info` | request | `apps/cli/src/client.ts:261` |
| 9 | cli | `GET` | `/api/media/config` | request | `apps/cli/src/client.ts:313` |
| 10 | cli | `GET` | `/api/media/files` | request | `apps/cli/src/client.ts:215` |
| 11 | cli | `POST` | `/api/media/generate` | request | `apps/cli/src/client.ts:309` |
| 12 | cli | `GET` | `/api/memory` | request | `apps/cli/src/client.ts:241` |
| 13 | cli | `POST` | `/api/memory` | request | `apps/cli/src/client.ts:250` |
| 14 | cli | `GET` | `/api/plugins` | request | `apps/cli/src/client.ts:219` |
| 15 | cli | `GET` | `/api/plugins/atoms` | request | `apps/cli/src/client.ts:296` |
| 16 | cli | `GET` | `/api/projects` | request | `apps/cli/src/client.ts:165` |
| 17 | cli | `POST` | `/api/projects` | request | `apps/cli/src/client.ts:169` |
| 18 | cli | `GET` | `/api/projects/${encodeURIComponent(id)}` | request | `apps/cli/src/client.ts:173` |
| 19 | cli | `GET` | `/api/projects/${encodeURIComponent(projectId)}/files` | request | `apps/cli/src/client.ts:177` |
| 20 | cli | `GET` | `/api/projects/${encodeURIComponent(projectId)}/files/${segs}` | request | `apps/cli/src/client.ts:182` |
| 21 | cli | `PUT` | `/api/projects/${encodeURIComponent(projectId)}/files/${segs}` | request | `apps/cli/src/client.ts:191` |
| 22 | cli | `POST` | `/api/runs` | request | `apps/cli/src/client.ts:203` |
| 23 | cli | `GET` | `/api/runs/${encodeURIComponent(id)}` | request | `apps/cli/src/client.ts:207` |
| 24 | cli | `POST` | `/api/runs/${encodeURIComponent(id)}/cancel` | request | `apps/cli/src/client.ts:211` |
| 25 | cli | `GET` | `/api/skills` | request | `apps/cli/src/client.ts:229` |
| 26 | cli | `POST` | `/api/skills/scan` | request | `apps/cli/src/client.ts:233` |
| 27 | desktop | `GET` | `/api/artifacts?runId=${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2320` |
| 28 | desktop | `GET` | `/api/artifacts?workflowId=${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2326` |
| 29 | desktop | `DELETE` | `/api/artifacts/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2358` |
| 30 | desktop | `GET` | `/api/artifacts/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2337` |
| 31 | desktop | `PATCH` | `/api/artifacts/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2371` |
| 32 | desktop | `POST` | `/api/artifacts/${seg}/refresh` | fetch | `apps/desktop/src/lib/engine.ts:2347` |
| 33 | desktop | `POST` | `/api/blocks` | fetch | `apps/desktop/src/lib/engine.ts:3532` |
| 34 | desktop | `DELETE` | `/api/blocks/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3554` |
| 35 | desktop | `PUT` | `/api/blocks/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3543` |
| 36 | desktop | `GET` | `/api/cli-agents` | fetch | `apps/desktop/src/lib/engine.ts:1115` |
| 37 | desktop | `GET` | `/api/collab/status` | fetch | `apps/desktop/src/lib/engine.ts:1641` |
| 38 | desktop | `POST` | `/api/connection-test` | fetch | `apps/desktop/src/lib/engine.ts:2720` |
| 39 | desktop | `DELETE` | `/api/deploy/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3363` |
| 40 | desktop | `GET` | `/api/deploy/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3354` |
| 41 | desktop | `POST` | `/api/deploy/${seg}/refresh` | fetch | `apps/desktop/src/lib/engine.ts:2614` |
| 42 | desktop | `POST` | `/api/deploy/check-link` | fetch | `apps/desktop/src/lib/engine.ts:2695` |
| 43 | desktop | `POST` | `/api/deploy/preflight` | fetch | `apps/desktop/src/lib/engine.ts:2672` |
| 44 | desktop | `GET` | `/api/deploy${qs ? ` | fetch | `apps/desktop/src/lib/engine.ts:3345` |
| 45 | desktop | `GET` | `/api/design-systems` | fetch | `apps/desktop/src/lib/engine.ts:2264` |
| 46 | desktop | `POST` | `/api/design-systems` | fetch | `apps/desktop/src/lib/engine.ts:2269` |
| 47 | desktop | `DELETE` | `/api/design-systems/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2280` |
| 48 | desktop | `GET` | `/api/design-systems/${seg}/content` | fetch | `apps/desktop/src/lib/engine.ts:2290` |
| 49 | desktop | `PUT` | `/api/design-systems/${seg}/content` | fetch | `apps/desktop/src/lib/engine.ts:2306` |
| 50 | desktop | `GET` | `/api/design-systems/${seg}/tokens` | fetch | `apps/desktop/src/lib/engine.ts:2297` |
| 51 | desktop | `GET` | `/api/domain-packs` | fetch | `apps/desktop/src/lib/engine.ts:3399` |
| 52 | desktop | `DELETE` | `/api/domain-packs/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3452` |
| 53 | desktop | `GET` | `/api/domain-packs/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3408` |
| 54 | desktop | `POST` | `/api/domain-packs/${seg}/toggle` | fetch | `apps/desktop/src/lib/engine.ts:3441` |
| 55 | desktop | `POST` | `/api/domain-packs/install` | fetch | `apps/desktop/src/lib/engine.ts:3416` |
| 56 | desktop | `POST` | `/api/domain-packs/validate` | fetch | `apps/desktop/src/lib/engine.ts:3427` |
| 57 | desktop | `GET` | `/api/harness` | fetch | `apps/desktop/src/lib/engine.ts:3500` |
| 58 | desktop | `GET` | `/api/health` | fetch | `apps/desktop/src/lib/engine.ts:545` |
| 59 | desktop | `POST` | `/api/live-artifacts` | fetch | `apps/desktop/src/lib/engine.ts:2463` |
| 60 | desktop | `GET` | `/api/live-artifacts?projectId=${encodeURIComponent(seg)}` | fetch | `apps/desktop/src/lib/engine.ts:2444` |
| 61 | desktop | `DELETE` | `/api/live-artifacts/${aid}?projectId=${encodeURIComponent(pid)}` | fetch | `apps/desktop/src/lib/engine.ts:2500` |
| 62 | desktop | `POST` | `/api/live-artifacts/${aid}/refresh?projectId=${encodeURIComponent(pid)}` | fetch | `apps/desktop/src/lib/engine.ts:2485` |
| 63 | desktop | `POST` | `/api/live-artifacts/tool-tokens` | fetch | `apps/desktop/src/lib/engine.ts:2520` |
| 64 | desktop | `GET` | `/api/marketplace/catalog-url` | fetch | `apps/desktop/src/lib/engine.ts:2734` |
| 65 | desktop | `PUT` | `/api/marketplace/catalog-url` | fetch | `apps/desktop/src/lib/engine.ts:2741` |
| 66 | desktop | `GET` | `/api/marketplace/catalog${qs}` | fetch | `apps/desktop/src/lib/engine.ts:2769` |
| 67 | desktop | `POST` | `/api/marketplace/install` | fetch | `apps/desktop/src/lib/engine.ts:2788` |
| 68 | desktop | `GET` | `/api/mcp-servers` | fetch | `apps/desktop/src/lib/engine.ts:906` |
| 69 | desktop | `POST` | `/api/mcp-servers` | fetch | `apps/desktop/src/lib/engine.ts:919` |
| 70 | desktop | `DELETE` | `/api/mcp-servers/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:972` |
| 71 | desktop | `POST` | `/api/mcp-servers/${seg}/toggle` | fetch | `apps/desktop/src/lib/engine.ts:961` |
| 72 | desktop | `POST` | `/api/mcp-servers/from-preset` | fetch | `apps/desktop/src/lib/engine.ts:939` |
| 73 | desktop | `DELETE` | `/api/mcp-servers/oauth/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:1009` |
| 74 | desktop | `POST` | `/api/mcp-servers/oauth/${seg}/refresh` | fetch | `apps/desktop/src/lib/engine.ts:1019` |
| 75 | desktop | `GET` | `/api/mcp-servers/oauth/${seg}/status` | fetch | `apps/desktop/src/lib/engine.ts:1000` |
| 76 | desktop | `POST` | `/api/mcp-servers/oauth/start` | fetch | `apps/desktop/src/lib/engine.ts:989` |
| 77 | desktop | `GET` | `/api/mcp-servers/presets` | fetch | `apps/desktop/src/lib/engine.ts:928` |
| 78 | desktop | `GET` | `/api/mcp-servers/tradingview/cdp-health${q}` | fetch | `apps/desktop/src/lib/engine.ts:952` |
| 79 | desktop | `GET` | `/api/mcp/install-info${q ? ` | fetch | `apps/desktop/src/lib/engine.ts:1054` |
| 80 | desktop | `DELETE` | `/api/mcp/install/codex` | fetch | `apps/desktop/src/lib/engine.ts:1105` |
| 81 | desktop | `POST` | `/api/mcp/install/codex` | fetch | `apps/desktop/src/lib/engine.ts:1096` |
| 82 | desktop | `GET` | `/api/mcp/install/codex/status` | fetch | `apps/desktop/src/lib/engine.ts:1077` |
| 83 | desktop | `GET` | `/api/mcp/tools` | fetch | `apps/desktop/src/lib/engine.ts:1063` |
| 84 | desktop | `GET` | `/api/media/config` | fetch | `apps/desktop/src/lib/engine.ts:2551` |
| 85 | desktop | `DELETE` | `/api/media/file/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2382` |
| 86 | desktop | `GET` | `/api/media/file/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2604` |
| 87 | desktop | `GET` | `/api/media/files?limit=${limit}` | fetch | `apps/desktop/src/lib/engine.ts:2433` |
| 88 | desktop | `GET` | `/api/media/jobs/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2588` |
| 89 | desktop | `GET` | `/api/media/providers` | fetch | `apps/desktop/src/lib/engine.ts:2568` |
| 90 | desktop | `POST` | `/api/memory` | fetch | `apps/desktop/src/lib/engine.ts:3574` |
| 91 | desktop | `POST` | `/api/memory` | fetch | `apps/desktop/src/lib/engine.ts:3579` |
| 92 | desktop | `DELETE` | `/api/memory/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3601` |
| 93 | desktop | `PUT` | `/api/memory/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3590` |
| 94 | desktop | `PUT` | `/api/memory/${seg}/toggle` | fetch | `apps/desktop/src/lib/engine.ts:3611` |
| 95 | desktop | `GET` | `/api/models` | fetch | `apps/desktop/src/lib/engine.ts:847` |
| 96 | desktop | `GET` | `/api/plugins` | fetch | `apps/desktop/src/lib/engine.ts:2799` |
| 97 | desktop | `GET` | `/api/plugins/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2806` |
| 98 | desktop | `POST` | `/api/plugins/${seg}/run` | fetch | `apps/desktop/src/lib/engine.ts:2823` |
| 99 | desktop | `POST` | `/api/plugins/${seg}/run/${runSeg}/resume` | fetch | `apps/desktop/src/lib/engine.ts:2882` |
| 100 | desktop | `POST` | `/api/plugins/upgrade-from-skill` | fetch | `apps/desktop/src/lib/engine.ts:895` |
| 101 | desktop | `GET` | `/api/projects` | fetch | `apps/desktop/src/lib/engine.ts:1142` |
| 102 | desktop | `POST` | `/api/projects` | fetch | `apps/desktop/src/lib/engine.ts:1191` |
| 103 | desktop | `GET` | `/api/projects/${pSeg}/conversations/${cSeg}/messages` | fetch | `apps/desktop/src/lib/engine.ts:2027` |
| 104 | desktop | `POST` | `/api/projects/${pSeg}/conversations/${cSeg}/messages` | fetch | `apps/desktop/src/lib/engine.ts:2058` |
| 105 | desktop | `DELETE` | `/api/projects/${pSeg}/preview-comments/${cSeg}` | fetch | `apps/desktop/src/lib/engine.ts:1981` |
| 106 | desktop | `GET` | `/api/projects/${pSeg}/revisions/${rSeg}` | fetch | `apps/desktop/src/lib/engine.ts:1886` |
| 107 | desktop | `POST` | `/api/projects/${pSeg}/revisions/${rSeg}/restore` | fetch | `apps/desktop/src/lib/engine.ts:1915` |
| 108 | desktop | `DELETE` | `/api/projects/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:1235` |
| 109 | desktop | `GET` | `/api/projects/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:1149` |
| 110 | desktop | `PUT` | `/api/projects/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:1224` |
| 111 | desktop | `POST` | `/api/projects/${seg}/collab/heartbeat` | fetch | `apps/desktop/src/lib/engine.ts:1621` |
| 112 | desktop | `GET` | `/api/projects/${seg}/collab/locks` | fetch | `apps/desktop/src/lib/engine.ts:1582` |
| 113 | desktop | `POST` | `/api/projects/${seg}/collab/locks` | fetch | `apps/desktop/src/lib/engine.ts:1514` |
| 114 | desktop | `GET` | `/api/projects/${seg}/collab/peers` | fetch | `apps/desktop/src/lib/engine.ts:1565` |
| 115 | desktop | `POST` | `/api/projects/${seg}/collab/selection` | fetch | `apps/desktop/src/lib/engine.ts:1661` |
| 116 | desktop | `GET` | `/api/projects/${seg}/collab/selections` | fetch | `apps/desktop/src/lib/engine.ts:1608` |
| 117 | desktop | `GET` | `/api/projects/${seg}/collab/stream${qs}` | fetch | `apps/desktop/src/lib/engine.ts:1372` |
| 118 | desktop | `GET` | `/api/projects/${seg}/conversations` | fetch | `apps/desktop/src/lib/engine.ts:1995` |
| 119 | desktop | `POST` | `/api/projects/${seg}/conversations` | fetch | `apps/desktop/src/lib/engine.ts:2011` |
| 120 | desktop | `GET` | `/api/projects/${seg}/events/stream` | fetch | `apps/desktop/src/lib/engine.ts:1682` |
| 121 | desktop | `GET` | `/api/projects/${seg}/export.zip` | fetch | `apps/desktop/src/lib/engine.ts:1247` |
| 122 | desktop | `GET` | `/api/projects/${seg}/files` | fetch | `apps/desktop/src/lib/engine.ts:1293` |
| 123 | desktop | `DELETE` | `/api/projects/${seg}/files/${pathSeg}` | fetch | `apps/desktop/src/lib/engine.ts:1819` |
| 124 | desktop | `GET` | `/api/projects/${seg}/files/${pathSeg}` | fetch | `apps/desktop/src/lib/engine.ts:1741` |
| 125 | desktop | `PUT` | `/api/projects/${seg}/files/${pathSeg}` | fetch | `apps/desktop/src/lib/engine.ts:1780` |
| 126 | desktop | `POST` | `/api/projects/${seg}/mkdir` | fetch | `apps/desktop/src/lib/engine.ts:1850` |
| 127 | desktop | `POST` | `/api/projects/${seg}/preview-comments` | fetch | `apps/desktop/src/lib/engine.ts:1961` |
| 128 | desktop | `GET` | `/api/projects/${seg}/preview-comments${qs}` | fetch | `apps/desktop/src/lib/engine.ts:1939` |
| 129 | desktop | `GET` | `/api/projects/${seg}/revisions${qs}` | fetch | `apps/desktop/src/lib/engine.ts:1871` |
| 130 | desktop | `POST` | `/api/projects/import-token` | fetch | `apps/desktop/src/lib/engine.ts:1162` |
| 131 | desktop | `POST` | `/api/projects/import.zip` | fetch | `apps/desktop/src/lib/engine.ts:1279` |
| 132 | desktop | `GET` | `/api/routines` | fetch | `apps/desktop/src/lib/engine.ts:2392` |
| 133 | desktop | `POST` | `/api/routines` | fetch | `apps/desktop/src/lib/engine.ts:2413` |
| 134 | desktop | `POST` | `/api/routines/${rseg}/runs/${runSeg}/crystallize` | fetch | `apps/desktop/src/lib/engine.ts:2657` |
| 135 | desktop | `DELETE` | `/api/routines/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2624` |
| 136 | desktop | `GET` | `/api/routines/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2399` |
| 137 | desktop | `PUT` | `/api/routines/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2424` |
| 138 | desktop | `POST` | `/api/routines/${seg}/run` | fetch | `apps/desktop/src/lib/engine.ts:2634` |
| 139 | desktop | `GET` | `/api/routines/${seg}/runs` | fetch | `apps/desktop/src/lib/engine.ts:2644` |
| 140 | desktop | `POST` | `/api/runs` | fetch | `apps/desktop/src/lib/engine.ts:2132` |
| 141 | desktop | `GET` | `/api/runs/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2143` |
| 142 | desktop | `POST` | `/api/runs/${seg}/cancel` | fetch | `apps/desktop/src/lib/engine.ts:2254` |
| 143 | desktop | `GET` | `/api/runs/${seg}/events/stream` | fetch | `apps/desktop/src/lib/engine.ts:2187` |
| 144 | desktop | `GET` | `/api/runs/${seg}/events${qs}` | fetch | `apps/desktop/src/lib/engine.ts:2158` |
| 145 | desktop | `GET` | `/api/runs${qs}` | fetch | `apps/desktop/src/lib/engine.ts:2091` |
| 146 | desktop | `POST` | `/api/session` | fetch | `apps/desktop/src/lib/engine.ts:582` |
| 147 | desktop | `DELETE` | `/api/session/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:593` |
| 148 | desktop | `POST` | `/api/session/${seg}/chat` | fetch | `apps/desktop/src/lib/engine.ts:623` |
| 149 | desktop | `GET` | `/api/session/${seg}/messages` | fetch | `apps/desktop/src/lib/engine.ts:605` |
| 150 | desktop | `POST` | `/api/session/${sid}/agent` | fetch | `apps/desktop/src/lib/engine.ts:673` |
| 151 | desktop | `POST` | `/api/session/${sid}/cancel` | fetch | `apps/desktop/src/lib/engine.ts:721` |
| 152 | desktop | `POST` | `/api/session/${sid}/tool-confirm/${tid}` | fetch | `apps/desktop/src/lib/engine.ts:739` |
| 153 | desktop | `GET` | `/api/session${qs}` | fetch | `apps/desktop/src/lib/engine.ts:567` |
| 154 | desktop | `GET` | `/api/settings` | fetch | `apps/desktop/src/lib/engine.ts:799` |
| 155 | desktop | `DELETE` | `/api/settings/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:828` |
| 156 | desktop | `GET` | `/api/settings/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:808` |
| 157 | desktop | `PUT` | `/api/settings/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:817` |
| 158 | desktop | `POST` | `/api/settings/verify-key` | fetch | `apps/desktop/src/lib/engine.ts:836` |
| 159 | desktop | `POST` | `/api/skills` | fetch | `apps/desktop/src/lib/engine.ts:856` |
| 160 | desktop | `DELETE` | `/api/skills/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:884` |
| 161 | desktop | `POST` | `/api/skills/${seg}/toggle` | fetch | `apps/desktop/src/lib/engine.ts:873` |
| 162 | desktop | `POST` | `/api/skills/scan` | fetch | `apps/desktop/src/lib/engine.ts:863` |
| 163 | desktop | `POST` | `/api/webhook/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3240` |
| 164 | desktop | `GET` | `/api/webhook/${seg}/rate-limit` | fetch | `apps/desktop/src/lib/engine.ts:3207` |
| 165 | desktop | `POST` | `/api/webhook/${seg}/regenerate` | fetch | `apps/desktop/src/lib/engine.ts:3216` |
| 166 | desktop | `GET` | `/api/webhook/${seg}/secret` | fetch | `apps/desktop/src/lib/engine.ts:3193` |
| 167 | desktop | `POST` | `/api/workers` | fetch | `apps/desktop/src/lib/engine.ts:3462` |
| 168 | desktop | `DELETE` | `/api/workers/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3484` |
| 169 | desktop | `PUT` | `/api/workers/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3473` |
| 170 | desktop | `GET` | `/api/workers${q}` | fetch | `apps/desktop/src/lib/engine.ts:3377` |
| 171 | desktop | `GET` | `/api/workflow` | fetch | `apps/desktop/src/lib/engine.ts:2893` |
| 172 | desktop | `POST` | `/api/workflow` | fetch | `apps/desktop/src/lib/engine.ts:2929` |
| 173 | desktop | `GET` | `/api/workflow-revisions/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:3267` |
| 174 | desktop | `DELETE` | `/api/workflow-revisions/${seg}/${rev}` | fetch | `apps/desktop/src/lib/engine.ts:3318` |
| 175 | desktop | `GET` | `/api/workflow-revisions/${seg}/${rev}` | fetch | `apps/desktop/src/lib/engine.ts:3278` |
| 176 | desktop | `PATCH` | `/api/workflow-revisions/${seg}/${rev}` | fetch | `apps/desktop/src/lib/engine.ts:3305` |
| 177 | desktop | `POST` | `/api/workflow-revisions/${seg}/${rev}/restore` | fetch | `apps/desktop/src/lib/engine.ts:3293` |
| 178 | desktop | `DELETE` | `/api/workflow/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2963` |
| 179 | desktop | `GET` | `/api/workflow/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2902` |
| 180 | desktop | `PUT` | `/api/workflow/${seg}` | fetch | `apps/desktop/src/lib/engine.ts:2952` |
| 181 | desktop | `POST` | `/api/workflow/${seg}/duplicate` | fetch | `apps/desktop/src/lib/engine.ts:2973` |
| 182 | desktop | `GET` | `/api/workflow/${seg}/export` | fetch | `apps/desktop/src/lib/engine.ts:2987` |
| 183 | desktop | `GET` | `/api/workflow/${seg}/export.zip` | fetch | `apps/desktop/src/lib/engine.ts:3060` |
| 184 | desktop | `POST` | `/api/workflow/${seg}/preflight` | fetch | `apps/desktop/src/lib/engine.ts:3178` |
| 185 | desktop | `POST` | `/api/workflow/${seg}/run` | fetch | `apps/desktop/src/lib/engine.ts:3090` |
| 186 | desktop | `GET` | `/api/workflow/${seg}/runs?limit=${limit}&offset=${offset}` | fetch | `apps/desktop/src/lib/engine.ts:3128` |
| 187 | desktop | `DELETE` | `/api/workflow/${seg}/runs${qs}` | fetch | `apps/desktop/src/lib/engine.ts:3165` |
| 188 | desktop | `DELETE` | `/api/workflow/${seg1}/runs/${seg2}` | fetch | `apps/desktop/src/lib/engine.ts:3150` |
| 189 | desktop | `GET` | `/api/workflow/${seg1}/runs/${seg2}` | fetch | `apps/desktop/src/lib/engine.ts:3139` |
| 190 | desktop | `POST` | `/api/workflow/import` | fetch | `apps/desktop/src/lib/engine.ts:3017` |
| 191 | desktop | `POST` | `/api/workflow/import.zip` | fetch | `apps/desktop/src/lib/engine.ts:3031` |
| 192 | desktop | `POST` | `/api/workflow/import/claude-design` | fetch | `apps/desktop/src/lib/engine.ts:3045` |
| 193 | desktop | `GET` | `/api/workspace` | fetch | `apps/desktop/src/lib/engine.ts:753` |
| 194 | desktop | `POST` | `/api/workspace` | fetch | `apps/desktop/src/lib/engine.ts:764` |
| 195 | desktop | `DELETE` | `/api/workspace/${wid}` | fetch | `apps/desktop/src/lib/engine.ts:789` |
| 196 | desktop | `PUT` | `/api/workspace/${wid}` | fetch | `apps/desktop/src/lib/engine.ts:778` |
| 197 | web | `GET` | `/api/collab/status` | request | `apps/web/src/lib/api.ts:534` |
| 198 | web | `GET` | `/api/mcp/install-info${q ? ` | request | `apps/web/src/lib/api.ts:485` |
| 199 | web | `GET` | `/api/projects` | request | `apps/web/src/lib/api.ts:159` |
| 200 | web | `GET` | `/api/projects/${encodeURIComponent(id)}` | request | `apps/web/src/lib/api.ts:163` |
| 201 | web | `POST` | `/api/projects/${encodeURIComponent(projectId)}/collab/heartbeat` | request | `apps/web/src/lib/api.ts:851` |
| 202 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/collab/locks` | request | `apps/web/src/lib/api.ts:816` |
| 203 | web | `POST` | `/api/projects/${encodeURIComponent(projectId)}/collab/locks` | request | `apps/web/src/lib/api.ts:755` |
| 204 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/collab/peers` | request | `apps/web/src/lib/api.ts:796` |
| 205 | web | `POST` | `/api/projects/${encodeURIComponent(projectId)}/collab/selection` | request | `apps/web/src/lib/api.ts:775` |
| 206 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/collab/selections` | request | `apps/web/src/lib/api.ts:840` |
| 207 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/files` | request | `apps/web/src/lib/api.ts:167` |
| 208 | web | `DELETE` | `/api/projects/${encodeURIComponent(projectId)}/files/${segs}` | request | `apps/web/src/lib/api.ts:237` |
| 209 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/files/${segs}` | request | `apps/web/src/lib/api.ts:175` |
| 210 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}` | request | `apps/web/src/lib/api.ts:286` |
| 211 | web | `POST` | `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/restore` | request | `apps/web/src/lib/api.ts:303` |
| 212 | web | `GET` | `/api/projects/${encodeURIComponent(projectId)}/revisions${qs}` | request | `apps/web/src/lib/api.ts:268` |
| 213 | web | `POST` | `/api/runs` | request | `apps/web/src/lib/api.ts:321` |
| 214 | web | `GET` | `/api/runs?projectId=${encodeURIComponent(projectId)}` | request | `apps/web/src/lib/api.ts:330` |
| 215 | web | `GET` | `/api/runs/${encodeURIComponent(runId)}` | request | `apps/web/src/lib/api.ts:325` |
| 216 | web | `POST` | `/api/runs/${encodeURIComponent(runId)}/cancel` | request | `apps/web/src/lib/api.ts:359` |
| 217 | web | `GET` | `/api/runs/${encodeURIComponent(runId)}/events${qs}` | request | `apps/web/src/lib/api.ts:348` |
| 218 | web | `GET` | `/api/settings` | request | `apps/web/src/lib/api.ts:490` |
| 219 | web | `PUT` | `/api/settings/${encodeURIComponent(key.trim())}` | request | `apps/web/src/lib/api.ts:504` |
| 220 | web | `POST` | `/api/settings/verify-key` | request | `apps/web/src/lib/api.ts:519` |


## Client auth headers

| Client | Auth | Content-Type | Session header |
|--------|------|--------------|----------------|
| Web `api.ts:49-51` | `Authorization: Bearer` when token set | on body methods | `x-neos-session-id` via `collabSessionHeaders` (`api.ts:109-112`) |
| Desktop `engine.ts:462-473` | Bearer when token set | always `application/json` | set on write/delete/mkdir/restore paths |
| CLI `client.ts` | Bearer | on JSON body | n/a |

## Health special case (web)

`health()` uses raw `fetch` **without** Authorization (`api.ts:152-155`) — matches auth-exempt `/api/health`.

## SSE / streaming

- Web: `streamRunEvents` `api.ts:394`, collab stream `api.ts:614`, project events `api.ts:866`
- Desktop: collab/run streams in engine.ts (fetch + ReadableStream, not EventSource, so Bearer works)
