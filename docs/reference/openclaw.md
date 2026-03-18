OpenClaw 분석 요약 (2026-03-18 기준)

- OpenClaw는 단순 챗앱이 아니라, self-hosted 개인 AI 비서를 위한 gateway/orchestration 플랫폼이다.
- 핵심 개념은 하나의 Gateway 프로세스가 여러 채널(메신저/디바이스/UI)을 연결하고, agent 세션/툴/메모리/노드 디바이스를 통합 관리하는 구조다.

주요 특징
- 멀티채널 지원: WhatsApp, Telegram, Discord, iMessage 등 다양한 채널을 하나의 게이트웨이로 연결
- Agent-native 구조: 단순 LLM 호출이 아니라 세션, 툴 사용, 멀티에이전트 라우팅이 기본 전제
- Device companion 구조: 웹 Control UI + iOS/Android/macOS/headless node를 연동
- 보안 지향: DM pairing, loopback/auth 기반 제어, 승인/allowlist 계층 존재
- 플러그인/스킬 확장성: 채널, 모델 프로바이더, 사용자 툴을 확장 가능

기술적 특징
- Gateway 중심 아키텍처:
  - sessions, routing, auth, control-ui, credentials, execution approval 등을 중앙 관리
- Embedded agent runtime:
  - Pi SDK 기반 세션 실행을 subprocess가 아니라 임베디드 방식으로 통합
  - custom tools, system prompt, persistence/compaction, auth profile failover, model switching 지원
- 메모리/컨텍스트 분리:
  - memory plugin은 저장/검색
  - context engine은 실제 모델에 넣을 컨텍스트를 조립
- 툴 계층이 독립적:
  - browser, canvas, cron, image generation, memory, messaging, nodes, pdf, web-search 등 분리
- 모놀리포 구조:
  - Node.js + ESM + pnpm workspace
  - web UI는 Vite + Lit 기반
  - 모바일/데스크톱 companion 앱 포함

코드 구조
- openclaw.mjs
  - 배포용 엔트리포인트
- src/cli, src/commands
  - CLI 명령 처리 계층
- src/gateway
  - 핵심 서버 계층
  - auth, protocol, boot, control-ui, credentials, exec approval 등 포함
- src/channels
  - 채널 공통 로직 및 채널 연결
- src/agents
  - agent runtime, sandbox, tools, skills, auth profiles
- src/plugin-sdk
  - 플러그인 개발용 SDK/계약면
- extensions/
  - 모델 프로바이더 및 채널 확장 구현
  - 예: OpenAI, Anthropic, Ollama, Discord, Matrix 등
- skills/
  - 사용자 기능성 스킬 모음
  - 예: Notion, Obsidian, Weather, TTS, Whisper, image-gen 등
- ui/
  - Control UI 프론트엔드
- apps/*
  - iOS/Android/macOS companion 앱

핵심 해석
- OpenClaw의 본질은 “AI assistant app”보다 “personal AI orchestration OS/framework”에 가깝다.
- 따라서 분석/수정 시 모델 호출부만 보지 말고 아래를 같이 봐야 한다:
  1. gateway routing/session lifecycle
  2. tool invocation path
  3. channel abstraction
  4. plugin/extension boundary
  5. memory/context composition
  6. node/device integration
  7. auth/approval/security controls

분석 시 우선적으로 볼 것
- Gateway 진입점과 boot flow
- agent session 생성/관리 경로
- channel -> gateway -> agent -> tool 호출 흐름
- plugin-sdk와 extensions 간 인터페이스
- memory/context engine 연결부
- control-ui와 gateway 간 통신 방식

한 줄 요약
- OpenClaw는 멀티채널, 멀티툴, 멀티디바이스를 단일 Gateway와 agent runtime으로 통합하는 self-hosted AI assistant 플랫폼이다.