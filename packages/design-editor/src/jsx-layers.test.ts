import { describe, expect, it } from 'vitest';
import {
  extractJsxReturnSnippet,
  isJsxPath,
  jsxSnippetToPseudoHtml,
  parseJsxToLayerTree,
} from './jsx-layers.js';

const SAMPLE = `
import React from 'react';

export function Hero() {
  const title = 'Hi';
  return (
    <section className="hero" id="hero">
      <h1>{title}</h1>
      <Button onClick={() => {}}>Go</Button>
      <div className="row">
        <span>A</span>
        <span>B</span>
      </div>
    </section>
  );
}
`;

describe('isJsxPath', () => {
  it('detects jsx/tsx only', () => {
    expect(isJsxPath('App.tsx')).toBe(true);
    expect(isJsxPath('x.jsx')).toBe(true);
    expect(isJsxPath('index.html')).toBe(false);
    expect(isJsxPath(null)).toBe(false);
  });
});

describe('extractJsxReturnSnippet', () => {
  it('finds return ( jsx )', () => {
    const snip = extractJsxReturnSnippet(SAMPLE);
    expect(snip).toBeTruthy();
    expect(snip).toMatch(/<section/);
    expect(snip).toMatch(/<\/section>/);
  });
});

describe('jsxSnippetToPseudoHtml', () => {
  it('rewrites className and strips expressions', () => {
    const html = jsxSnippetToPseudoHtml('<div className="x" onClick={() => 1}>{foo}</div>');
    expect(html).toMatch(/class=/);
    expect(html).not.toMatch(/onClick=\{/);
    expect(html).not.toMatch(/\{foo\}/);
  });

  it('prefixes PascalCase components', () => {
    const html = jsxSnippetToPseudoHtml('<Button>Ok</Button>');
    expect(html.toLowerCase()).toMatch(/jsx-button/);
  });
});

describe('parseJsxToLayerTree', () => {
  it('builds a section tree with children', () => {
    const { layers, incomplete } = parseJsxToLayerTree(SAMPLE);
    expect(layers.length).toBeGreaterThanOrEqual(1);
    const root = layers[0]!;
    expect(root.tag).toMatch(/section/i);
    expect(root.children.length).toBeGreaterThanOrEqual(2);
    // h1 + Button + div
    const tags = root.children.map((c) => c.tag.toLowerCase());
    expect(tags.some((t) => t === 'h1')).toBe(true);
    expect(incomplete).toBe(true); // has expressions
  });

  it('marks empty / no return as incomplete', () => {
    expect(parseJsxToLayerTree('const x = 1;').layers).toEqual([]);
    expect(parseJsxToLayerTree('const x = 1;').incomplete).toBe(true);
  });

  it('parses simple self-closing without expressions as complete-ish', () => {
    const src = `export default function A() { return <main id="m"><p>Hi</p></main>; }`;
    const r = parseJsxToLayerTree(src);
    expect(r.layers[0]?.tag.toLowerCase()).toBe('main');
    expect(r.layers[0]?.children.some((c) => c.tag.toLowerCase() === 'p')).toBe(true);
  });
});
