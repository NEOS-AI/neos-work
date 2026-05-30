# NEOS Work v0.2.3 — 워크플로우 관찰력 향상 & 관리 편의 개선 구현 계획

> **기준 버전**: v0.2.2 (Dev DX 개선 및 워크플로우 실행 UX 향상)
> **작성일**: 2026-05-30
> **목표**: v0.2.2에서 완전히 마무리되지 않은 기술 부채(durationMs)를 해소하고, 일상적인 워크플로우 관리 과정에서 반복적으로 필요한 복제·내보내기/가져오기·에디터 UX를 개선한다.

---

## 1. 배경 및 현재 상태

v0.2.2는 Dev Auth Token, 프론트엔드 컴포넌트 테스트, Trigger 런타임 입력 주입, 실행 이력 노드 출력 상세 보기를 완료했다.

그러나 코드를 검토하면 다음 공백이 남아 있다.

### 1.1 기술 부채

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| `durationMs` 미완성 | `WorkflowSSEEvent.node.completed` 타입에 `durationMs` 필드 없음 | `RunDetailPanel`이 durationMs를 표시하려 하지만 데이터가 없어 항상 공란 |
| `nodeResults` durationMs 미저장 | `workflow.ts` onEvent 핸들러가 `{ status, output }`만 저장 | DB에서 run 상세 조회 시 소요시간 복원 불가 |
| 에디터 dirty 상태 없음 | 노드/엣지 변경 후 저장 전 상태 표시 없음 | 저장하지 않고 실행하거나 이탈해도 경고 없음 |

### 1.2 실사용 UX 공백

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| 워크플로우 복제 없음 | 목록 카드에 삭제 버튼만 있음 | 유사한 워크플로우를 만들 때 처음부터 다시 작성해야 함 |
| 내보내기/가져오기 없음 | 워크플로우 JSON을 파일로 공유하는 방법 없음 | 팀원 간 워크플로우 공유 불가 |
| 실행 로그 nodeId 노출 | Run Log가 `node.completed ✓ abc1234-...` 형식으로 표시 | 노드 label(사람이 읽기 좋은 이름) 없이 UUID만 보임 |

v0.2.3은 이 다섯 항목을 해결한다.

---

## 2. 목표와 비목표

### 목표

1. `node.completed` SSE 이벤트에 `durationMs`를 포함하고 DB까지 저장하여 `RunDetailPanel`에서 소요시간을 표시한다.
2. 워크플로우 목록에서 한 클릭으로 복제본을 만들 수 있다.
3. 워크플로우를 JSON 파일로 내보내고 가져올 수 있다.
4. 에디터에서 미저장 변경사항이 있을 때 툴바에 표시하고 이탈 시 경고한다.
5. 실행 로그에 nodeId 대신 node label을 표시하고, 완료된 노드의 출력 요약을 inline으로 볼 수 있다.

### 비목표

- Webhook / 스케줄 트리거 (v0.3.0 예정)
- 병렬 실행 · 진짜 OR 게이트 semantics (v0.3.0 예정)
- 코딩 도메인 내장 블록 구현 (v0.3.0 예정)
- 전체 E2E 테스트 인프라
- 워크플로우 버전 이력(revision history)

---

## 3. 제품 설계

### 3.1 durationMs 완성

#### 현재 흐름

```
executor.ts
  → result.durationMs 계산함 (BlockNode, AgentNode 등에서 Date.now() 차이)
  → onEvent({ type: 'node.completed', nodeId, output })  ← durationMs 빠짐

workflow.ts (server route)
  → nodeResults[nodeId] = { status: 'completed', output }  ← durationMs 안 저장

RunDetailPanel
  → nr.durationMs ?? '' 표시  ← 항상 공란
```

#### 목표 흐름

```
WorkflowSSEEvent (shared/src/types/api.ts)
  node.completed: { nodeId, output, durationMs: number }  ← 추가

executor.ts
  → onEvent({ type: 'node.completed', nodeId, output, durationMs: result.durationMs })

workflow.ts (server route)
  → nodeResults[nodeId] = { status: 'completed', output, durationMs }  ← 저장

engine.ts (desktop, 로컬 타입 미러)
  WorkflowSSEEvent.node.completed: { nodeId, output, durationMs?: number }

RunDetailPanel
  → `${nr.durationMs}ms` 정상 표시
```

> **TriggerNode·OutputNode·AndGateNode·OrGateNode** 등 간단한 게이트 노드는 `durationMs: 0`을 이미 반환하므로 추가 작업 없음.

---

### 3.2 워크플로우 복제 (Duplicate)

#### API

```
POST /api/workflow/:id/duplicate
→ 201 { ok: true, data: Workflow }   (새 워크플로우, id·name·createdAt 새로 할당)
```

복제 규칙:
- `name`: `"${원본 이름} (copy)"` 으로 설정
- `nodes`, `edges`: 원본 그대로 복사
- `domain`, `description`: 원본 그대로
- `id`, `createdAt`, `updatedAt`: 새로 생성

#### UI

`Workflows.tsx` 워크플로우 카드 하단에 복제 버튼(⧉) 추가.

```
[워크플로우 이름]
...
[⧉ 복제]  [× 삭제]
```

복제 성공 시 목록을 다시 불러온다.

---

### 3.3 워크플로우 내보내기/가져오기

#### 내보내기 (Export)

```
GET /api/workflow/:id/export
→ 200 Content-Type: application/json
   { version: "1", exportedAt, workflow: { name, description, domain, nodes, edges } }
```

클라이언트에서는 Blob → `<a download>` 패턴으로 파일 저장.

#### 가져오기 (Import)

```
POST /api/workflow/import
body: { version: "1", exportedAt, workflow: { name, description, domain, nodes, edges } }
→ 201 { ok: true, data: Workflow }
```

서버는 `workflow.name`을 그대로 사용하고, 이미 같은 이름이 있으면 `"${name} (imported)"` 로 suffix 추가.

> **보안 원칙**: import body는 `name`(최대 200자)·`domain`·`nodes`·`edges`만 신뢰한다. 내보내기 포맷의 `version`은 `"1"`만 허용하고 그 외는 400 반환.

#### UI

- `WorkflowEditor.tsx` 툴바에 ⬇ Export 버튼 추가 (저장 버튼 옆).
- `Workflows.tsx` 헤더에 📥 Import 버튼 추가. 클릭 시 `<input type="file" accept=".json">` 열림 → 파일 읽기 → `importWorkflow()` 호출 → 성공 시 새 워크플로우로 이동.

---

### 3.4 에디터 미저장 변경사항 표시

#### Dirty 감지

`WorkflowEditor.tsx`에서 `draft`(편집 중 상태)와 `savedDraft`(마지막 저장 시점 스냅샷)를 비교한다.

```typescript
// 마지막으로 서버에 저장된 draft 스냅샷
const [savedDraft, setSavedDraft] = useState<ReturnType<typeof buildWorkflowDraft> | null>(null);

// 워크플로우 로드 직후 savedDraft 초기화
// handleSave 성공 후 savedDraft 갱신

const isDirty = useMemo(() => {
  if (!savedDraft) return false;
  return JSON.stringify(draft) !== JSON.stringify(savedDraft);
}, [draft, savedDraft]);
```

#### Dirty 표시

툴바 워크플로우 이름 옆에 `•` 점(unsaved indicator) 표시:

```tsx
<span className="mx-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
  {workflow.name}
  {isDirty && <span className="ml-1 text-yellow-400" title="Unsaved changes">•</span>}
</span>
```

#### 이탈 경고

`useEffect`로 `window.addEventListener('beforeunload', ...)` 등록:

```typescript
useEffect(() => {
  if (!isDirty) return;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [isDirty]);
```

> React Router의 `useBlocker`는 SPA 내부 이동에 사용하면 더 정확하나, v0.2.3에서는 `beforeunload`만으로 충분하다.

---

### 3.5 실행 로그 UX 개선

#### 노드 label 표시

`WorkflowEditor.tsx`의 Run Log 렌더링에서 `nodeId`를 워크플로우 노드의 `label`로 교체한다.

```typescript
// nodeId → label 변환 맵
const nodeLabelMap = useMemo(() => {
  const map: Record<string, string> = {};
  for (const n of nodes) {
    map[n.id] = String(n.data.label ?? n.id);
  }
  return map;
}, [nodes]);
```

Run Log 항목 예시 (변경 전 → 변경 후):
- `✓ 9f3a1c2b-...` → `✓ Price Lookup`
- `▶ 9f3a1c2b-... (block)` → `▶ Price Lookup (block)`
- `✗ 9f3a1c2b-...: blockId required` → `✗ Price Lookup: blockId required`

#### 완료 노드 출력 요약 inline 표시

`node.completed` 이벤트에서 `output`이 있을 경우, 행을 클릭하면 inline으로 JSON 미리보기를 펼친다 (최대 200자 잘림).

```tsx
const [expandedEventIdx, setExpandedEventIdx] = useState<number | null>(null);

// 항목 클릭 시 toggle
// output preview: JSON.stringify(ev.output, null, 2).slice(0, 200)
```

---

## 4. 파일 맵

### 신규 파일

| 파일 | 책임 |
|------|------|
| _(없음)_ | 모든 변경은 기존 파일 수정 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `packages/shared/src/types/api.ts` | `WorkflowSSEEvent.node.completed`에 `durationMs: number` 추가 |
| `packages/workflow-engine/src/executor.ts` | `onEvent` 호출 시 `durationMs: result.durationMs` 포함 |
| `packages/workflow-engine/src/executor.test.ts` | `node.completed` 이벤트에 `durationMs` 포함 검증 테스트 추가 |
| `apps/server/src/routes/workflow.ts` | onEvent 핸들러에서 `nodeResults[nodeId].durationMs` 저장; `POST /:id/duplicate` 추가; `GET /:id/export` 추가; `POST /import` 추가 |
| `apps/server/src/db/workflows.ts` | `duplicateWorkflow(id)` 헬퍼 추가 |
| `apps/desktop/src/lib/engine.ts` | 로컬 `WorkflowSSEEvent` 타입에 `durationMs?: number` 추가; `duplicateWorkflow(id)` 메서드 추가; `exportWorkflow(id)` 메서드 추가; `importWorkflow(data)` 메서드 추가 |
| `apps/desktop/src/pages/Workflows.tsx` | 워크플로우 카드에 복제 버튼 추가; Import 버튼 추가 |
| `apps/desktop/src/pages/WorkflowEditor.tsx` | `savedDraft` 상태 추가; `isDirty` 계산; 툴바에 dirty 점 표시; `beforeunload` 등록; Export 버튼 추가; Run Log에 node label 및 출력 inline 미리보기 |
| `apps/desktop/src/components/workflow/RunDetailPanel.tsx` | `durationMs` 표시 (데이터가 실제로 오면 자동으로 동작하나 null-safe 처리 확인) |
| `packages/ui/src/i18n/locales/en/common.json` | duplicate, export, import 관련 문구 추가 |
| `packages/ui/src/i18n/locales/ko/common.json` | duplicate, export, import 관련 문구 추가 |
| `docs/implementation/v0.2.3.md` | 구현 완료 후 실제 변경 사항 기록 |

---

## 5. Task별 구현 계획

### Task 1: durationMs 완성

**Files:**
- Modify: `packages/shared/src/types/api.ts`
- Modify: `packages/workflow-engine/src/executor.ts`
- Modify: `packages/workflow-engine/src/executor.test.ts`
- Modify: `apps/server/src/routes/workflow.ts`
- Modify: `apps/desktop/src/lib/engine.ts`

- [ ] **Step 1: shared 타입에 durationMs 추가**

  ```typescript
  // packages/shared/src/types/api.ts
  export type WorkflowSSEEvent =
    | { type: 'run.started'; runId: string }
    | { type: 'node.started'; nodeId: string; nodeType: NodeType }
    | { type: 'node.completed'; nodeId: string; output: unknown; durationMs: number }  // 추가
    | { type: 'node.failed'; nodeId: string; error: string }
    | { type: 'run.completed'; runId: string; duration: number }
    | { type: 'run.failed'; runId: string; error: string };
  ```

- [ ] **Step 2: executor에서 durationMs 이벤트에 포함**

  `packages/workflow-engine/src/executor.ts`의 `onEvent` 호출 부분:

  ```typescript
  if (result.ok) {
    onEvent({ type: 'node.completed', nodeId: node.id, output, durationMs: result.durationMs });
  } else {
    failedNodes.add(node.id);
    onEvent({ type: 'node.failed', nodeId: node.id, error: result.error ?? 'Unknown error' });
  }
  ```

- [ ] **Step 3: server route에서 durationMs 저장**

  `apps/server/src/routes/workflow.ts`의 onEvent 핸들러:

  ```typescript
  if (event.type === 'node.completed') {
    nodeResults[event.nodeId] = {
      status: 'completed',
      output: event.output,
      durationMs: event.durationMs,  // 추가
    };
  }
  ```

- [ ] **Step 4: desktop engine.ts 로컬 타입 미러 업데이트**

  ```typescript
  export type WorkflowSSEEvent =
    | { type: 'run.started'; runId: string }
    | { type: 'node.started'; nodeId: string; nodeType: string }
    | { type: 'node.completed'; nodeId: string; output: unknown; durationMs?: number }  // 추가
    | { type: 'node.failed'; nodeId: string; error: string }
    | { type: 'run.completed'; runId: string; duration: number }
    | { type: 'run.failed'; runId: string; error: string };
  ```

- [ ] **Step 5: executor 테스트에 durationMs 검증 추가**

  `packages/workflow-engine/src/executor.test.ts`에 케이스 추가:

  ```typescript
  it('node.completed 이벤트에 durationMs를 포함한다', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-duration',
      workflow: baseWorkflow({ /* trigger → output */ }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    const completed = events.filter((e) => e.type === 'node.completed');
    for (const ev of completed) {
      expect((ev as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    }
  });
  ```

- [ ] **Step 6: 검증**

  ```bash
  pnpm --filter @neos-work/workflow-engine test
  pnpm typecheck
  ```

---

### Task 2: 워크플로우 복제 (Duplicate)

**Files:**
- Modify: `apps/server/src/db/workflows.ts`
- Modify: `apps/server/src/routes/workflow.ts`
- Modify: `apps/desktop/src/lib/engine.ts`
- Modify: `apps/desktop/src/pages/Workflows.tsx`

- [ ] **Step 1: DB 헬퍼 추가**

  `apps/server/src/db/workflows.ts`:

  ```typescript
  export function duplicateWorkflow(id: string): Workflow | null {
    const src = getWorkflow(id);
    if (!src) return null;
    return createWorkflow({
      name: `${src.name} (copy)`,
      description: src.description,
      domain: src.domain,
      nodes: src.nodes,
      edges: src.edges,
    });
  }
  ```

- [ ] **Step 2: server route 추가**

  `apps/server/src/routes/workflow.ts`에 duplicate 엔드포인트 추가 (CRUD 섹션 하단):

  ```typescript
  workflow.post('/:id/duplicate', (c) => {
    const copy = db.duplicateWorkflow(c.req.param('id'));
    if (!copy) return c.json({ ok: false, error: 'Not found' }, 404);
    return c.json({ ok: true, data: copy }, 201);
  });
  ```

- [ ] **Step 3: engine.ts에 duplicateWorkflow 추가**

  ```typescript
  async duplicateWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/duplicate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return res.json();
  }
  ```

- [ ] **Step 4: Workflows.tsx 카드에 복제 버튼 추가**

  워크플로우 카드 하단 버튼 영역에 복제 버튼 추가:

  ```tsx
  const handleDuplicate = async (id: string) => {
    if (!client) return;
    const res = await client.duplicateWorkflow(id);
    if (res.ok) await loadWorkflows();
  };

  // 카드 내 버튼:
  <button
    onClick={(e) => { e.stopPropagation(); void handleDuplicate(wf.id); }}
    className="rounded px-2 py-0.5 text-xs"
    style={{ color: 'var(--text-muted)' }}
    title={t('workflow.duplicate')}
  >
    ⧉
  </button>
  ```

---

### Task 3: 워크플로우 내보내기/가져오기

**Files:**
- Modify: `apps/server/src/routes/workflow.ts`
- Modify: `apps/desktop/src/lib/engine.ts`
- Modify: `apps/desktop/src/pages/Workflows.tsx`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: server route — export 엔드포인트 추가**

  ```typescript
  workflow.get('/:id/export', (c) => {
    const wf = db.getWorkflow(c.req.param('id'));
    if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
    const payload = {
      version: '1',
      exportedAt: new Date().toISOString(),
      workflow: {
        name: wf.name,
        description: wf.description,
        domain: wf.domain,
        nodes: wf.nodes,
        edges: wf.edges,
      },
    };
    c.header('Content-Disposition', `attachment; filename="${wf.name.replace(/[^a-z0-9_-]/gi, '_')}.neos.json"`);
    return c.json(payload);
  });
  ```

- [ ] **Step 2: server route — import 엔드포인트 추가**

  ```typescript
  workflow.post('/import', async (c) => {
    const body = await c.req.json<{
      version?: string;
      workflow?: { name?: string; description?: string; domain?: string; nodes?: unknown[]; edges?: unknown[] };
    }>().catch(() => null);

    if (!body || body.version !== '1' || !body.workflow) {
      return c.json({ ok: false, error: 'Invalid import format or unsupported version' }, 400);
    }

    const wf = body.workflow;
    const name = typeof wf.name === 'string' && wf.name.length > 0
      ? wf.name.slice(0, 200)
      : 'Imported Workflow';

    const existing = db.listWorkflows().find((w) => w.name === name);
    const finalName = existing ? `${name} (imported)` : name;

    const created = db.createWorkflow({
      name: finalName,
      description: typeof wf.description === 'string' ? wf.description : undefined,
      domain: (['finance', 'coding', 'general'].includes(wf.domain as string) ? wf.domain : 'general') as 'finance' | 'coding' | 'general',
      nodes: (wf.nodes as never) ?? [],
      edges: (wf.edges as never) ?? [],
    });

    return c.json({ ok: true, data: created }, 201);
  });
  ```

  > **라우트 순서 주의**: `POST /import`가 `POST /:id/duplicate`보다 먼저 등록되어야 `"import"`가 `:id`로 매칭되지 않는다.

- [ ] **Step 3: engine.ts에 export/import 메서드 추가**

  ```typescript
  async exportWorkflow(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/export`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') ?? '';
    const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition);
    const filename = filenameMatch?.[1] ?? `workflow_${id.slice(0, 8)}.neos.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importWorkflow(
    data: { version: string; workflow: { name: string; description?: string; domain: string; nodes: unknown[]; edges: unknown[] } },
  ): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/import`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return res.json();
  }
  ```

- [ ] **Step 4: WorkflowEditor.tsx에 Export 버튼 추가**

  툴바의 Save 버튼 옆에 Export 버튼 추가:

  ```tsx
  <button
    onClick={() => client?.exportWorkflow(workflow.id)}
    className="rounded-lg px-3 py-1.5 text-xs font-medium"
    style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
    title={t('workflow.export')}
  >
    ⬇ {t('workflow.export')}
  </button>
  ```

- [ ] **Step 5: Workflows.tsx에 Import 버튼 추가**

  헤더의 "New" 버튼 옆에 Import 버튼 추가. 파일 선택 후 JSON 파싱 → `importWorkflow()` 호출:

  ```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await client.importWorkflow(data);
      if (res.ok && res.data) {
        navigate(`/workflows/${res.data.id}`);
      }
    } catch {
      // 파싱 또는 import 오류 처리
    } finally {
      e.target.value = '';
    }
  };

  // 렌더링:
  <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
  <button onClick={() => fileInputRef.current?.click()} ...>
    📥 {t('workflow.import')}
  </button>
  ```

---

### Task 4: 에디터 미저장 변경사항 표시

**Files:**
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: savedDraft 상태 추가**

  `WorkflowEditor`의 state에 추가:

  ```typescript
  const [savedDraft, setSavedDraft] = useState<ReturnType<typeof buildWorkflowDraft> | null>(null);
  ```

- [ ] **Step 2: 워크플로우 로드 후 savedDraft 초기화**

  `loadWorkflow()` 성공 콜백에서:

  ```typescript
  if (res.ok && res.data) {
    setWorkflow(res.data);
    const rfNodes = toReactFlowNodes(res.data, {});
    const rfEdges = toReactFlowEdges(res.data);
    setNodes(rfNodes);
    setEdges(rfEdges);
    // saved baseline 초기화
    setSavedDraft(buildWorkflowDraft(rfNodes, rfEdges));
  }
  ```

- [ ] **Step 3: 저장 성공 후 savedDraft 갱신**

  `handleSave()`에서:

  ```typescript
  const handleSave = async () => {
    if (!client || !workflow) return;
    setSaving(true);
    const res = await client.updateWorkflow(workflow.id, draft);
    if (res.ok && res.data) {
      setWorkflow(res.data);
      setSavedDraft(draft);  // 추가
    }
    setSaving(false);
    if (validationIssues.length > 0) setRightPanelTab('config');
  };
  ```

  `handleRun()`의 자동저장에서도 동일하게 갱신:

  ```typescript
  const saveRes = await client.updateWorkflow(workflow.id, draft);
  if (saveRes.ok && saveRes.data) {
    setWorkflow(saveRes.data);
    setSavedDraft(draft);  // 추가
  }
  ```

- [ ] **Step 4: isDirty 계산**

  ```typescript
  const isDirty = useMemo(() => {
    if (!savedDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(savedDraft);
  }, [draft, savedDraft]);
  ```

- [ ] **Step 5: 툴바에 dirty 표시 및 beforeunload 등록**

  툴바 이름 옆 점 표시:

  ```tsx
  <span className="mx-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
    {workflow.name}
    {isDirty && (
      <span className="ml-1 text-yellow-400 select-none" title="Unsaved changes">•</span>
    )}
  </span>
  ```

  beforeunload 효과:

  ```typescript
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  ```

---

### Task 5: 실행 로그 UX 개선

**Files:**
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: nodeLabelMap 계산**

  ```typescript
  const nodeLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of nodes) {
      map[n.id] = String(n.data.label ?? n.id);
    }
    return map;
  }, [nodes]);
  ```

- [ ] **Step 2: Run Log 렌더링에서 label 사용 및 출력 inline 미리보기 추가**

  Run Log 탭 렌더링 교체:

  ```tsx
  {rightPanelTab === 'run' && (
    <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
      {runEvents.map((ev, i) => {
        const nodeLabel = (ev as { nodeId?: string }).nodeId
          ? (nodeLabelMap[(ev as { nodeId: string }).nodeId] ?? (ev as { nodeId: string }).nodeId)
          : null;
        const isExpanded = expandedRunLogIdx === i;
        const hasOutput = ev.type === 'node.completed' && (ev as { output?: unknown }).output !== undefined;
        return (
          <div
            key={i}
            className={`rounded px-2 py-1 ${hasOutput ? 'cursor-pointer' : ''}`}
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            onClick={() => hasOutput && setExpandedRunLogIdx(isExpanded ? null : i)}
          >
            {ev.type === 'node.started' && `▶ ${nodeLabel} (${(ev as { nodeType: string }).nodeType})`}
            {ev.type === 'node.completed' && `✓ ${nodeLabel}${hasOutput ? ' ▸' : ''}`}
            {ev.type === 'node.failed' && `✗ ${nodeLabel}: ${(ev as { error: string }).error}`}
            {ev.type === 'run.started' && `Run ${(ev as { runId: string }).runId.slice(0, 8)}`}
            {ev.type === 'run.completed' && `${t('workflow.done')} (${(ev as { duration: number }).duration}ms)`}
            {ev.type === 'run.failed' && (ev as { error: string }).error}
            {isExpanded && hasOutput && (
              <pre className="mt-1 overflow-x-auto rounded p-1 text-[10px]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {JSON.stringify((ev as { output: unknown }).output, null, 2).slice(0, 200)}
              </pre>
            )}
          </div>
        );
      })}
      {runEvents.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>{t('workflow.noRuns')}</p>
      )}
    </div>
  )}
  ```

  새 state 추가:

  ```typescript
  const [expandedRunLogIdx, setExpandedRunLogIdx] = useState<number | null>(null);
  ```

  실행 시작 시 초기화:

  ```typescript
  setExpandedRunLogIdx(null);
  ```

---

## 6. 검증 기준

| 항목 | 검증 방법 |
|------|-----------|
| durationMs | `pnpm --filter @neos-work/workflow-engine test` — 새 케이스 포함 PASS; `RunDetailPanel`에서 소요시간 표시 확인 |
| 복제 | Workflows 목록에서 ⧉ 버튼 클릭 → `"(copy)"` suffix를 가진 새 워크플로우 목록에 나타남 |
| 내보내기 | WorkflowEditor에서 ⬇ 버튼 클릭 → `.neos.json` 파일 다운로드 |
| 가져오기 | 다운로드한 파일을 Workflows에서 📥 Import → 새 워크플로우 생성 |
| Import 보안 | `version: "2"` 또는 `version: null` body → 400 반환 |
| Dirty 표시 | 노드 이동 후 저장 전 → 툴바에 `•` 노란점 표시; 저장 후 → 사라짐 |
| beforeunload | dirty 상태에서 탭 닫기 시도 → 브라우저 이탈 확인 대화상자 |
| Run Log label | 실행 후 Run Log에서 UUID 대신 노드 label(`Price Lookup`, `Trigger` 등) 표시 |
| Run Log 출력 | `✓ Price Lookup ▸` 클릭 → 출력 JSON 미리보기 펼쳐짐 |
| 타입체크 | `pnpm typecheck` — 14 tasks successful (0 type errors) |
| 빌드 | `pnpm build` — successful |

---

## 7. 남은 과제 (v0.3.0 예정)

- **스케줄 트리거**: cron 표현식 기반 주기적 워크플로우 실행
- **병렬 브랜치 · 진짜 OR 게이트**: 복수 브랜치 동시 실행 후 "first wins" semantics
- **코딩 도메인 내장 블록**: `code_run`, `git_diff`, `test_runner` 등 코딩 도메인 native blocks
- **React Router useBlocker**: SPA 내부 이동 시에도 unsaved changes 경고
- **워크플로우 버전 이력**: 편집 전 자동 스냅샷 저장 및 복구
