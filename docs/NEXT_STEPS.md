# NEOS Work — Next Steps

> **기준 버전**: v0.1.0
> **마지막 업데이트**: 2026-02-23
> **참고 문서**: [INITIAL_PLAN.md](./INITIAL_PLAN.md), [things_to_do.md](./things_to_do.md), [implementation/v0.1.0.md](./implementation/v0.1.0.md)

---

## v0.1.0 완료 현황

v0.1.0에서는 INITIAL_PLAN의 Phase 0~2를 중심으로, Phase 3의 도구 프레임워크 일부까지 구현했습니다.

| Phase | 범위 | 상태 |
|-------|------|------|
| Phase 0 | 프로젝트 기반 구축 | CI/CD 제외 완료 |
| Phase 1 | 셸 & 기본 UI | Sidecar 포함 완료 |
| Phase 2 | 세션 & 채팅 코어 | 완료 |
| Phase 3 | 에이전트 실행 엔진 | 도구 프레임워크만 완료, 오케스트레이터 미구현 |
| Phase 4 | 브라우저 & MCP | 미착수 |
| Phase 5 | 스킬 & 확장 | 미착수 |
| Phase 6 | 안정화 & 배포 | 미착수 |

---

## 우선순위별 남은 작업

### Tier 1 — 보안 & 안정성 (선행 필수)

v0.1.0 코드 리뷰에서 발견된 Critical 미해결 이슈입니다. 기능 확장 전에 해결해야 합니다.

| # | 항목 | 설명 | 관련 위치 |
|---|------|------|----------|
| S1 | API 키 암호화 저장 | 현재 SQLite에 평문 저장. Tauri keychain 플러그인 연동 필요 | `apps/server/src/db/settings.ts` |
| S2 | 인증/인가 미들웨어 | 로컬 전용(Host Mode)에서는 당장 괜찮으나, Client Mode 활성화 시 필수 | `apps/server/src/index.ts` |
| S3 | 메시지 목록 가상화 | 대화가 길어지면 렌더링 성능 저하. `react-window` 등 도입 필요 | `apps/desktop/src/pages/Sessions.tsx` |
| S4 | ReactMarkdown 스트리밍 성능 | 스트리밍 중 매 chunk마다 전체 재렌더링. 메모이제이션 또는 완성 후 렌더링 전략 필요 | `apps/desktop/src/pages/Sessions.tsx` |

### Tier 2 — 에이전트 코어 (Phase 3 잔여)

도구 프레임워크는 완성되었으나, 자율 실행을 위한 오케스트레이터가 없습니다.

| # | 항목 | 설명 | 생성할 위치 |
|---|------|------|-----------|
| A1 | 에이전트 오케스트레이터 | 사용자 목표 → 하위 태스크 분해 → 도구 선택 → 실행 → 검증 루프 | `packages/core/src/agent/` |
| A2 | 태스크 플래닝 | LLM을 이용한 자동 하위 단계 생성 및 우선순위 결정 | `packages/core/src/agent/planner.ts` |
| A3 | `agent_step` DB 테이블 | 에이전트 실행 단계를 DB에 기록 (INITIAL_PLAN §8 참조) | `apps/server/src/db/schema.ts` |
| A4 | 실행 취소 API | `POST /api/session/:id/cancel` — 현재 클라이언트 `AbortController`만 존재 | `apps/server/src/routes/session.ts` |

### Tier 3 — MCP & 브라우저 자동화 (Phase 4)

외부 도구/서비스 연동을 위한 확장 레이어입니다.

| # | 항목 | 설명 | 생성할 위치 |
|---|------|------|-----------|
| M1 | MCP 클라이언트 | `@modelcontextprotocol/sdk` 기반 MCP 프로토콜 클라이언트 패키지 | `packages/mcp-client/` (신규) |
| M2 | MCP 서버 연결 관리 UI | MCP 서버 추가/제거/상태 확인 UI | `apps/desktop/src/pages/Settings.tsx` |
| M3 | Playwright 브라우저 자동화 | 웹 페이지 접근, 스크린샷, DOM 스냅샷 도구 | `packages/core/src/tools/browser.ts` |
| M4 | 브라우저 스크린샷/스냅샷 캡처 | 캡처 결과를 에이전트 컨텍스트에 피드백 | `packages/core/src/tools/browser.ts` |

### Tier 4 — 스킬 시스템 (Phase 5)

OpenCode 호환 스킬 생태계 구축입니다.

| # | 항목 | 설명 | 생성할 위치 |
|---|------|------|-----------|
| K1 | SKILL.md 파서 | YAML frontmatter + 마크다운 본문 파싱. `SkillManifest` 타입은 이미 정의됨 | `packages/core/src/skills/parser.ts` |
| K2 | 스킬 디스커버리 | 프로젝트/글로벌 경로 탐색 (`.neos-work/skills/`, `~/.config/neos-work/skills/`, OpenCode 호환 경로) | `packages/core/src/skills/discovery.ts` |
| K3 | OpenPackage 설치 통합 | `npx opkg install` 연동 | `packages/core/src/skills/installer.ts` |
| K4 | 스킬 관리 UI | 현재 placeholder만 존재. 설치/활성화/비활성화 기능 구현 | `apps/desktop/src/pages/Skills.tsx` |
| K5 | `skill` DB 테이블 | 설치된 스킬 메타데이터 저장 (INITIAL_PLAN §8 참조) | `apps/server/src/db/schema.ts` |
| K6 | 템플릿 시스템 | Templates 페이지에 "Phase 5에서 제공" placeholder만 있음 | `apps/desktop/src/pages/Templates.tsx` |
| K7 | Native Skills: 문서 생성 | PPT, Word, Excel 생성 도구 | `packages/core/src/tools/documents.ts` |

### Tier 5 — 인프라 & 배포 (Phase 0 잔여 + Phase 6)

| # | 항목 | 설명 |
|---|------|------|
| I1 | CI/CD (GitHub Actions) | 빌드, 테스트, 린트 파이프라인 |
| I2 | 크로스 플랫폼 빌드 | macOS / Windows / Linux Tauri 빌드 테스트 |
| I3 | 자동 업데이트 | Tauri updater 플러그인 |
| I4 | 에러 처리 & Self-healing | 에이전트 실행 중 에러 복구 전략 |
| I5 | 보안 감사 | Tauri scope 설정, 폴더 접근 제어, 네트워크 보안 |
| I6 | 사용자 문서 | 설치 가이드, 사용법, 스킬 개발 가이드 |

---

## 누락된 디렉토리 & 파일

INITIAL_PLAN에 명시되어 있으나 v0.1.0에서 생성되지 않은 항목들입니다.

```
packages/
├── core/src/agent/              # 에이전트 오케스트레이터 (Tier 2)
├── core/src/skills/             # 스킬 파서, 디스커버리 (Tier 4)
├── mcp-client/                  # MCP 클라이언트 패키지 (Tier 3)
│
apps/
├── server/src/agent/            # 에이전트 서버 측 로직 (Tier 2)
├── web/                         # 웹 프론트엔드 (향후)
│
packages/ui/src/
├── components/                  # 공유 React 컴포넌트 (필요 시)
├── layouts/                     # 레이아웃 컴포넌트 (필요 시)
├── theme/                       # 테마 설정 (현재 desktop app 내 구현)
```

---

## 코드 품질 개선 (Minor)

v0.1.0 코드 리뷰에서 발견되었으나 영향도가 낮아 보류된 항목들입니다.

| 항목 | 설명 |
|------|------|
| `Sessions.tsx` className 타입 에러 | ReactMarkdown v9 타입 호환 이슈 |
| 숨김 파일 정책 불일치 | `list_directory`는 dotfiles 제외, `read_file`은 허용 — 정책 통일 필요 |
| 공유 컴포넌트 추출 | 현재 모든 UI가 desktop app에 인라인. 규모 커지면 `packages/ui/src/components/`로 추출 고려 |
