/**
 * Finance domain built-in agent harnesses.
 */

import type { AgentHarness } from '@neos-work/shared';

export const FINANCE_HARNESSES: AgentHarness[] = [
  {
    id: 'finance_analyst',
    name: '금융 분석가',
    domain: 'finance',
    isBuiltIn: true,
    description: '시장·뉴스 데이터를 수집하고 투자 인사이트 JSON을 생성합니다.',
    systemPrompt: `당신은 금융 전문 AI 에이전트입니다.
주어진 데이터(뉴스, 시장 지표, 재무제표)를 분석하여 다음 형식의 JSON으로 결과를 반환하세요:
{
  "summary": "종합 요약",
  "insights": ["인사이트 1", "인사이트 2"],
  "sentiment": "bullish | bearish | neutral",
  "confidence": 0.0~1.0
}
사실에 근거하지 않은 추측은 명확히 구분하세요.`,
    allowedTools: ['web_search', 'read_file'],
    outputSchema: {
      type: 'object',
      required: ['summary', 'insights', 'sentiment', 'confidence'],
    },
    constraints: { maxSteps: 10, timeoutMs: 120_000 },
  },
  {
    id: 'finance_risk',
    name: '리스크 평가관',
    domain: 'finance',
    isBuiltIn: true,
    description: '포트폴리오 및 시나리오별 리스크를 평가하고 보고서를 작성합니다.',
    systemPrompt: `당신은 금융 리스크 관리 전문가 AI 에이전트입니다.
제공된 포트폴리오 또는 시나리오 데이터를 기반으로 리스크를 평가하고 다음 형식으로 반환하세요:
{
  "riskLevel": "low | medium | high | critical",
  "factors": [{ "name": "리스크 요인", "impact": "high | medium | low", "description": "..." }],
  "mitigations": ["완화 방안 1", "완화 방안 2"],
  "recommendation": "최종 권고 사항"
}`,
    allowedTools: ['web_search', 'read_file', 'write_file'],
    outputSchema: {
      type: 'object',
      required: ['riskLevel', 'factors', 'mitigations', 'recommendation'],
    },
    constraints: { maxSteps: 12, timeoutMs: 150_000 },
  },
];
