/**
 * Research domain pack — MVP web investigator + synthesizer (PLAN_FOR_V0_4_0 Q4).
 */

import type { DomainWorker } from '@neos-work/shared';

/** Research pack owns no native blocks in v0.4 MVP (uses web_search tools). */
export const RESEARCH_BLOCK_IDS = [] as const;

export const RESEARCH_WORKERS: DomainWorker[] = [
  {
    id: 'research_web',
    name: '웹 조사원',
    domain: 'research',
    isBuiltIn: true,
    description: '웹 검색으로 출처를 수집하고 사실 기반 조사 노트를 작성합니다.',
    systemPrompt: `당신은 웹 조사 전문 AI 에이전트입니다.
목표에 맞는 정보를 검색·수집하고 다음 JSON으로 반환하세요:
{
  "querySummary": "조사 질문 요약",
  "findings": [{ "claim": "...", "source": "URL 또는 제목", "confidence": 0.0~1.0 }],
  "openQuestions": ["추가 확인이 필요한 항목"],
  "sources": ["출처 목록"]
}
출처 없는 주장은 confidence를 낮추고 openQuestions에 넣으세요.`,
    allowedTools: ['web_search', 'read_file'],
    permissionProfile: 'network',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    outputSchema: {
      type: 'object',
      required: ['querySummary', 'findings', 'sources'],
    },
    constraints: { maxSteps: 12, timeoutMs: 180_000 },
  },
  {
    id: 'research_synthesizer',
    name: '조사 합성기',
    domain: 'research',
    isBuiltIn: true,
    description: '여러 조사 결과를 합성해 일관된 브리핑을 만듭니다. 코디네이터 하위 합성 단계용.',
    systemPrompt: `당신은 리서치 합성 전문 AI 에이전트입니다.
여러 조사 노트·findings를 입력으로 받아 모순을 정리하고 다음 JSON을 반환하세요:
{
  "brief": "경영진용 요약",
  "keyPoints": ["핵심 포인트"],
  "conflicts": ["상충되는 주장과 해석"],
  "recommendedNextSteps": ["후속 조사 또는 실행 항목"],
  "confidence": 0.0~1.0
}
새 웹 검색보다 입력 합성에 집중하세요. 근거가 약한 결론은 confidence를 낮추세요.`,
    allowedTools: ['read_file'],
    permissionProfile: 'read_only',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    outputSchema: {
      type: 'object',
      required: ['brief', 'keyPoints', 'recommendedNextSteps', 'confidence'],
    },
    constraints: { maxSteps: 10, timeoutMs: 120_000 },
  },
];
