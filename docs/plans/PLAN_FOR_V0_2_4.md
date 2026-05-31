# NEOS Work v0.2.4 — 에디터 완성도 & 실행 이력 심화 + Open Design 핵심 기능 이식

> **기준 버전**: v0.2.3 (워크플로우 관찰력 향상 & 관리 편의 개선)
> **작성일**: 2026-05-30
> **테마**: 에디터·이력 UX 완성 (v0.2.3 기술 부채 해소) + Open Design 마이그레이션 1단계 (Memory 시스템, 다중 LLM 프로바이더, SKILL.md 스펙 확장)

---

## 0. Open Design 마이그레이션 배경

[Open Design](https://github.com/nexu-io/open-design)(Claude Design의 오픈소스 버전)의 상세 스펙이 `docs/reference/open-design-repository-spec-ko.md`에 정리되었다.

### neos-work와 Open Design의 주요 기능 대응

| Open Design 개념 | neos-work 대응 개념 | 현재 상태 |
|---|---|---|
| Project | Workflow | 유사한 구조, 1:1 대응 |
| Conversation | Session | 유사, 완성됨 |
| Skill (SKILL.md) | Skill (DB + file) | **기반 완성**, 스펙 확장 가능 |
| Design System (DESIGN.md) | 없음 | v0.3.0 대상 |
| Memory | 없음 | **v0.2.4 신규 구현** |
| Routine/Scheduler | 없음 | v0.3.0 대상 |
| BYOK provider proxy | Anthropic+Google만 | **v0.2.4 확장** |
| Agent CLI spawn | 없음 (내장 loop만) | v0.4.0+ 대상 |
| Artifact Preview | 없음 | v0.4.0 대상 |
| Deploy 통합 | 없음 | v0.4.0+ 대상 |
| Plugin/Marketplace | WorkflowBlock 유사 | v0.5.0+ 대상 |

### v0.2.4 마이그레이션 범위 선정 원칙

다음 세 조건을 모두 만족하는 OD 기능만 v0.2.4에 포함한다.

1. **즉각적인 가치**: 현재 워크플로우 에디터 + 에이전트 실행에서 바로 체감되는 기능
2. **적층식 구현 가능성**: 기존 코드베이스(`packages/core`, `apps/server`)에 침습적 변경 없이 추가 가능한 기능
3. **타입체크 범위 내 검증 가능**: `pnpm typecheck` + `pnpm test` 범위 내에서 검증 가능한 기능

이 기준에 따라 **Memory 시스템**, **OpenAI/Ollama 프로바이더 확장**, **SKILL.md 스펙 확장**을 v0.2.4에 포함한다.

---

## 1. 배경 및 현재 상태

v0.2.3은 durationMs 추적, 복제/내보내기/가져오기, 미저장 변경 감지, 실행 로그 UX를 완료했다.

코드를 검토하면 다음 공백이 남아 있다.

### 1.1 기술 부채 (v0.2.3 잔존)

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| `RunDetailPanel` durationMs 미표시 | `nodeResults`에 `durationMs`가 DB에 저장되지만 `RunDetailPanel`의 로컬 `NodeRunResult` 인터페이스에 필드가 없고 UI에 표시 안 됨 | v0.2.3 목표("null-safe 처리 확인")가 실질적으로 미완성 |
| `RunDetailPanel` nodeId UUID 노출 | Run Log는 v0.2.3에서 label로 교체됐지만 `RunDetailPanel`은 여전히 `nr.nodeId`(UUID) 표시 | 이력 상세 보기에서 어떤 노드인지 식별 어려움 |
| `RunHistoryPanel` 소요시간 없음 | 각 run에 시작/완료 시각만 있고 총 소요시간 계산·표시 없음 | 성능 비교 불가 |

### 1.2 실사용 UX 공백

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| 실행 이력 삭제 없음 | 이력은 쌓이기만 하고 지울 수 없음 | 테스트 실행 기록이 뒤섞여 가독성 저하 |
| 실행 이력 필터 없음 | All만 표시, 20개 hard-limit | 실패 run만 모아보거나 오래된 이력을 정리할 수 없음 |
| 워크플로우 이름 인라인 편집 없음 | 에디터 툴바에서 이름 클릭이 불가 | 이름을 바꾸려면 별도 API 호출이 필요해 UX가 단절됨 |
| 워크플로우 설명 편집 없음 | 생성 모달에도 description 입력 없고, 에디터에도 없음 | description이 사실상 사용 불가 필드 |
| SPA 내부 이탈 경고 없음 | `beforeunload`는 브라우저 탭 종료만 막음 | `← Workflows` 버튼 클릭 시 dirty 상태인데도 경고 없이 이동 |
| 커스텀 블록 paramDefs 편집 없음 | `Blocks.tsx` 모달에 paramDefs 추가/편집 UI가 없어 `block?.paramDefs ?? []`로 빈 배열만 사용 | prompt 기반 커스텀 블록에서 파라미터 정의가 불가 |

### 1.3 Open Design 마이그레이션 공백

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| Memory 시스템 없음 | 에이전트가 실행 간 기억을 유지할 수 없음 | 반복 작업에서 context를 매번 재구성해야 함 |
| OpenAI/Ollama 프로바이더 없음 | Anthropic + Google만 지원 | 사용자가 선호하는 모델 사용 불가 |
| SKILL.md 확장 필드 없음 | name/description/body 기본 파싱만 있음 | OD ecosystem skill을 완전히 로딩 불가 (triggers, mode, category 손실) |

v0.2.4는 1.1, 1.2, 1.3의 항목을 모두 해결한다.

---

## 2. 목표와 비목표

### 목표

**Part A: 에디터·이력 UX 완성 (v0.2.3 기술 부채 해소)**

1. `RunDetailPanel`에서 `durationMs` 표시 및 `nodeId` → `node label` 매핑.
2. `RunHistoryPanel`에서 총 소요시간 표시, 상태 필터(All / Completed / Failed), 개별 run 삭제.
3. `WorkflowEditor` 툴바에서 워크플로우 이름을 인라인으로 편집할 수 있고, 설명(description)도 에디터에서 수정할 수 있다.
4. React Router `useBlocker`로 SPA 내부 이동 시에도 미저장 경고를 표시한다.
5. `Blocks.tsx` 커스텀 블록 모달에서 `paramDefs`(파라미터 정의)를 추가·편집·삭제할 수 있다.

**Part B: Open Design 마이그레이션 1단계**

6. **Memory 시스템**: Markdown 파일 기반 에이전트 persistent memory (OD §16 이식)
7. **다중 LLM 프로바이더**: OpenAI 및 Ollama 지원 추가, 에이전트 노드에서 선택 가능 (OD §21 이식)
8. **SKILL.md 스펙 확장**: OD 호환 frontmatter 필드(`triggers`, `mode`, `platform`, `category`) 파싱 및 UI 표시

### 비목표

- Design Context Layer / DESIGN.md (v0.3.0 — OD §10 이식)
- Routine/Scheduler (v0.3.0 — OD §15 이식)
- 병렬 브랜치 · 진짜 OR 게이트 semantics (v0.3.0 예정)
- 코딩 도메인 내장 블록 구현 (v0.3.0 예정)
- 워크플로우 버전 이력(revision history)
- 전체 E2E 테스트 인프라
- 에이전트 노드 실시간 스트리밍 진행상황 표시
- 외부 에이전트 CLI spawn (v0.4.0 — OD §5 이식)
- Artifact Preview iframe (v0.4.0 — OD §4.1 이식)
- Deploy 통합 (v0.4.0+ — OD §19 이식)
- Plugin/Marketplace (v0.5.0+ — OD §11 이식)
- Media Generation (v0.4.0+ — OD §13 이식)

---

## 3. 제품 설계

### 3.1 RunDetailPanel 완성

#### 현재 흐름

```
RunDetailPanel.tsx
  → 로컬 NodeRunResult 인터페이스: { nodeId, status, output?, error? }  ← durationMs 없음
  → nr.nodeId 를 그대로 표시  ← UUID 노출
```

#### 목표 흐름

```
RunDetailPanel.tsx
  → 로컬 NodeRunResult 인터페이스에 durationMs?: number 추가
  → props로 nodeLabelMap: Record<string, string> 수신
  → (nodeLabelMap[nr.nodeId] ?? nr.nodeId) 표시
  → durationMs가 있으면 "123ms" 형식으로 표시
```

#### nodeLabelMap 전달 경로

`WorkflowEditor`는 이미 `nodeLabelMap`을 갖고 있으므로, 이를 `RunHistoryPanel`과 `RunDetailPanel`에 prop으로 전달한다.

```
WorkflowEditor
  ↓ nodeLabelMap prop
RunHistoryPanel
  ↓ nodeLabelMap prop
RunDetailPanel
```

---

### 3.2 실행 이력 관리 개선

#### 소요시간 표시

`RunHistoryPanel` 각 run 행에 `completedAt - startedAt`을 계산해서 표시한다.

```typescript
function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
```

#### 상태 필터

`RunHistoryPanel` 상단에 필터 버튼 추가:

```
[All] [✓ Completed] [✗ Failed] [⊘ Cancelled]
```

로컬 `filter` 상태(`'all' | 'completed' | 'failed' | 'cancelled'`)로 runs를 클라이언트 측에서 필터링한다.

#### 개별 run 삭제

##### API

```
DELETE /api/workflow/:id/runs/:runId
→ 200 { ok: true }
```

##### DB 헬퍼

```typescript
export function deleteRun(runId: string): boolean
```

##### UI

run 카드 hover 시 ✕ 삭제 버튼 노출. 삭제 후 목록 갱신.

#### 페이지네이션 (선택적 개선)

현재 20개 hard-limit → 초기 20개, "더 보기" 버튼으로 20개씩 추가 로드.

```typescript
// 서버: GET /api/workflow/:id/runs?limit=20&offset=0
// 클라이언트: offset 상태 관리
```

> **주의**: runs API에 `limit`/`offset` 쿼리 파라미터를 추가하되, 기존 파라미터 없는 호출은 기본 limit=20으로 처리하여 하위 호환성 유지.

---

### 3.3 워크플로우 이름 인라인 편집 & 설명 편집

#### 툴바 이름 인라인 편집

`WorkflowEditor.tsx` 툴바에서 이름 부분을 클릭하면 `<input>`으로 전환한다.

```typescript
const [editingName, setEditingName] = useState(false);
const [nameInput, setNameInput] = useState('');

const handleNameClick = () => {
  setNameInput(workflow.name);
  setEditingName(true);
};

const handleNameCommit = async () => {
  const trimmed = nameInput.trim();
  if (!trimmed || !client || !workflow) {
    setEditingName(false);
    return;
  }
  if (trimmed === workflow.name) {
    setEditingName(false);
    return;
  }
  // 서버에 즉시 저장 (draft와 별도로 name만 업데이트)
  const res = await client.updateWorkflow(workflow.id, { ...draft, name: trimmed });
  if (res.ok && res.data) {
    setWorkflow(res.data);
    setSavedDraft({ ...savedDraft!, nodes: savedDraft!.nodes }); // name은 draft 외부
  }
  setEditingName(false);
};
```

렌더링:

```tsx
{editingName ? (
  <input
    autoFocus
    className="mx-1 rounded border px-1 text-sm font-semibold"
    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
    value={nameInput}
    onChange={(e) => setNameInput(e.target.value)}
    onBlur={handleNameCommit}
    onKeyDown={(e) => { if (e.key === 'Enter') void handleNameCommit(); if (e.key === 'Escape') setEditingName(false); }}
    maxLength={200}
  />
) : (
  <span
    className="mx-1 cursor-pointer text-sm font-semibold hover:underline"
    style={{ color: 'var(--text-primary)' }}
    onClick={handleNameClick}
    title="Click to rename"
  >
    {workflow.name}
    {isDirty && <span className="ml-1 select-none text-yellow-400" title="Unsaved changes">•</span>}
  </span>
)}
```

#### Config 탭 — 워크플로우 설명 편집

노드가 선택되지 않은 상태에서 Config 탭 하단에 워크플로우 description 편집 영역을 추가한다.

`NodeConfigPanel.tsx`에 `workflowDescription?: string`과 `onUpdateDescription?: (desc: string) => void` prop 추가:

```tsx
{!selectedNode && workflowDescription !== undefined && (
  <div className="space-y-1 p-3">
    <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
      Workflow description
    </p>
    <TextAreaField
      label=""
      value={workflowDescription}
      rows={3}
      onChange={(desc) => onUpdateDescription?.(desc)}
    />
  </div>
)}
```

`WorkflowEditor`에서 `workflow.description`을 prop으로 전달하고, 변경 시 `handleSave` 없이 로컬 상태만 업데이트 후 다음 Save 때 함께 저장.

> **설계 원칙**: description 변경도 `isDirty`에 포함되도록 `draft` 구조에 포함한다.

`buildWorkflowDraft` 함수에 `description` 필드 추가:

```typescript
function buildWorkflowDraft(nodes: Node[], edges: Edge[], description?: string) {
  return {
    description,
    nodes: nodes.map(/* ... */),
    edges: edges.map(/* ... */),
  };
}
```

`handleSave()`가 `draft.description`을 `updateWorkflow` body에 포함시킨다.

---

### 3.4 React Router useBlocker

#### 현재 문제

`beforeunload`는 브라우저 탭 닫기·새로고침만 막는다. SPA 내부 이동(`← Workflows` 클릭, 사이드바 다른 메뉴 클릭)은 막지 못한다.

#### 구현

`react-router-dom`의 `useBlocker`를 사용한다 (React Router v6.8+에서 안정화).

```typescript
import { useBlocker } from 'react-router-dom';

const blocker = useBlocker(isDirty);
```

blocker 상태가 `'blocked'`이면 `ConfirmLeaveModal`을 표시한다.

#### ConfirmLeaveModal

신규 컴포넌트 `apps/desktop/src/components/workflow/ConfirmLeaveModal.tsx`:

```tsx
interface ConfirmLeaveModalProps {
  onConfirm: () => void;   // 이탈 확인 (blocker.proceed)
  onCancel: () => void;    // 취소 (blocker.reset)
}

export function ConfirmLeaveModal({ onConfirm, onCancel }: ConfirmLeaveModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl border p-6 shadow-xl w-80"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
        <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Unsaved changes
        </h3>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          You have unsaved changes. Leave without saving?
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
            Stay
          </button>
          <button onClick={onConfirm} className="rounded-lg px-3 py-1.5 text-xs text-white"
            style={{ backgroundColor: '#ef4444' }}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
```

`WorkflowEditor.tsx`에서:

```tsx
{blocker.state === 'blocked' && (
  <ConfirmLeaveModal
    onConfirm={() => blocker.proceed?.()}
    onCancel={() => blocker.reset?.()}
  />
)}
```

---

### 3.5 커스텀 블록 paramDefs 편집 UI

#### 현재 문제

`Blocks.tsx`의 `BlockModal`에서 커스텀 블록을 생성할 때 `paramDefs`를 입력할 수 없다. 코드에서 `block?.paramDefs ?? []`로 기존 값을 그대로 쓰거나 빈 배열을 넘긴다.

#### 설계

`BlockModal` 내에 paramDefs 편집 섹션을 추가한다.

```typescript
interface ParamDefDraft {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  default: string; // 직렬화된 문자열 (서버 저장 시 파싱)
  options: string; // comma-separated (select 타입만)
}
```

편집 UI:

```
[+ Add parameter]

┌──────────────────────────────────────────────────────┐
│  Key*    [symbol            ]   Type [string ▾]       │
│  Label*  [Symbol            ]   Default []            │
│  Description []                                        │
│                                          [✕ Remove]   │
└──────────────────────────────────────────────────────┘
```

- "Add parameter" 버튼으로 빈 paramDef draft 추가
- 각 행에서 key, label, type, description, default, options 편집
- ✕로 해당 paramDef 삭제
- 저장 시 `paramDefs` 배열로 변환해 `onSave`에 전달

`onSave`에서 paramDefs의 `default`값을 타입에 맞게 파싱:

```typescript
paramDefs: paramDefDrafts.map((d) => ({
  key: d.key,
  label: d.label,
  type: d.type,
  description: d.description || undefined,
  default: d.type === 'number' ? Number(d.default) || undefined
           : d.type === 'boolean' ? d.default === 'true'
           : d.default || undefined,
  options: d.type === 'select' ? d.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
}))
```

---

## 3.6 Part B — Memory 시스템 (OD §16 이식)

### 설계 철학

OD의 Memory 시스템을 neos-work에 이식한다. 에이전트 노드가 실행 사이에 기억을 유지하고, 다음 실행의 context에 자동으로 주입되도록 한다. OD와 동일하게 **Markdown 파일 기반**으로 구현한다 (SQLite 아님).

### 저장 구조

```text
~/.config/neos-work/memory/
├── user_<slug>.md         ← 사용자 프로필/선호
├── session_<slug>.md      ← 세션별 메모
├── skill_<slug>.md        ← 특정 skill 관련 메모
└── reference_<slug>.md    ← 참고 자료
```

각 파일 형식:

```markdown
---
name: My role context
type: user
enabled: true
---

상세 본문 (Markdown)
```

### 타입 및 인터페이스

```typescript
// packages/shared/src/types/memory.ts (신규)
export type MemoryType = 'user' | 'session' | 'skill' | 'reference';

export interface MemoryItem {
  id: string;          // slug 기반 UUID
  name: string;
  type: MemoryType;
  enabled: boolean;
  content: string;     // Markdown body
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  name: string;
  type: MemoryType;
  content: string;
  enabled?: boolean;
}

export interface UpdateMemoryInput {
  name?: string;
  type?: MemoryType;
  content?: string;
  enabled?: boolean;
}
```

### Memory API

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/memory` | 전체 memory 항목 목록 |
| `POST` | `/api/memory` | 새 memory 항목 생성 |
| `GET` | `/api/memory/:id` | 단일 항목 조회 |
| `PUT` | `/api/memory/:id` | 항목 수정 |
| `DELETE` | `/api/memory/:id` | 항목 삭제 |
| `PUT` | `/api/memory/:id/toggle` | 활성/비활성 토글 |
| `GET` | `/api/memory/export` | enabled 항목만 Markdown으로 반환 (에이전트 주입용) |

### AgentNode 연동

`AgentNode` 실행 시 enabled memory 항목을 시스템 프롬프트에 주입:

```typescript
// packages/workflow-engine/src/nodes/agent.ts
async function buildSystemPromptWithMemory(
  basePrompt: string,
  serverUrl: string,
  authToken: string,
): Promise<string> {
  const memoryRes = await fetch(`${serverUrl}/api/memory/export`, {
    headers: { Authorization: `Bearer ${authToken}` },
  }).catch(() => null);

  if (!memoryRes?.ok) return basePrompt;
  const memoryContext = await memoryRes.text().catch(() => '');
  if (!memoryContext.trim()) return basePrompt;

  return `${basePrompt}\n\n---\n## Agent Memory\n${memoryContext}`;
}
```

실패해도 graceful (memory 주입 없이 정상 실행).

### UI: Memory 페이지

신규 페이지 `apps/desktop/src/pages/Memory.tsx`:

- 사이드바에 "Memory" 항목 추가
- 항목 목록 카드 (type별 색상 구분: user=파랑, session=초록, skill=보라, reference=회색)
- 새 항목 추가 모달 (name, type, content textarea)
- 항목 편집 모달 (인라인 Markdown editor)
- enabled/disabled 토글 스위치 (비활성 시 에이전트에 주입되지 않음)
- 삭제 버튼 + 확인 다이얼로그

---

## 3.7 Part B — 다중 LLM 프로바이더 확장 (OD §21 이식)

### 설계 철학

에이전트 노드가 사용할 프로바이더와 모델을 선택할 수 있게 하고, Settings에서 각 프로바이더의 API key와 base URL을 관리한다. OpenAI와 Ollama를 추가한다.

### packages/shared 변경

```typescript
// packages/shared/src/models.ts 에 추가
export const OPENAI_MODELS: Model[] = [
  { id: 'gpt-4o',      name: 'GPT-4o',      providerId: 'openai', contextWindow: 128_000, supportsThinking: false, supportsTools: true, supportsVision: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', contextWindow: 128_000, supportsThinking: false, supportsTools: true, supportsVision: true },
  { id: 'o3-mini',     name: 'o3-mini',     providerId: 'openai', contextWindow: 200_000, supportsThinking: true,  supportsTools: true, supportsVision: false },
];

// Ollama는 custom base URL로 동적 추가. preset은 인기 모델만 제공.
export const OLLAMA_PRESET_MODELS: Model[] = [
  { id: 'llama3.3',       name: 'Llama 3.3',       providerId: 'ollama', contextWindow: 128_000, supportsThinking: false, supportsTools: true, supportsVision: false },
  { id: 'qwen2.5-coder',  name: 'Qwen 2.5 Coder',  providerId: 'ollama', contextWindow: 128_000, supportsThinking: false, supportsTools: true, supportsVision: false },
  { id: 'deepseek-r1',    name: 'DeepSeek R1',      providerId: 'ollama', contextWindow: 128_000, supportsThinking: true,  supportsTools: true, supportsVision: false },
];
```

### packages/core — OpenAI Adapter

신규 `packages/core/src/llm/openai.ts`:

```typescript
export class OpenAIAdapter implements LLMAdapter {
  readonly providerId = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly modelId: string = 'gpt-4o',
  ) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: options?.tools?.map(toolToOpenAISchema),
        tool_choice: options?.tools?.length ? 'auto' : undefined,
      }),
      signal: options?.signal,
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    return openAIResponseToChatResponse(await res.json() as OpenAIChatResponse);
  }
}
// Ollama는 OpenAI 호환 API → baseUrl = 'http://localhost:11434/v1' 로 재사용
```

### AgentNode config 변경

```typescript
interface AgentNodeConfig {
  harnessId: string;
  provider?: 'anthropic' | 'google' | 'openai' | 'ollama';  // 추가
  model?: string;
  systemPrompt?: string;
  maxSteps?: number;
}
```

### Settings 페이지 변경

- OpenAI API key input 추가
- OpenAI base URL input (placeholder: `https://api.openai.com/v1`, Azure/LM Studio 호환)
- Ollama base URL input (placeholder: `http://localhost:11434`)

### NodeConfigPanel 변경

에이전트 노드 선택 시 provider 선택 `<select>` 추가 → 선택된 provider의 모델 목록을 model `<select>`에 연동.

---

## 3.8 Part B — SKILL.md 스펙 확장 (OD §9 이식)

### 설계 철학

OD의 `SkillInfo` 주요 필드를 neos-work `SkillManifest`에 추가한다. OD ecosystem에서 제공되는 SKILL.md 파일을 완전히 파싱할 수 있게 된다.

### SkillManifest 확장

```typescript
interface SkillManifest {
  // 기존 필드
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  // OD §9.3 호환 확장 필드 (신규)
  triggers?: string[];           // 추천 트리거 문구 목록 (comma-sep → array)
  mode?: SkillMode;              // image | video | audio | deck | template | prototype | automation
  platform?: 'desktop' | 'mobile';
  category?: string;             // UI 필터용 카테고리
  featured?: number;             // 피처드 순서 (낮을수록 앞)
  examplePrompt?: string;        // 예시 프롬프트
  designSystemRequired?: boolean;
  fidelity?: 'wireframe' | 'high-fidelity';
  version?: string;
}

type SkillMode = 'image' | 'video' | 'audio' | 'deck' | 'design-system' | 'template' | 'prototype' | 'automation';
```

### parser.ts 확장

`packages/core/src/skills/parser.ts`에 확장 필드 파싱 추가:

```typescript
triggers: raw.triggers ? String(raw.triggers).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
mode: raw.mode as SkillMode | undefined,
platform: raw.platform as 'desktop' | 'mobile' | undefined,
category: raw.category,
featured: raw.featured !== undefined ? Number(raw.featured) : undefined,
examplePrompt: raw['example_prompt'] ?? raw.examplePrompt,
designSystemRequired: raw['design_system_required'] === 'true' || raw.designSystemRequired === true,
fidelity: raw.fidelity as 'wireframe' | 'high-fidelity' | undefined,
version: raw.version,
```

### Skills 페이지 UI 개선

`apps/desktop/src/pages/Skills.tsx`:

- skill 카드에 `mode` 배지 표시 (`automation`, `template` 등, 색상 구분)
- `triggers` 목록 표시 (카드 하단 또는 tooltip)
- `featured` 기준 정렬 (featured 항목 먼저 표시)
- `category` 기반 필터 버튼 추가 (All + 발견된 카테고리별)
- `examplePrompt` 있으면 "Try" 버튼 추가 (클릭 시 새 세션에서 해당 prompt 입력)

---

## 4. 파일 맵

### 신규 파일

| 파일 | 책임 |
|------|------|
| `apps/desktop/src/components/workflow/ConfirmLeaveModal.tsx` | SPA 내부 이탈 경고 모달 컴포넌트 (Part A) |
| `apps/server/src/routes/memory.ts` | Memory API route — Hono router (Part B Task 6) |
| `apps/server/src/lib/memory-store.ts` | Memory 파일 R/W 헬퍼 (Part B Task 6) |
| `apps/desktop/src/pages/Memory.tsx` | Memory 관리 UI 페이지 (Part B Task 6) |
| `packages/shared/src/types/memory.ts` | MemoryItem, CreateMemoryInput, UpdateMemoryInput 타입 (Part B Task 6) |
| `packages/core/src/llm/openai.ts` | OpenAI/Ollama LLM adapter (Part B Task 7) |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/desktop/src/components/workflow/RunDetailPanel.tsx` | 로컬 `NodeRunResult`에 `durationMs?: number` 추가; `nodeLabelMap: Record<string, string>` prop 수신; nodeId → label 표시; durationMs 표시 |
| `apps/desktop/src/components/workflow/RunHistoryPanel.tsx` | `nodeLabelMap` prop 수신 후 `RunDetailPanel`에 전달; 소요시간 계산 표시; 상태 필터 추가; run 삭제 버튼 추가 |
| `apps/desktop/src/pages/WorkflowEditor.tsx` | `nodeLabelMap`을 `RunHistoryPanel`에 전달; 이름 인라인 편집(`editingName` state); `buildWorkflowDraft`에 `description` 포함; `useBlocker` 적용; `ConfirmLeaveModal` 렌더링 |
| `apps/desktop/src/components/workflow/NodeConfigPanel.tsx` | `workflowDescription?: string`·`onUpdateDescription?` prop 추가; 노드 미선택 시 description 편집 영역 표시 |
| `apps/desktop/src/pages/Blocks.tsx` | `BlockModal`에 paramDefs 편집 섹션 추가 |
| `apps/server/src/routes/workflow.ts` | `DELETE /:id/runs/:runId` 엔드포인트 추가; runs 목록 API에 `limit`/`offset` 쿼리 파라미터 지원 |
| `apps/server/src/db/workflows.ts` | `deleteRun(runId: string): boolean` 헬퍼 추가 |
| `apps/desktop/src/lib/engine.ts` | `deleteWorkflowRun(workflowId, runId)` 메서드 추가; `listWorkflowRuns`에 `limit`/`offset` 파라미터 추가; memory CRUD 메서드 추가 |
| `apps/server/src/index.ts` | memory route 등록 |
| `apps/server/src/routes/settings.ts` | OpenAI/Ollama 관련 settings key 지원 |
| `apps/desktop/src/components/Sidebar.tsx` | `/memory` 라우트 항목 추가 |
| `apps/desktop/src/App.tsx` | `/memory` 라우트 + `<Memory>` 페이지 연결 |
| `packages/shared/src/models.ts` | `OPENAI_MODELS`, `OLLAMA_PRESET_MODELS` 추가; `ALL_MODELS` 에 포함 |
| `packages/shared/src/index.ts` | memory 타입 export 추가 |
| `packages/core/src/llm/index.ts` | OpenAI adapter export 추가 |
| `packages/workflow-engine/src/nodes/agent.ts` | memory export 주입 연동 |
| `apps/desktop/src/components/workflow/NodeConfigPanel.tsx` | `workflowDescription?: string`·`onUpdateDescription?` prop 추가; 노드 미선택 시 description 편집 영역 표시; agent 노드에 provider + model 선택 추가 |
| `apps/desktop/src/pages/Blocks.tsx` | `BlockModal`에 paramDefs 편집 섹션 추가 |
| `apps/desktop/src/pages/Settings.tsx` | OpenAI key, OpenAI base URL, Ollama base URL 입력 추가 |
| `apps/desktop/src/pages/Skills.tsx` | mode 배지, triggers 표시, featured 정렬, category 필터 추가 |
| `packages/shared/src/types/skill.ts` (또는 `types.ts`) | `SkillManifest` 확장 필드 추가 |
| `packages/core/src/skills/parser.ts` | 확장 frontmatter 필드 파싱 |
| `packages/ui/src/i18n/locales/en/common.json` | `run.*`, `workflow.*`, `block.*`, `memory.*`, `common.loadMore` 신규 키 추가 |
| `packages/ui/src/i18n/locales/ko/common.json` | 동일 키 한국어 번역 추가 |
| `docs/implementation/v0.2.4.md` | 구현 완료 후 실제 변경 사항 기록 |

---

## 5. Task별 구현 계획

### Task 1: RunDetailPanel 완성 (기술 부채)

**Files:**
- Modify: `apps/desktop/src/components/workflow/RunDetailPanel.tsx`
- Modify: `apps/desktop/src/components/workflow/RunHistoryPanel.tsx`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: RunDetailPanel 로컬 타입에 durationMs 추가**

  ```typescript
  // RunDetailPanel.tsx 내부 인터페이스
  interface NodeRunResult {
    nodeId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    output?: unknown;
    error?: string;
    durationMs?: number;  // 추가
    startedAt?: string;
    completedAt?: string;
  }
  ```

- [ ] **Step 2: RunDetailPanel에 nodeLabelMap prop 추가**

  ```typescript
  interface RunDetailPanelProps {
    workflowId: string;
    runId: string;
    nodeLabelMap?: Record<string, string>;  // 추가
    onClose: () => void;
  }
  ```

  노드 행 렌더링에서:

  ```tsx
  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
    {nodeLabelMap?.[nr.nodeId] ?? nr.nodeId}
  </span>
  ```

- [ ] **Step 3: RunDetailPanel에 durationMs 표시**

  노드 행 내에 추가:

  ```tsx
  {nr.status === 'completed' && nr.durationMs !== undefined && (
    <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
      {nr.durationMs < 1000 ? `${nr.durationMs}ms` : `${(nr.durationMs / 1000).toFixed(2)}s`}
    </span>
  )}
  ```

- [ ] **Step 4: RunHistoryPanel에 nodeLabelMap prop 추가 및 전달**

  ```typescript
  export function RunHistoryPanel(props: {
    workflowId: string;
    refreshKey: number;
    nodeLabelMap?: Record<string, string>;  // 추가
  })
  ```

  `RunDetailPanel`에 `nodeLabelMap={props.nodeLabelMap}` 전달.

- [ ] **Step 5: WorkflowEditor에서 nodeLabelMap을 RunHistoryPanel에 전달**

  ```tsx
  <RunHistoryPanel
    workflowId={workflow.id}
    refreshKey={historyRefreshKey}
    nodeLabelMap={nodeLabelMap}
  />
  ```

- [ ] **Step 6: RunHistoryPanel 소요시간 표시**

  ```typescript
  function formatDuration(startedAt: string, completedAt?: string): string {
    if (!completedAt) return '—';
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  }
  ```

  run 카드에 소요시간 표시:

  ```tsx
  <span style={{ color: 'var(--text-muted)' }}>
    {formatDuration(run.startedAt, run.completedAt)}
  </span>
  ```

- [ ] **Step 7: 검증**

  ```bash
  pnpm typecheck
  ```

---

### Task 2: 실행 이력 관리 개선

**Files:**
- Modify: `apps/server/src/db/workflows.ts`
- Modify: `apps/server/src/routes/workflow.ts`
- Modify: `apps/desktop/src/lib/engine.ts`
- Modify: `apps/desktop/src/components/workflow/RunHistoryPanel.tsx`

- [ ] **Step 1: DB 헬퍼 — deleteRun 추가**

  ```typescript
  export function deleteRun(runId: string): boolean {
    const result = db.prepare('DELETE FROM workflow_runs WHERE id = ?').run(runId);
    return result.changes > 0;
  }
  ```

- [ ] **Step 2: listRuns에 limit/offset 파라미터 추가**

  ```typescript
  export function listRuns(
    workflowId: string,
    limit = 20,
    offset = 0,
  ): WorkflowRun[] {
    return db
      .prepare(
        'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?',
      )
      .all(workflowId, limit, offset) as WorkflowRun[];
  }
  ```

- [ ] **Step 3: server route — DELETE /:id/runs/:runId 추가**

  ```typescript
  workflow.delete('/:id/runs/:runId', (c) => {
    const run = db.getRun(c.req.param('runId'));
    if (!run) return c.json({ ok: false, error: 'Not found' }, 404);
    if (run.workflowId !== c.req.param('id')) return c.json({ ok: false, error: 'Not found' }, 404);
    db.deleteRun(run.id);
    return c.json({ ok: true });
  });
  ```

- [ ] **Step 4: server route — GET /:id/runs에 limit/offset 쿼리 파라미터 지원**

  ```typescript
  workflow.get('/:id/runs', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const offset = Number(c.req.query('offset') ?? '0');
    const runs = db.listRuns(c.req.param('id'), limit, offset);
    return c.json({ ok: true, data: runs });
  });
  ```

- [ ] **Step 5: engine.ts — deleteWorkflowRun, listWorkflowRuns 시그니처 갱신**

  ```typescript
  async listWorkflowRuns(
    workflowId: string,
    limit = 20,
    offset = 0,
  ): Promise<ApiResponse<WorkflowRun[]>> {
    const res = await fetch(
      `${this.baseUrl}/api/workflow/${workflowId}/runs?limit=${limit}&offset=${offset}`,
      { headers: this.getHeaders() },
    );
    return res.json();
  }

  async deleteWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<void>> {
    const res = await fetch(
      `${this.baseUrl}/api/workflow/${workflowId}/runs/${runId}`,
      { method: 'DELETE', headers: this.getHeaders() },
    );
    return res.json();
  }
  ```

- [ ] **Step 6: RunHistoryPanel — 필터 + 삭제 버튼 + 더 보기**

  ```typescript
  type RunFilter = 'all' | 'completed' | 'failed' | 'cancelled';
  const [filter, setFilter] = useState<RunFilter>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  ```

  필터 적용:

  ```typescript
  const filteredRuns = runs.filter((r) => filter === 'all' || r.status === filter);
  ```

  삭제 버튼 (run 카드 hover 시 표시):

  ```tsx
  <button
    onClick={async (e) => {
      e.stopPropagation();
      if (!client) return;
      await client.deleteWorkflowRun(props.workflowId, run.id);
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    }}
    className="ml-auto rounded px-1 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
    style={{ color: 'var(--text-muted)' }}
    title="Delete run"
  >
    ✕
  </button>
  ```

  run 카드에 `group` class 추가.

  더 보기 버튼:

  ```tsx
  {hasMore && (
    <button
      onClick={() => setOffset((prev) => prev + 20)}
      className="mt-2 w-full rounded px-2 py-1 text-xs"
      style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
    >
      {t('common.loadMore')}
    </button>
  )}
  ```

- [ ] **Step 7: 검증**

  ```bash
  pnpm typecheck
  ```

---

### Task 3: 워크플로우 이름 인라인 편집 & 설명 편집

**Files:**
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`
- Modify: `apps/desktop/src/components/workflow/NodeConfigPanel.tsx`

- [ ] **Step 1: buildWorkflowDraft에 description 포함**

  ```typescript
  function buildWorkflowDraft(nodes: Node[], edges: Edge[], description?: string) {
    return {
      description,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType as string,
        label: n.data.label as string,
        position: n.position,
        config: (n.data.config as Record<string, unknown>) ?? {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label as string | undefined,
      })),
    };
  }
  ```

  `WorkflowEditor`에 `workflowDescription` state 추가:

  ```typescript
  const [workflowDescription, setWorkflowDescription] = useState('');
  ```

  `loadWorkflow` 시 초기화:

  ```typescript
  setWorkflowDescription(res.data.description ?? '');
  ```

  `draft`를 `buildWorkflowDraft(nodes, edges, workflowDescription)`으로 변경.

  `handleSave()`에서 `draft.description`이 포함되어 자동으로 저장됨.

- [ ] **Step 2: 툴바 이름 인라인 편집**

  ```typescript
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const handleNameCommit = async () => {
    const trimmed = nameInput.trim().slice(0, 200);
    setEditingName(false);
    if (!trimmed || !client || !workflow || trimmed === workflow.name) return;
    const res = await client.updateWorkflow(workflow.id, { ...draft, name: trimmed });
    if (res.ok && res.data) setWorkflow(res.data);
  };
  ```

  툴바 렌더링 교체 (기존 `<span>{workflow.name}</span>` 대체):

  ```tsx
  {editingName ? (
    <input
      autoFocus
      className="mx-1 rounded border px-1 text-sm font-semibold"
      style={{
        backgroundColor: 'var(--bg-tertiary)',
        borderColor: 'var(--border-primary)',
        color: 'var(--text-primary)',
        width: '160px',
      }}
      value={nameInput}
      maxLength={200}
      onChange={(e) => setNameInput(e.target.value)}
      onBlur={() => void handleNameCommit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void handleNameCommit();
        if (e.key === 'Escape') setEditingName(false);
      }}
    />
  ) : (
    <span
      className="mx-1 cursor-text text-sm font-semibold hover:opacity-80"
      style={{ color: 'var(--text-primary)' }}
      onClick={() => { setNameInput(workflow.name); setEditingName(true); }}
      title={t('workflow.rename')}
    >
      {workflow.name}
      {isDirty && <span className="ml-1 select-none text-yellow-400" title="Unsaved changes">•</span>}
    </span>
  )}
  ```

- [ ] **Step 3: NodeConfigPanel에 workflow description 편집 영역 추가**

  `NodeConfigPanel` props 확장:

  ```typescript
  interface NodeConfigPanelProps {
    selectedNode: Node | null;
    validationIssues: WorkflowValidationIssue[];
    onPatchNodeData: (nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => void;
    workflowDescription?: string;                        // 추가
    onUpdateDescription?: (desc: string) => void;        // 추가
  }
  ```

  노드 미선택 시 렌더링 하단에 추가:

  ```tsx
  {!selectedNode && onUpdateDescription !== undefined && (
    <div className="mt-3 space-y-1">
      <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {t('workflow.description')}
      </p>
      <TextAreaField
        label=""
        value={workflowDescription ?? ''}
        rows={3}
        onChange={onUpdateDescription}
      />
    </div>
  )}
  ```

  `WorkflowEditor`에서 props 전달:

  ```tsx
  <NodeConfigPanel
    selectedNode={selectedNode}
    validationIssues={validationIssues}
    onPatchNodeData={patchNodeData}
    workflowDescription={workflowDescription}
    onUpdateDescription={setWorkflowDescription}
  />
  ```

- [ ] **Step 4: 검증**

  ```bash
  pnpm typecheck
  ```

---

### Task 4: React Router useBlocker (SPA 내부 이탈 경고)

**Files:**
- Create: `apps/desktop/src/components/workflow/ConfirmLeaveModal.tsx`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: ConfirmLeaveModal 컴포넌트 생성**

  ```tsx
  // apps/desktop/src/components/workflow/ConfirmLeaveModal.tsx
  import { useTranslation } from 'react-i18next';

  interface ConfirmLeaveModalProps {
    onConfirm: () => void;
    onCancel: () => void;
  }

  export function ConfirmLeaveModal({ onConfirm, onCancel }: ConfirmLeaveModalProps) {
    const { t } = useTranslation('common');
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      >
        <div
          className="w-80 rounded-2xl border p-6 shadow-xl"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
        >
          <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('workflow.unsavedChanges')}
          </h3>
          <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('workflow.leaveConfirm')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onConfirm}
              className="rounded-lg px-3 py-1.5 text-xs text-white"
              style={{ backgroundColor: '#ef4444' }}
            >
              {t('workflow.leave')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: WorkflowEditor에 useBlocker 적용**

  기존 `beforeunload` 효과는 유지하고, useBlocker를 추가:

  ```typescript
  import { useBlocker } from 'react-router-dom';
  import { ConfirmLeaveModal } from '../components/workflow/ConfirmLeaveModal.js';

  const blocker = useBlocker(isDirty);
  ```

  JSX 최하단(`runInputsOpen` 조건 블록 옆)에 추가:

  ```tsx
  {blocker.state === 'blocked' && (
    <ConfirmLeaveModal
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  )}
  ```

- [ ] **Step 3: 검증**

  - 노드 이동 후 `← Workflows` 클릭 → 모달 표시 확인
  - 모달에서 "Stay" → 에디터 유지
  - 모달에서 "Leave" → Workflows 목록으로 이동

  ```bash
  pnpm typecheck
  ```

---

### Task 5: 커스텀 블록 paramDefs 편집 UI

**Files:**
- Modify: `apps/desktop/src/pages/Blocks.tsx`

- [ ] **Step 1: ParamDefDraft 타입 정의 및 상태 추가**

  `BlockModal` 내부에 추가:

  ```typescript
  interface ParamDefDraft {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    description: string;
    defaultValue: string;
    options: string; // comma-separated
  }

  function toParamDefDraft(p: BlockParamDef): ParamDefDraft {
    return {
      key: p.key,
      label: p.label,
      type: p.type,
      description: p.description ?? '',
      defaultValue: p.default !== undefined ? String(p.default) : '',
      options: p.options?.join(', ') ?? '',
    };
  }

  const [paramDrafts, setParamDrafts] = useState<ParamDefDraft[]>(
    block?.paramDefs?.map(toParamDefDraft) ?? [],
  );
  ```

- [ ] **Step 2: paramDefs 편집 섹션 렌더링**

  `BlockModal` 폼 내에 추가 (implType이 'prompt' 또는 'native' 외일 때만 아니라 모든 타입에서 활성화):

  ```tsx
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {t('block.params')} ({paramDrafts.length})
      </p>
      <button
        type="button"
        onClick={() =>
          setParamDrafts((prev) => [
            ...prev,
            { key: '', label: '', type: 'string', description: '', defaultValue: '', options: '' },
          ])
        }
        className="rounded px-2 py-0.5 text-xs"
        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
      >
        + {t('block.addParam')}
      </button>
    </div>

    {paramDrafts.map((p, idx) => (
      <div
        key={idx}
        className="rounded-lg border p-2 space-y-1"
        style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="flex gap-2">
          <input
            placeholder="key"
            value={p.key}
            onChange={(e) =>
              setParamDrafts((prev) =>
                prev.map((d, i) => (i === idx ? { ...d, key: e.target.value } : d)),
              )
            }
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={p.type}
            onChange={(e) =>
              setParamDrafts((prev) =>
                prev.map((d, i) =>
                  i === idx ? { ...d, type: e.target.value as ParamDefDraft['type'] } : d,
                ),
              )
            }
            style={{ ...inputStyle, width: '90px' }}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="select">select</option>
          </select>
          <button
            type="button"
            onClick={() => setParamDrafts((prev) => prev.filter((_, i) => i !== idx))}
            className="rounded px-2 text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>
        <input
          placeholder="label"
          value={p.label}
          onChange={(e) =>
            setParamDrafts((prev) =>
              prev.map((d, i) => (i === idx ? { ...d, label: e.target.value } : d)),
            )
          }
          style={{ ...inputStyle }}
        />
        <input
          placeholder="description (optional)"
          value={p.description}
          onChange={(e) =>
            setParamDrafts((prev) =>
              prev.map((d, i) => (i === idx ? { ...d, description: e.target.value } : d)),
            )
          }
          style={{ ...inputStyle }}
        />
        <input
          placeholder={p.type === 'select' ? 'options: a, b, c' : 'default value'}
          value={p.type === 'select' ? p.options : p.defaultValue}
          onChange={(e) =>
            setParamDrafts((prev) =>
              prev.map((d, i) =>
                i === idx
                  ? p.type === 'select'
                    ? { ...d, options: e.target.value }
                    : { ...d, defaultValue: e.target.value }
                  : d,
              ),
            )
          }
          style={{ ...inputStyle }}
        />
      </div>
    ))}
  </div>
  ```

- [ ] **Step 3: 저장 시 paramDrafts → paramDefs 변환**

  `handleSave()` 내에서:

  ```typescript
  const paramDefs: BlockParamDef[] = paramDrafts
    .filter((d) => d.key.trim() && d.label.trim())
    .map((d) => ({
      key: d.key.trim(),
      label: d.label.trim(),
      type: d.type,
      description: d.description.trim() || undefined,
      default:
        d.type === 'number'
          ? Number(d.defaultValue) || undefined
          : d.type === 'boolean'
          ? d.defaultValue === 'true' ? true : undefined
          : d.defaultValue.trim() || undefined,
      options:
        d.type === 'select'
          ? d.options.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
    }));

  await onSave({
    /* 기존 필드들 */
    paramDefs,  // 새로 계산된 paramDefs 전달
  });
  ```

- [ ] **Step 4: 검증**

  커스텀 블록 생성 시 paramDefs 추가 → 저장 → 블록 노드에서 BlockParamForm에 해당 파라미터 표시 확인.

  ```bash
  pnpm typecheck
  ```

---

### Task 6: i18n 문구 추가

**Files:**
- Modify: `packages/ui/src/i18n/locales/en/common.json`
- Modify: `packages/ui/src/i18n/locales/ko/common.json`

- [ ] **Step 1: en/common.json에 신규 키 추가**

  ```json
  {
    "run": {
      "delete": "Delete run",
      "filterAll": "All",
      "filterCompleted": "Completed",
      "filterFailed": "Failed",
      "filterCancelled": "Cancelled"
    },
    "workflow": {
      "rename": "Click to rename",
      "description": "Description",
      "unsavedChanges": "Unsaved changes",
      "leaveConfirm": "You have unsaved changes. Leave without saving?",
      "leave": "Leave"
    },
    "block": {
      "addParam": "Add parameter",
      "removeParam": "Remove",
      "params": "Parameters"
    },
    "memory": {
      "title": "Memory",
      "new": "New Memory",
      "delete": "Delete memory",
      "types": { "user": "User", "session": "Session", "skill": "Skill", "reference": "Reference" },
      "enabled": "Active",
      "disabled": "Inactive"
    },
    "common": {
      "loadMore": "Load more",
      "stay": "Stay"
    }
  }
  ```

- [ ] **Step 2: ko/common.json에 한국어 번역 추가**

  ```json
  {
    "run": {
      "delete": "실행 삭제",
      "filterAll": "전체",
      "filterCompleted": "완료",
      "filterFailed": "실패",
      "filterCancelled": "취소됨"
    },
    "workflow": {
      "rename": "클릭해서 이름 변경",
      "description": "설명",
      "unsavedChanges": "미저장 변경사항",
      "leaveConfirm": "저장하지 않은 변경사항이 있습니다. 저장하지 않고 나가시겠습니까?",
      "leave": "나가기"
    },
    "block": {
      "addParam": "파라미터 추가",
      "removeParam": "삭제",
      "params": "파라미터"
    },
    "memory": {
      "title": "메모리",
      "new": "새 메모리",
      "delete": "메모리 삭제",
      "types": { "user": "사용자", "session": "세션", "skill": "스킬", "reference": "참고" },
      "enabled": "활성",
      "disabled": "비활성"
    },
    "common": {
      "loadMore": "더 보기",
      "stay": "머물기"
    }
  }
  ```

---

### Task 7: Memory 시스템 구현 (OD §16 이식)

**Files:**
- Create: `packages/shared/src/types/memory.ts`
- Create: `apps/server/src/lib/memory-store.ts`
- Create: `apps/server/src/routes/memory.ts`
- Create: `apps/desktop/src/pages/Memory.tsx`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/desktop/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/engine.ts`
- Modify: `packages/workflow-engine/src/nodes/agent.ts`

- [ ] **Step 1: `packages/shared/src/types/memory.ts` 신규 생성**

  3.6 섹션의 `MemoryItem`, `CreateMemoryInput`, `UpdateMemoryInput` 타입 정의.

- [ ] **Step 2: `packages/shared/src/index.ts`에 memory 타입 export**

  ```typescript
  export * from './types/memory.js';
  ```

- [ ] **Step 3: `apps/server/src/lib/memory-store.ts` 신규 생성**

  - `MEMORY_DIR = join(homedir(), '.config', 'neos-work', 'memory')`
  - `ensureMemoryDir()`, `listMemories()`, `getMemory(id)`, `createMemory(data)`, `updateMemory(id, data)`, `deleteMemory(id)`, `toggleMemory(id, enabled)`, `exportMemoryContext()`
  - 파일명: `{type}_{nanoid8}.md`
  - YAML frontmatter 파싱은 경량 방식 (regex-based, `gray-matter` 추가 없이 직접 파싱)

- [ ] **Step 4: `apps/server/src/routes/memory.ts` 신규 생성**

  Hono router — 3.6 섹션의 API 표 구현.

- [ ] **Step 5: `apps/server/src/index.ts`에 memory route 등록**

  ```typescript
  import { memory } from './routes/memory.js';
  app.route('/api', memory);
  ```

- [ ] **Step 6: `apps/desktop/src/lib/engine.ts`에 memory 메서드 추가**

  - `listMemories()`, `createMemory(data)`, `updateMemory(id, data)`, `deleteMemory(id)`, `toggleMemory(id, enabled)`, `exportMemoryContext()`

- [ ] **Step 7: AgentNode에 memory 주입 연동 (`packages/workflow-engine/src/nodes/agent.ts`)**

  `NodeContext`에서 `serverUrl`/`authToken` 접근이 가능한지 확인 후 `buildSystemPromptWithMemory()` 호출.

- [ ] **Step 8: `apps/desktop/src/pages/Memory.tsx` 신규 생성**

  3.6 섹션의 UI 설계 구현.

- [ ] **Step 9: Sidebar에 Memory 항목 추가**

  기존 항목 사이 적절한 위치(Skills 아래 또는 Sessions 아래)에 추가.

- [ ] **Step 10: App.tsx에 `/memory` 라우트 등록**

- [ ] **Step 11: `pnpm typecheck` 통과**

---

### Task 8: 다중 LLM 프로바이더 확장 (OD §21 이식)

**Files:**
- Create: `packages/core/src/llm/openai.ts`
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/core/src/llm/index.ts`
- Modify: `apps/desktop/src/pages/Settings.tsx`
- Modify: `apps/desktop/src/components/workflow/NodeConfigPanel.tsx`
- Modify: `packages/workflow-engine/src/nodes/agent.ts`

- [ ] **Step 1: `packages/shared/src/models.ts`에 OpenAI/Ollama 모델 추가**

  `OPENAI_MODELS`, `OLLAMA_PRESET_MODELS` 배열 추가 및 `ALL_MODELS`에 포함.

- [ ] **Step 2: `packages/core/src/llm/openai.ts` 신규 생성**

  3.7 섹션의 `OpenAIAdapter` 구현 (chat + stream). Ollama는 baseUrl 변경만으로 재사용.

- [ ] **Step 3: `packages/core/src/llm/index.ts`에 export 추가**

  ```typescript
  export { OpenAIAdapter } from './openai.js';
  ```

- [ ] **Step 4: `apps/desktop/src/pages/Settings.tsx`에 프로바이더 설정 추가**

  OpenAI API key, OpenAI base URL, Ollama base URL 입력 섹션 추가.

- [ ] **Step 5: `NodeConfigPanel.tsx`에 provider + model 선택 추가**

  Agent 노드 선택 시 provider `<select>` → 해당 provider 모델 목록을 model `<select>`에 자동 반영.

- [ ] **Step 6: `AgentNode`에서 provider config 읽기**

  `ctx.config.provider`가 있으면 해당 adapter 생성. 없으면 기존 동작(anthropic) 유지.

- [ ] **Step 7: `pnpm typecheck` 통과**

---

### Task 9: SKILL.md 스펙 확장 (OD §9 이식)

**Files:**
- Modify: `packages/shared/src/types/skill.ts` (또는 해당 타입 파일)
- Modify: `packages/core/src/skills/parser.ts`
- Modify: `apps/desktop/src/pages/Skills.tsx`

- [ ] **Step 1: `SkillManifest` 타입에 확장 필드 추가**

  3.8 섹션의 타입 정의 (`triggers`, `mode`, `platform`, `category`, `featured`, `examplePrompt`, `designSystemRequired`, `fidelity`, `version`).

- [ ] **Step 2: `parser.ts`에 확장 필드 파싱 추가**

  3.8 섹션의 파싱 로직 구현.

- [ ] **Step 3: `Skills.tsx` UI 개선**

  - `mode` 배지 추가 (색상 구분)
  - `triggers` 표시
  - `featured` 기준 정렬 (undefined → 뒤로)
  - `category` 필터 버튼 (발견된 category 목록 자동 생성)
  - `examplePrompt` 있으면 "Try" 버튼

- [ ] **Step 4: `pnpm typecheck` 통과**

---

## 6. 검증 기준

### Part A — 에디터·이력 UX

| 항목 | 검증 방법 |
|------|-----------|
| RunDetailPanel durationMs | 워크플로우 실행 후 History 탭 → run 클릭 → 완료 노드에 `123ms` 형식 소요시간 표시 |
| RunDetailPanel label | 완료 노드 행에 UUID 대신 노드 이름(`Trigger`, `Price Lookup` 등) 표시 |
| RunHistoryPanel 소요시간 | 각 run 카드에 총 소요시간 표시 (`1.3s`, `250ms` 등) |
| Run 필터 | `[Failed]` 클릭 시 실패한 run만 표시 |
| Run 삭제 | run 카드 ✕ 클릭 → 목록에서 제거, DB 삭제 확인 |
| 더 보기 | 20개 초과 run이 있을 때 "더 보기" 버튼 표시 및 추가 로드 |
| 이름 인라인 편집 | 툴바 이름 클릭 → input 전환 → Enter/blur 후 이름 변경 반영 |
| 이름 편집 취소 | Escape 키 → 기존 이름 유지 |
| Description 편집 | 노드 미선택 상태에서 Config 탭 → description textarea 편집 → Save → 서버에 반영 |
| useBlocker | dirty 상태에서 `← Workflows` 클릭 → 모달 표시 |
| useBlocker — Stay | 모달에서 "머물기" → 에디터 유지, dirty 상태 보존 |
| useBlocker — Leave | 모달에서 "나가기" → Workflows 목록으로 이동 |
| paramDefs 편집 | Blocks 페이지 → 커스텀 블록 생성 → 파라미터 2개 추가 → 저장 → 워크플로우 에디터에서 해당 블록 선택 시 BlockParamForm에 파라미터 표시 |

### Part B — Open Design 마이그레이션

| 항목 | 검증 방법 |
|------|-----------|
| Memory 생성 | Memory 페이지 → New Memory → 저장 → `~/.config/neos-work/memory/` 에 파일 생성 확인 |
| Memory 토글 | disabled 항목은 `/api/memory/export` 응답에 포함되지 않음 확인 |
| Memory 에이전트 주입 | Memory에 항목 있을 때 AgentNode 실행 → 시스템 프롬프트에 memory 내용 포함됨 |
| Memory 삭제 | 삭제 후 파일도 삭제 확인 |
| OpenAI 모델 선택 | Settings에 OpenAI key 입력 → NodeConfigPanel에서 gpt-4o 선택 → 에이전트 노드 실행 성공 |
| Ollama 모델 선택 | Ollama 로컬 실행 중 → Settings에 base URL 입력 → llama3.3 선택 → 실행 성공 |
| SKILL.md triggers | triggers 필드가 있는 SKILL.md → Skills 페이지에서 해당 triggers 표시 |
| SKILL.md category 필터 | category별 버튼 클릭 → 해당 skill만 표시 |
| SKILL.md mode 배지 | mode 필드 있는 skill → 카드에 배지 표시 |

### 공통 검증

| 항목 | 검증 방법 |
|------|-----------|
| 타입체크 | `pnpm typecheck` — 0 type errors |
| 빌드 | `pnpm build` — successful |

---

## 7. Open Design 마이그레이션 전체 로드맵

v0.2.4에서 이식하는 기능은 1단계이다. 이후 버전에서 다음을 이식한다.

### v0.3.0 — Design Context & Routine (OD §10, §15 이식)

- **Design Context Layer (DESIGN.md)**
  - `~/.config/neos-work/design-systems/<name>/DESIGN.md` 스캔·파싱
  - 워크플로우 실행 시 선택된 Design System을 AgentNode 시스템 프롬프트 앞에 주입
  - `apps/server/src/routes/design-systems.ts` 신규
  - `apps/desktop/src/pages/DesignSystems.tsx` 신규

- **Routine/Scheduler (cron 기반 반복 실행)**
  - `{ kind: 'hourly'|'daily'|'weekly', time?, timezone?, weekday? }` 스케줄 설정
  - DB 테이블: `workflow_schedules`, `schedule_claims` (중복 실행 방지)
  - API: `POST /api/workflow/:id/schedule`, `DELETE /api/workflow/:id/schedule`
  - WorkflowEditor 툴바에 "Schedule" 버튼 추가

- **병렬 브랜치 · 진짜 OR 게이트**
- **코딩 도메인 내장 블록** (`code_eval`, `file_read`, `git_diff`, `test_runner`)

### v0.4.0 — 외부 Agent CLI & Artifact Preview (OD §5, §4.1 이식)

- **외부 에이전트 CLI spawn**
  - PATH에서 Claude Code, Codex, Gemini CLI 자동 탐색
  - spawn + stdio 스트림 → SSE 이벤트로 변환
  - Settings에 "Detected Agents" 섹션 추가

- **Artifact Preview (iframe)**
  - AgentNode output이 HTML이면 `<iframe sandbox>` 인라인 렌더링
  - WorkflowEditor 우측 패널에 "Preview" 탭 추가

- **워크플로우 버전 이력** (편집 전 자동 스냅샷)

### v0.5.0 — Plugin/Marketplace (OD §11 이식)

- Block/Skill 시스템을 Plugin 개념으로 통합
- `open-design.json` sidecar 지원
- Atom pipeline (discovery → plan → execute → critique)
- GenUI surface (form, choice, confirmation)
- Plugin snapshot (replay 재현성)
- 마켓플레이스 카탈로그 (registry manifest)

### v0.6.0 — Media Generation & Deploy (OD §13, §19 이식)

- Image/Video/Audio 생성 노드 (DALL-E, Stability AI, ElevenLabs TTS)
- Vercel deploy 노드
- Cloudflare Pages deploy 노드
- GitHub Actions trigger 노드

---

## 8. 남은 기타 과제 (v0.3.0 예정)

- **에이전트 노드 스트리밍 진행상황**: 실행 중 LLM 스트리밍 텍스트를 Run Log에 실시간 표시
- **노드 자동 레이아웃**: "Auto Layout" 버튼으로 노드 배치 자동 정렬
- **Webhook 트리거**: HTTP POST로 워크플로우 트리거
- **MCP OAuth 2.0**: MCP 서버 연결 시 OAuth 인증 흐름 지원 (OD §8 이식)
