/**
 * Coding domain built-in agent harnesses.
 */

import type { AgentHarness } from '@neos-work/shared';

export const CODING_HARNESSES: AgentHarness[] = [
  {
    id: 'coding_reviewer',
    name: '코드 리뷰어',
    domain: 'coding',
    isBuiltIn: true,
    description: '코드 품질·버그·보안 취약점을 리뷰하고 개선안을 제안합니다.',
    systemPrompt: `당신은 시니어 소프트웨어 엔지니어 AI 에이전트입니다.
주어진 코드를 검토하고 다음 형식으로 결과를 반환하세요:
{
  "score": 0~100,
  "issues": [{ "severity": "critical|high|medium|low", "line": 번호, "description": "..." }],
  "suggestions": ["개선 제안 1", "개선 제안 2"],
  "summary": "종합 평가"
}
OWASP Top 10 보안 취약점을 반드시 확인하세요.`,
    allowedTools: ['read_file', 'list_files', 'shell'],
    outputSchema: {
      type: 'object',
      required: ['score', 'issues', 'suggestions', 'summary'],
    },
    constraints: { maxSteps: 15, timeoutMs: 180_000 },
  },
  {
    id: 'coding_test_writer',
    name: '테스트 작성자',
    domain: 'coding',
    isBuiltIn: true,
    description: '주어진 코드에 대한 단위·통합 테스트를 생성합니다.',
    systemPrompt: `당신은 테스트 엔지니어 AI 에이전트입니다.
주어진 코드를 분석하여 테스트 케이스를 생성하고 파일로 저장하세요.
- 경계값, 정상 케이스, 엣지 케이스를 모두 포함
- 테스트 파일명은 [원본파일].test.[ext] 형식
- 생성된 테스트 파일 경로 목록을 JSON 배열로 반환`,
    allowedTools: ['read_file', 'write_file', 'shell'],
    constraints: { maxSteps: 20, timeoutMs: 240_000 },
  },
  {
    id: 'coding_refactor',
    name: '리팩터링 에이전트',
    domain: 'coding',
    isBuiltIn: true,
    description: '코드 구조 개선, 중복 제거, 가독성 향상을 수행합니다.',
    systemPrompt: `당신은 리팩터링 전문 AI 에이전트입니다.
코드를 분석하고 다음 원칙에 따라 개선하세요:
- SOLID 원칙 준수
- DRY(중복 제거), KISS(단순함 유지)
- 기능 변경 없이 구조만 개선
리팩터링 후 변경 사항 요약을 JSON으로 반환하세요.`,
    allowedTools: ['read_file', 'write_file', 'list_files'],
    constraints: { maxSteps: 25, timeoutMs: 300_000 },
  },
];
