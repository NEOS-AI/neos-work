/**
 * Workflow templates — pre-built starter workflows for each domain.
 * GET /api/templates
 */

import { Hono } from 'hono';
import type { Workflow } from '@neos-work/shared';

const templates = new Hono();

const TEMPLATES: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // ── Finance templates ─────────────────────────────────
  {
    name: 'Stock Price Monitor',
    description: '특정 종목의 현재가를 조회하고 Slack으로 알림을 보내는 워크플로우',
    domain: 'finance',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 100, y: 200 }, config: {} },
      { id: 'price', type: 'block', label: 'Price Lookup', position: { x: 350, y: 200 }, config: { blockId: 'price_lookup', params: { symbol: '005930' } } },
      { id: 'slack', type: 'slack_message', label: 'Slack Notify', position: { x: 600, y: 200 }, config: { channel: '#stock-alerts' } },
      { id: 'output', type: 'output', label: 'Output', position: { x: 850, y: 200 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'price' },
      { id: 'e2', source: 'price', target: 'slack' },
      { id: 'e3', source: 'slack', target: 'output' },
    ],
  },
  {
    name: 'Technical Analysis Report',
    description: 'RSI · MACD · 이동평균을 계산하고 AI 에이전트가 시황 분석 리포트를 작성',
    domain: 'finance',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 60, y: 200 }, config: {} },
      { id: 'rsi', type: 'block', label: 'RSI', position: { x: 280, y: 100 }, config: { blockId: 'rsi', params: { symbol: '005930', period: 14 } } },
      { id: 'macd', type: 'block', label: 'MACD', position: { x: 280, y: 300 }, config: { blockId: 'macd', params: { symbol: '005930' } } },
      { id: 'gate', type: 'gate_and', label: 'Wait All', position: { x: 520, y: 200 }, config: {} },
      { id: 'agent', type: 'agent_finance', label: 'Finance Analyst', position: { x: 750, y: 200 }, config: { harnessId: 'finance_analyst' } },
      { id: 'output', type: 'output', label: 'Output', position: { x: 980, y: 200 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'rsi' },
      { id: 'e2', source: 'trigger', target: 'macd' },
      { id: 'e3', source: 'rsi', target: 'gate' },
      { id: 'e4', source: 'macd', target: 'gate' },
      { id: 'e5', source: 'gate', target: 'agent' },
      { id: 'e6', source: 'agent', target: 'output' },
    ],
  },
  {
    name: 'Portfolio Risk Report',
    description: '복수 종목의 리스크 지표를 계산하고 위험도 리포트를 생성',
    domain: 'finance',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
      { id: 'portfolio', type: 'block', label: 'Portfolio Summary', position: { x: 320, y: 130 }, config: { blockId: 'portfolio_summary', params: { symbols: '005930,000660,035720' } } },
      { id: 'risk', type: 'block', label: 'Risk Report', position: { x: 320, y: 270 }, config: { blockId: 'risk_report', params: { symbol: '005930' } } },
      { id: 'analyst', type: 'agent_finance', label: 'Risk Analyst', position: { x: 580, y: 200 }, config: { harnessId: 'finance_risk' } },
      { id: 'output', type: 'output', label: 'Output', position: { x: 820, y: 200 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'portfolio' },
      { id: 'e2', source: 'trigger', target: 'risk' },
      { id: 'e3', source: 'portfolio', target: 'analyst' },
      { id: 'e4', source: 'risk', target: 'analyst' },
      { id: 'e5', source: 'analyst', target: 'output' },
    ],
  },

  // ── Coding templates ──────────────────────────────────
  {
    name: 'Code Review Assistant',
    description: '코드 변경사항을 검색하고 AI가 코드 리뷰를 수행한 뒤 Discord로 결과를 전송',
    domain: 'coding',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
      { id: 'search', type: 'web_search', label: 'Web Search', position: { x: 320, y: 200 }, config: {} },
      { id: 'reviewer', type: 'agent_coding', label: 'Code Reviewer', position: { x: 560, y: 200 }, config: { harnessId: 'coding_reviewer' } },
      { id: 'discord', type: 'discord_message', label: 'Discord Notify', position: { x: 800, y: 200 }, config: {} },
      { id: 'output', type: 'output', label: 'Output', position: { x: 1040, y: 200 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'search' },
      { id: 'e2', source: 'search', target: 'reviewer' },
      { id: 'e3', source: 'reviewer', target: 'discord' },
      { id: 'e4', source: 'discord', target: 'output' },
    ],
  },
  {
    name: 'Test Writer',
    description: '소스 코드를 입력받아 AI가 단위 테스트를 자동 작성',
    domain: 'coding',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
      { id: 'writer', type: 'agent_coding', label: 'Test Writer', position: { x: 340, y: 200 }, config: { harnessId: 'coding_test_writer' } },
      { id: 'output', type: 'output', label: 'Output', position: { x: 600, y: 200 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'writer' },
      { id: 'e2', source: 'writer', target: 'output' },
    ],
  },

  // ── General templates ─────────────────────────────────
  {
    name: 'Web Research + Slack',
    description: '주제를 검색하고 AI가 요약한 뒤 Slack으로 전송',
    domain: 'general',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
      { id: 'search', type: 'web_search', label: 'Web Search', position: { x: 320, y: 200 }, config: {} },
      { id: 'slack', type: 'slack_message', label: 'Slack', position: { x: 560, y: 200 }, config: { channel: '#general' } },
      { id: 'output', type: 'output', label: 'Output', position: { x: 800, y: 200 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'search' },
      { id: 'e2', source: 'search', target: 'slack' },
      { id: 'e3', source: 'slack', target: 'output' },
    ],
  },
];

// GET /api/templates
templates.get('/', (c) => {
  const domain = c.req.query('domain');
  const filtered = domain ? TEMPLATES.filter((t) => t.domain === domain) : TEMPLATES;
  return c.json({ ok: true, data: filtered });
});

export default templates;
