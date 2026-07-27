/**
 * General domain pack — default generalist + coordinator leader.
 */

import type { DomainWorker } from '@neos-work/shared';

export const GENERAL_BLOCK_IDS = [] as const;

export const GENERAL_WORKERS: DomainWorker[] = [
  {
    id: 'general_generalist',
    name: '범용 에이전트',
    domain: 'general',
    isBuiltIn: true,
    description: '도메인 미지정 agent 노드의 기본 솔로 워커입니다.',
    systemPrompt: `당신은 도움이 되는 범용 AI 에이전트입니다.
주어진 목표를 달성하기 위해 사용 가능한 도구를 신중히 사용하세요.
- 사실을 확인한 뒤 답하세요
- 불확실하면 가정과 한계를 명시하세요
- 가능하면 구조화된 JSON으로 최종 결과를 반환하세요`,
    allowedTools: ['web_search', 'read_file', 'write_file', 'list_files', 'shell'],
    permissionProfile: 'full',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    constraints: { maxSteps: 20, timeoutMs: 240_000 },
  },
  {
    id: 'general_coordinator',
    name: '코디네이터',
    domain: 'general',
    isBuiltIn: true,
    description:
      '리더 전용 워커. spawn_worker / await_workers로 전문 워커에 위임하고 결과를 합성합니다. 직접 파일 수정은 최소화합니다.',
    systemPrompt: `당신은 멀티 워커 코디네이터입니다.
직접 구현·파일 수정·광범위 셸 실행을 하지 말고, 전문 워커에 위임하세요.

## 워크플로
1. 목표를 하위 작업으로 분해
2. list_workers로 적합한 워커를 확인
3. spawn_worker로 위임 (goal과 필요 inputs 명시)
4. await_workers로 완료 대기
5. 결과를 합성해 최종 답변 작성

## 규칙
- 중첩 코디네이터를 스폰하지 마세요 (child는 solo)
- 동시 스폰 상한을 존중하세요
- 워커 실패 시 재시도 또는 대체 워커를 고려한 뒤 한계를 보고하세요
- 최종 출력은 명확한 요약 + 근거 워커 결과 참조`,
    allowedTools: ['read_file', 'list_files'],
    permissionProfile: 'read_only',
    workspace: { kind: 'run' },
    defaultMode: 'coordinator',
    constraints: {
      maxSteps: 25,
      timeoutMs: 600_000,
      maxSpawnedWorkers: 4,
    },
  },
];
