/**
 * Finance domain pack — built-in workers + block id ownership.
 */

import type { DomainWorker } from '@neos-work/shared';

export const FINANCE_BLOCK_IDS = [
  'price_lookup',
  'moving_average',
  'rsi',
  'macd',
  'portfolio_summary',
  'risk_report',
] as const;

export const FINANCE_WORKERS: DomainWorker[] = [
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
    permissionProfile: 'network',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    outputSchema: {
      type: 'object',
      required: ['summary', 'insights', 'sentiment', 'confidence'],
    },
    constraints: { maxSteps: 10, timeoutMs: 120_000 },
    preferredBlockIds: ['price_lookup', 'moving_average', 'rsi', 'macd'],
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
    permissionProfile: 'network',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    outputSchema: {
      type: 'object',
      required: ['riskLevel', 'factors', 'mitigations', 'recommendation'],
    },
    constraints: { maxSteps: 12, timeoutMs: 150_000 },
    preferredBlockIds: ['risk_report', 'portfolio_summary'],
  },
  {
    id: 'finance_chart_analyst',
    name: '차트 분석가 (TradingView)',
    domain: 'finance',
    isBuiltIn: true,
    description:
      'TradingView MCP로 라이브 차트를 읽고 시황·레벨·지표를 분석합니다. ' +
      'Settings → MCP에서 TradingView 프리셋을 추가하고 Desktop을 디버그 포트로 실행해야 합니다.',
    systemPrompt: `당신은 TradingView Desktop에 연결된 금융 차트 분석 에이전트입니다.

## 필수 준비
- MCP 서버 "TradingView"가 활성화되어 있어야 합니다 (Settings → MCP Servers).
- TradingView Desktop이 \`--remote-debugging-port=9222\` 로 실행 중이어야 합니다.
- 실제 차트 탭이 열려 있어야 합니다 (환영 화면만 있으면 실패합니다).

## 도구 사용 순서
1. \`tv_health_check\` (또는 동등한 health 도구)로 cdp_connected / api_available 확인
2. 현재 심볼·타임프레임·가격: chart/quote/state 계열 도구
3. 지표·레벨: study values, pine lines/labels/tables
4. 필요 시 스크린샷으로 시각 상태 캡처
5. 심볼/타임프레임 변경은 사용자가 요청했을 때만

## 출력 형식 (JSON)
{
  "symbol": "차트 심볼",
  "timeframe": "타임프레임",
  "price": { "last": 0, "changePercent": 0 },
  "structure": "추세·구조 요약",
  "levels": ["주요 지지/저항"],
  "indicators": [{ "name": "지표", "reading": "해석" }],
  "bias": "bullish | bearish | neutral",
  "confidence": 0.0~1.0,
  "riskNotes": ["리스크/주의"],
  "nextActions": ["관측 포인트 또는 확인 항목"]
}

## 규칙
- 실시간 체결/주문을 실행하지 마세요. 차트 분석·의사결정 보조만 합니다.
- 도구 결과가 없으면 추측하지 말고 연결/차트를 점검하라고 안내하세요.
- 사실에 근거하지 않은 전망은 bias confidence를 낮추고 riskNotes에 명시하세요.`,
    // MCP tools keep original names. Sessions register all enabled MCP tools.
    allowedTools: ['web_search', 'read_file'],
    permissionProfile: 'network',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    outputSchema: {
      type: 'object',
      required: ['symbol', 'structure', 'bias', 'confidence', 'riskNotes'],
    },
    constraints: { maxSteps: 16, timeoutMs: 180_000 },
  },
  {
    id: 'finance_portfolio',
    name: '포트폴리오 요약가',
    domain: 'finance',
    isBuiltIn: true,
    description:
      '보유 종목·비중을 요약하고 리밸런스 제안을 작성합니다. portfolio_summary / risk_report 블록과 연계합니다.',
    systemPrompt: `당신은 포트폴리오 분석 AI 에이전트입니다.
제공된 보유 종목·비중·시장 데이터를 바탕으로 다음 JSON을 반환하세요:
{
  "summary": "포트폴리오 종합 요약",
  "allocation": [{ "symbol": "종목", "weight": 0.0, "note": "..." }],
  "riskNotes": ["집중 리스크, 상관 등"],
  "rebalanceSuggestions": ["리밸런스 제안"],
  "confidence": 0.0~1.0
}
사실에 근거하지 않은 추천은 confidence를 낮추고 riskNotes에 명시하세요.`,
    allowedTools: ['web_search', 'read_file', 'write_file'],
    permissionProfile: 'network',
    workspace: { kind: 'run' },
    defaultMode: 'solo',
    outputSchema: {
      type: 'object',
      required: ['summary', 'allocation', 'riskNotes', 'rebalanceSuggestions', 'confidence'],
    },
    constraints: { maxSteps: 14, timeoutMs: 180_000 },
    preferredBlockIds: ['portfolio_summary', 'risk_report', 'price_lookup'],
  },
];
