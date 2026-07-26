import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineRunner } from './PipelineRunner.js';
import type { Plugin } from '../../lib/engine.js';

const runPlugin = vi.fn();
const resumePlugin = vi.fn();
const stop = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      runPlugin,
      resumePlugin,
    },
  }),
}));

const plugin: Plugin = {
  id: 'plug-1',
  name: 'Demo Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  pipeline: [
    { id: 'discovery', name: 'Discovery', kind: 'discovery' },
    { id: 'plan', name: 'Plan', kind: 'plan' },
  ],
  inputFields: [
    { key: 'goal', label: 'Goal', type: 'text', placeholder: 'what to do' },
  ],
};

describe('PipelineRunner', () => {
  beforeEach(() => {
    runPlugin.mockReset();
    resumePlugin.mockReset();
    stop.mockReset();
    runPlugin.mockReturnValue({
      stop,
      runIdPromise: Promise.resolve('run-xyz'),
    });
    resumePlugin.mockResolvedValue({ ok: true });
  });

  it('renders plugin name and input fields before run', () => {
    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    expect(screen.getByText('Demo Plugin')).toBeInTheDocument();
    expect(screen.getByText('Goal')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('what to do')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run pipeline/i })).toBeInTheDocument();
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PipelineRunner plugin={plugin} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape preventDefault so stacked listeners do not double-fire', () => {
    const onClose = vi.fn();
    render(<PipelineRunner plugin={plugin} onClose={onClose} />);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores Escape when defaultPrevented is already set', () => {
    const onClose = vi.fn();
    render(<PipelineRunner plugin={plugin} onClose={onClose} />);
    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not start pipeline for control-char plugin id', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(
      <PipelineRunner
        plugin={{ ...plugin, id: '\nplug-1' }}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    expect(runPlugin).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Plugin id contains invalid control characters');
    alertSpy.mockRestore();
  });

  it('does not start pipeline for overlong plugin id', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(
      <PipelineRunner
        plugin={{ ...plugin, id: 'p'.repeat(101) }}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    expect(runPlugin).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Plugin id is missing or too long');
    alertSpy.mockRestore();
  });

  it('drops null-byte input values and control-char keys from run payload', async () => {
    const user = userEvent.setup();
    const dirtyPlugin: Plugin = {
      ...plugin,
      inputFields: [
        { key: 'goal', label: 'Goal', type: 'text', placeholder: 'what to do' },
        { key: 'bad\nkey', label: 'Bad', type: 'text', placeholder: 'bad' },
        { key: 'note', label: 'Note', type: 'text', placeholder: 'note' },
      ],
    };
    render(<PipelineRunner plugin={dirtyPlugin} onClose={() => {}} />);
    // Control-char keys are not rendered (display filter)
    expect(screen.queryByPlaceholderText('bad')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('what to do'), '  ship it  ');
    fireEvent.change(screen.getByPlaceholderText('note'), {
      target: { value: `tainted${'\0'}value` },
    });
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    expect(runPlugin).toHaveBeenCalledWith(
      'plug-1',
      { goal: 'ship it' },
      expect.any(Function),
    );
    const payload = runPlugin.mock.calls[0][1] as Record<string, string>;
    expect(payload).not.toHaveProperty('note');
    expect(payload).not.toHaveProperty('bad\nkey');
  });

  it('starts pipeline and shows stages from events', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-1') };
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText('what to do'), 'ship it');
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));

    expect(runPlugin).toHaveBeenCalledWith(
      'plug-1',
      expect.objectContaining({ goal: 'ship it' }),
      expect.any(Function),
    );

    // stages appear after events
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-1' });
      onEvent?.({ type: 'stage.started', stageId: 'discovery', stageName: 'Discovery' });
      onEvent?.({ type: 'stage.completed', stageId: 'discovery', output: 'found things' });
      onEvent?.({ type: 'pipeline.completed' });
    });

    await waitFor(() => {
      expect(screen.getByText('Pipeline completed successfully.')).toBeInTheDocument();
    });
    expect(screen.getByText('Discovery')).toBeInTheDocument();
    expect(screen.getByText(/found things/)).toBeInTheDocument();
  });

  it('shows failure message on pipeline.failed', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-2') };
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'pipeline.failed', error: 'boom' });
    });

    await waitFor(() => {
      expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
    });
  });

  it('shows start failure when runIdPromise resolves without run id or stages', async () => {
    const user = userEvent.setup();
    runPlugin.mockReturnValue({
      stop,
      runIdPromise: Promise.resolve(null),
    });
    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to start pipeline/)).toBeInTheDocument();
    });
  });

  it('surfaces scrubbed resume API error as pipeline failure', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-resume-fail') };
    });
    resumePlugin.mockResolvedValue({
      ok: false,
      error: `resume${'\n'}denied${'\0'}!`,
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-resume-fail' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        surface: 'confirmation',
        schema: { prompt: 'Continue?', confirmLabel: 'Yes', cancelLabel: 'No' },
      });
    });

    await waitFor(() => expect(screen.getByText('Continue?')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(resumePlugin).toHaveBeenCalled();
      expect(screen.getByText(/Error: resume denied!/)).toBeInTheDocument();
    });
  });

  it('surfaces scrubbed resume throw as pipeline failure and clears waiting', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-resume-throw') };
    });
    resumePlugin.mockRejectedValue(new Error(`socket${'\n'}reset${'\0'}!`));

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-resume-throw' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        surface: 'confirmation',
        schema: { prompt: 'Continue?', confirmLabel: 'Yes', cancelLabel: 'No' },
      });
    });

    await waitFor(() => expect(screen.getByText('Continue?')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(resumePlugin).toHaveBeenCalled();
      expect(screen.getByText(/Error: socket reset!/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Continue?')).not.toBeInTheDocument();
  });

  it('Stop button calls stop and clears run UI', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-3') };
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'stage.started', stageId: 'discovery', stageName: 'Discovery' });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /run pipeline/i })).toBeInTheDocument();
  });

  it('shows waiting stage and resumes via GenUI form submit', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-wait') };
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));

    // Ensure runId is set before resume (runIdPromise + event path)
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-wait' });
      onEvent?.({ type: 'stage.started', stageId: 'plan', stageName: 'Plan' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        stageName: 'Plan',
        surface: 'form',
        schema: {
          fields: [{ key: 'note', label: 'Note', type: 'text', placeholder: 'note-ph' }],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Your input needed/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('note-ph')).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText('note-ph'), 'ship');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(resumePlugin).toHaveBeenCalledWith(
        'plug-1',
        'run-wait',
        'plan',
        expect.objectContaining({ note: 'ship' }),
      );
    });
  });

  it('resumes via GenUI choice surface', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-choice') };
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));

    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-choice' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        surface: 'choice',
        schema: {
          prompt: 'Pick one',
          options: [
            { label: 'A', value: 'opt-a' },
            { label: 'B', value: 'opt-b' },
          ],
        },
      });
    });

    await waitFor(() => expect(screen.getByText('Pick one')).toBeInTheDocument());
    await user.click(screen.getByText('A'));
    await waitFor(() => {
      expect(resumePlugin).toHaveBeenCalledWith('plug-1', 'run-choice', 'plan', { choice: 'opt-a' });
    });
  });

  it('resumes via GenUI confirmation surface', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-conf') };
    });

    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));

    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-conf' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        surface: 'confirmation',
        schema: { prompt: 'Continue deploy?', confirmLabel: 'Yes', cancelLabel: 'No' },
      });
    });

    await waitFor(() => expect(screen.getByText('Continue deploy?')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(resumePlugin).toHaveBeenCalledWith('plug-1', 'run-conf', 'plan', { confirmed: true });
    });
  });

  it('ignores control-char stageId / unknown surface on waiting events', async () => {
    const user = userEvent.setup();
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-wait') };
    });
    render(<PipelineRunner plugin={plugin} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: `run${'\0'}x` });
      onEvent?.({ type: 'stage.started', stageId: `st${'\n'}1`, stageName: 'Bad' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        surface: `evil${'\n'}surface`,
        schema: { fields: [{ key: 'n', label: 'N', type: 'text' }] },
      });
      onEvent?.({
        type: 'stage.waiting',
        stageId: `plan${'\0'}`,
        surface: 'form',
        schema: { fields: [{ key: 'n', label: 'N', type: 'text' }] },
      });
    });
    // Control-char runId/stageId/surface never open GenUI
    expect(screen.queryByText(/Your input needed/i)).not.toBeInTheDocument();
    // Valid event still works
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-ok' });
      onEvent?.({
        type: 'stage.waiting',
        stageId: 'plan',
        surface: 'form',
        schema: { fields: [{ key: 'n', label: 'Note', type: 'text', placeholder: 'ph' }] },
      });
    });
    await waitFor(() => expect(screen.getByText(/Your input needed/i)).toBeInTheDocument());
  });

  it('scrubs control-char plugin name and stage labels', async () => {
    const user = userEvent.setup();
    const dirtyPlugin = {
      id: 'p1',
      name: 'Plug' + String.fromCharCode(0) + 'in',
      version: '1',
      description: 'd',
      skillDirName: 'p',
      pipeline: [{ id: 's1', name: 'Stage' + String.fromCharCode(10) + 'One', kind: 'execute' }],
      inputFields: [],
    };
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-1') };
    });
    render(<PipelineRunner plugin={dirtyPlugin as never} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Plugin' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-1' });
      onEvent?.({ type: 'stage.started', stageId: 's1', stageName: 'Stage\nOne' });
    });
    await waitFor(() => {
      expect(screen.getByText('Stage One')).toBeInTheDocument();
    });
  });

  it('scrubs field labels/placeholders and pipeline failed error text', async () => {
    const user = userEvent.setup();
    const dirtyPlugin = {
      id: 'p1',
      name: 'Clean',
      version: '1',
      description: 'd',
      skillDirName: 'p',
      pipeline: [],
      inputFields: [
        {
          key: 'goal',
          label: `Goal${'\n'}X`,
          type: 'text',
          placeholder: `type${'\0'}here`,
        },
      ],
    };
    let onEvent: ((e: unknown) => void) | null = null;
    runPlugin.mockImplementation((_id: string, _inputs: unknown, cb: (e: unknown) => void) => {
      onEvent = cb;
      return { stop, runIdPromise: Promise.resolve('run-1') };
    });
    render(<PipelineRunner plugin={dirtyPlugin as never} onClose={() => {}} />);
    // label collapsed; placeholder null-byte stripped
    expect(screen.getByText(/Goal X/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('typehere')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('typehere'), 'go');
    await user.click(screen.getByRole('button', { name: /run pipeline/i }));
    act(() => {
      onEvent?.({ type: 'pipeline.started', runId: 'run-1' });
      onEvent?.({ type: 'pipeline.failed', error: `boom${'\n'}now${'\0'}!` });
    });
    await waitFor(() => {
      expect(screen.getByText(/Error: boom now!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });
});
