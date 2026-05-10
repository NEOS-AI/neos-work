# NEOS Work

Claude Cowork의 오픈소스 대안

**한국어** | **[English](README.md)**

---

## 로컬 실행 방법

### 사전 요구사항

- **Node.js** 22 이상
- **pnpm** 10 이상
- **Rust** (Tauri 데스크탑 앱 빌드용) — [rustup](https://rustup.rs) 으로 설치

### 설치

```bash
pnpm install
```

### 개발 서버 실행

#### 서버만 실행 (백엔드 API)

```bash
cd apps/server
pnpm dev
```

서버는 `127.0.0.1`의 랜덤 포트에서 시작됩니다. 시작 시 터미널에 `NEOS_PORT=<포트번호>` 형태로 포트가 출력됩니다.

#### 데스크탑 앱 실행 (Tauri + Vite)

```bash
cd apps/desktop
pnpm tauri dev
```

Vite 개발 서버(`http://localhost:1420`)와 Tauri 앱이 함께 시작됩니다.

#### 전체 워크스페이스 동시 실행 (Turborepo)

루트에서 실행하면 모든 패키지를 빌드 후 개발 서버를 시작합니다:

```bash
pnpm dev
```

### 빌드

```bash
pnpm build
```

## 설정 (API 키 및 환경 변수)

### API 키 설정

NEOS Work는 `.env` 파일을 사용하지 않습니다. API 키 등 민감한 설정값은 **앱 UI의 Settings 페이지**에서 입력하며, `~/.neos-work/data.db` SQLite DB에 AES-256-GCM으로 암호화되어 저장됩니다.

지원하는 주요 설정 키:

| 키 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API 키 |
| `GOOGLE_API_KEY` | Google Gemini API 키 |
| `TAVILY_API_KEY` | Tavily 웹 검색 API 키 |
| `SLACK_BOT_TOKEN` | Slack 봇 토큰 |
| `DISCORD_WEBHOOK_URL` | Discord 웹훅 URL |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | 한국투자증권 API 키 |

API로 직접 설정하려면:

```bash
curl -X PUT http://127.0.0.1:<PORT>/api/settings/ANTHROPIC_API_KEY \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d '{"value": "sk-ant-..."}'
```

> `PORT`와 `AUTH_TOKEN`은 서버 시작 시 콘솔에 출력됩니다.

### 서버 환경 변수

셸에서 변수를 직접 내보내거나 인라인으로 전달해 서버 동작을 제어할 수 있습니다:

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 랜덤 | 서버 바인딩 포트 (미설정 시 OS가 자동 할당) |

**예시** (포트를 고정해 서버를 단독 실행):

```bash
cd apps/server
PORT=3000 pnpm dev
```

> 서버는 `.env` 파일을 자동으로 읽지 않습니다. `.env`를 사용하려면 `dotenv-cli` 등으로 변수를 주입하세요:
> ```bash
> npx dotenv-cli -e .env -- pnpm dev
> ```

### 기타 명령어

| 명령어 | 설명 |
|---|---|
| `pnpm lint` | ESLint 검사 |
| `pnpm typecheck` | TypeScript 타입 검사 |
| `pnpm format` | Prettier 포맷팅 |
| `pnpm clean` | 빌드 산출물 및 node_modules 제거 |
