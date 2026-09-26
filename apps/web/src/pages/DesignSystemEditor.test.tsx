import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const saveDesignSystemContent = vi.fn();
const getDesignSystemRules = vi.fn();
const saveDesignSystemRules = vi.fn();
const getDesignSystemTokens = vi.fn();

class MockApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: MockApiError,
  WebApiClient: class {
    listDesignSystems = listDesignSystems;
    getDesignSystemContent = getDesignSystemContent;
    saveDesignSystemContent = saveDesignSystemContent;
    getDesignSystemRules = getDesignSystemRules;
    saveDesignSystemRules = saveDesignSystemRules;
    getDesignSystemTokens = getDesignSystemTokens;
  },
}));

const { DesignSystemEditor } = await import('./DesignSystemEditor.js');

const RULES_PLACEHOLDER = `# Agent rules

This file is the behavioral half of the design harness.
Visual tokens live in DESIGN.md and tokens.css. Do not duplicate palettes here.

## Tools
- Prefer editing the open project HTML/CSS. Do not start from an empty document when a seed file exists.
- Use Design Editor selection / preview comments when present.
- Produce self-contained, clickable HTML (hover, focus, scroll, transitions). Not a screenshot mock.

## Never
- Do not invent a new color palette or font stack when tokens.css defines one.
- Do not use raw hex/rgb for brand colors; use CSS custom properties from tokens.css.
- Do not ship inaccessible contrast or missing focus rings.
- Do not overwrite unrelated manual edits (prefer a minimal patch).

## Preferred workflow
- Start from the seed (current file, components.html, or a starter), generate a few variants as sibling files, then narrow to one.
- After a human correction, wait for an explicit promote; do not rewrite RULES.md yourself unless asked.

## Corrections
<!-- dated bullets, pruned when stale. format: - YYYY-MM-DD: text -->`;

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/design-systems/ds1']}>
      <Routes>
        <Route path="/design-systems/:id" element={<DesignSystemEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openTab(name: 'design' | 'rules') {
  fireEvent.click(screen.getByRole('tab', { name: name === 'design' ? 'DESIGN.md' : 'RULES.md' }));
}

async function waitForLoaded(value = '# Design') {
  await waitFor(() => expect(screen.getByTestId('ds-editor-content')).toHaveValue(value));
}

describe('Web Design System editor', () => {
  beforeEach(() => {
    listDesignSystems.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'ds1', name: 'Mine' }],
    });
    getDesignSystemContent.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '# Design' },
    });
    saveDesignSystemContent.mockReset().mockResolvedValue({ ok: true });
    getDesignSystemRules.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '# Agent rules\n' },
    });
    saveDesignSystemRules.mockReset().mockResolvedValue({ ok: true });
    getDesignSystemTokens.mockReset();
  });

  it('loads and saves DESIGN.md', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('ds-editor-content')).toHaveValue('# Design'));
    fireEvent.change(screen.getByTestId('ds-editor-content'), { target: { value: '# Next' } });
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    await waitFor(() => expect(saveDesignSystemContent).toHaveBeenCalledWith('ds1', '# Next'));
  });

  it('keeps in-flight keystrokes dirty after save resolves', async () => {
    let resolveSave!: (value: { ok: true }) => void;
    saveDesignSystemContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByTestId('ds-editor-content'), { target: { value: '# Updated' } });
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds1', '# Updated');
      expect(screen.getByTestId('ds-editor-save')).toHaveTextContent('Saving…');
    });

    fireEvent.change(screen.getByTestId('ds-editor-content'), {
      target: { value: '# Updated extra' },
    });
    resolveSave({ ok: true });

    await waitFor(() => {
      expect(screen.getByTestId('ds-editor-save')).toHaveTextContent('Save');
    });
    expect(screen.getByTestId('ds-editor-content')).toHaveValue('# Updated extra');
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(screen.getByTestId('ds-editor-save')).toBeEnabled();
  });

  it('renders DESIGN.md and RULES.md tabs and keeps independent dirty buffers', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderEditor();
    await waitForLoaded();
    expect(screen.getByRole('tab', { name: 'DESIGN.md' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'RULES.md' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('ds-tab-design')).toBeInTheDocument();
    expect(screen.getByTestId('ds-tab-rules')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /tokens\.css/i })).toBeNull();
    expect(screen.queryByTestId('ds-tab-tokens')).toBeNull();
    expect(screen.getByTestId('ds-editor-content')).toHaveValue('# Design');

    fireEvent.change(screen.getByTestId('ds-editor-content'), { target: { value: '# Next' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    await waitFor(() => expect(saveDesignSystemContent).toHaveBeenCalledWith('ds1', '# Next'));
    expect(saveDesignSystemRules).not.toHaveBeenCalled();

    openTab('rules');
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('ds-editor-content')).toHaveValue('# Agent rules\n');
    expect(screen.getByTestId('ds-editor-save')).toBeDisabled();

    fireEvent.change(screen.getByTestId('ds-editor-content'), {
      target: { value: '# Agent rules\n\nextra' },
    });
    expect(screen.getByTestId('ds-editor-save')).toBeEnabled();
    saveDesignSystemContent.mockClear();
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    await waitFor(() =>
      expect(saveDesignSystemRules).toHaveBeenCalledWith('ds1', '# Agent rules\n\nextra'),
    );
    expect(saveDesignSystemContent).not.toHaveBeenCalled();

    openTab('design');
    expect(screen.getByTestId('ds-editor-content')).toHaveValue('# Next');
    confirm.mockRestore();
  });

  it('Save on a clean RULES tab does not PUT DESIGN even if DESIGN is dirty', async () => {
    renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByTestId('ds-editor-content'), { target: { value: '# Dirty design' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    openTab('rules');
    expect(screen.getByTestId('ds-editor-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
  });

  it('GET rules 404 shows §5 placeholder that is not dirty; first edit then Save PUTs', async () => {
    getDesignSystemRules.mockRejectedValue(new MockApiError('Not found', 404));
    renderEditor();
    await waitForLoaded();
    expect(screen.queryByRole('alert')).toBeNull();
    openTab('rules');
    expect((screen.getByTestId('ds-editor-content') as HTMLTextAreaElement).value.trim()).toBe(
      RULES_PLACEHOLDER.trim(),
    );
    expect(screen.getByTestId('ds-editor-save')).toBeDisabled();
    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('ds-editor-content'), {
      target: { value: `${RULES_PLACEHOLDER}x` },
    });
    expect(screen.getByTestId('ds-editor-save')).toBeEnabled();
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    await waitFor(() =>
      expect(saveDesignSystemRules).toHaveBeenCalledWith('ds1', `${RULES_PLACEHOLDER}x`),
    );
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
  });

  it('untouched 404 placeholder is never PUT', async () => {
    getDesignSystemRules.mockRejectedValue(new MockApiError('Not found', 404));
    renderEditor();
    await waitForLoaded();
    openTab('rules');
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
  });

  it('envelope !ok Not found is also a placeholder', async () => {
    getDesignSystemRules.mockResolvedValue({ ok: false, error: 'Not found' });
    renderEditor();
    await waitForLoaded();
    openTab('rules');
    expect((screen.getByTestId('ds-editor-content') as HTMLTextAreaElement).value.trim()).toBe(
      RULES_PLACEHOLDER.trim(),
    );
    expect(screen.getByTestId('ds-editor-save')).toBeDisabled();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
  });

  it('non-404 rules errors surface an alert and do not PUT', async () => {
    getDesignSystemRules.mockResolvedValue({ ok: false, error: 'disk down' });
    renderEditor();
    await waitForLoaded();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    openTab('rules');
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
  });

  it('rejected non-404 rules errors surface an alert and do not PUT', async () => {
    getDesignSystemRules.mockRejectedValue(new MockApiError('boom', 500));
    renderEditor();
    await waitForLoaded();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
  });

  it('Promote / prune / variants / starters controls are absent', async () => {
    renderEditor();
    await waitForLoaded();
    expect(screen.queryByRole('button', { name: /promote/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Promote to RULES.md/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /prune/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /variant/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /starter/i })).toBeNull();
    expect(screen.queryByTestId('ds-tab-tokens')).toBeNull();
  });

  it('editor load does not call getDesignSystemTokens', async () => {
    renderEditor();
    await waitForLoaded();
    expect(getDesignSystemTokens).not.toHaveBeenCalled();
  });

  it('apps/web design-system files do not import useTranslation', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      readFileSync(join(here, 'DesignSystemEditor.tsx'), 'utf8'),
      readFileSync(join(here, '../components/CommentsPanel.tsx'), 'utf8'),
    ];
    for (const src of files) {
      expect(src).not.toMatch(/useTranslation/);
      expect(src).not.toMatch(/react-i18next/);
      expect(src).not.toMatch(/t\('designSystems\./);
    }
  });
});
