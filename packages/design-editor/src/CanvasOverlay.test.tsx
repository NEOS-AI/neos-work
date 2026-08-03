import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasOverlay } from './CanvasOverlay.js';

describe('CanvasOverlay', () => {
  it('renders nothing when disabled or no bbox', () => {
    const { container, rerender } = render(
      <CanvasOverlay enabled={false} bbox={{ x: 0, y: 0, width: 10, height: 10 }} />,
    );
    expect(container.querySelector('[data-testid="canvas-overlay"]')).toBeNull();
    rerender(<CanvasOverlay enabled bbox={null} />);
    expect(container.querySelector('[data-testid="canvas-overlay"]')).toBeNull();
  });

  it('calls onDragEnd with delta after pointer drag', () => {
    const onDragEnd = vi.fn();
    render(
      <CanvasOverlay
        enabled
        bbox={{ x: 10, y: 20, width: 100, height: 40 }}
        onDragEnd={onDragEnd}
      />,
    );
    const frame = screen.getByTestId('canvas-overlay-frame');
    fireEvent.mouseDown(frame, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 65 });
    fireEvent.mouseUp(window, { clientX: 70, clientY: 65 });
    expect(onDragEnd).toHaveBeenCalledWith(20, 15);
  });

  it('calls onTransformEnd resize from SE handle', () => {
    const onTransformEnd = vi.fn();
    render(
      <CanvasOverlay
        enabled
        bbox={{ x: 10, y: 20, width: 100, height: 40 }}
        onTransformEnd={onTransformEnd}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId('canvas-overlay-resize-se'), {
      clientX: 110,
      clientY: 60,
    });
    fireEvent.mouseMove(window, { clientX: 130, clientY: 80 });
    fireEvent.mouseUp(window);
    expect(onTransformEnd).toHaveBeenCalledWith({
      kind: 'resize',
      dw: 20,
      dh: 20,
      baseWidth: 100,
      baseHeight: 40,
    });
  });

  it('renders extra multi-select frames (v0.7 M3)', () => {
    const { container } = render(
      <CanvasOverlay
        enabled
        bbox={{ x: 10, y: 20, width: 100, height: 40 }}
        extraBboxes={[
          { x: 50, y: 80, width: 30, height: 20 },
          { x: 0, y: 0, width: 0, height: 0 }, // invalid ignored
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="canvas-overlay"]') as HTMLElement;
    expect(root.getAttribute('data-multi-count')).toBe('2');
    expect(root.getAttribute('data-group-resize')).toBe('1');
    expect(screen.getAllByTestId('canvas-overlay-extra-frame')).toHaveLength(1);
    expect(screen.getByTestId('canvas-overlay-handle').textContent).toMatch(/Move \/ Scale/);
  });

  it('group-resize live preview scales extras with primary (v0.8 M2)', () => {
    render(
      <CanvasOverlay
        enabled
        bbox={{ x: 0, y: 0, width: 100, height: 50 }}
        extraBboxes={[{ x: 50, y: 25, width: 20, height: 10 }]}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId('canvas-overlay-resize-se'), {
      clientX: 100,
      clientY: 50,
    });
    // Double primary size
    fireEvent.mouseMove(window, { clientX: 200, clientY: 100 });
    const extra = screen.getByTestId('canvas-overlay-extra-frame');
    // offset (50,25)*2 → (100,50); size 40×20
    expect(extra.style.left).toBe('100px');
    expect(extra.style.top).toBe('50px');
    expect(extra.style.width).toBe('40px');
    expect(extra.style.height).toBe('20px');
    fireEvent.mouseUp(window);
  });

  it('Shift during multi SE resize sets uniform and locks live preview (v0.8.5)', () => {
    const onTransformEnd = vi.fn();
    const { container } = render(
      <CanvasOverlay
        enabled
        bbox={{ x: 0, y: 0, width: 100, height: 50 }}
        extraBboxes={[{ x: 50, y: 0, width: 20, height: 10 }]}
        onTransformEnd={onTransformEnd}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId('canvas-overlay-resize-se'), {
      clientX: 100,
      clientY: 50,
    });
    // Free would be sx=2 (dw=100), sy=1 (dh=0); uniform → both 2
    fireEvent.mouseMove(window, { clientX: 200, clientY: 50, shiftKey: true });
    const root = container.querySelector('[data-testid="canvas-overlay"]') as HTMLElement;
    expect(root.getAttribute('data-uniform-scale')).toBe('1');
    const frame = screen.getByTestId('canvas-overlay-frame');
    expect(frame.style.width).toBe('200px');
    expect(frame.style.height).toBe('100px');
    fireEvent.mouseUp(window, { shiftKey: true });
    expect(onTransformEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'resize',
        dw: 100,
        dh: 0,
        uniform: true,
      }),
    );
  });

  it('free multi resize omits uniform when Shift not held (v0.8.5)', () => {
    const onTransformEnd = vi.fn();
    render(
      <CanvasOverlay
        enabled
        bbox={{ x: 0, y: 0, width: 100, height: 50 }}
        extraBboxes={[{ x: 50, y: 0, width: 20, height: 10 }]}
        onTransformEnd={onTransformEnd}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId('canvas-overlay-resize-se'), {
      clientX: 100,
      clientY: 50,
    });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 50 });
    fireEvent.mouseUp(window);
    expect(onTransformEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'resize',
        dw: 100,
        dh: 0,
      }),
    );
    const arg = onTransformEnd.mock.calls[0]![0] as { uniform?: boolean };
    expect(arg.uniform).toBeFalsy();
  });

  it('renders peer frames with dashed outlines (v0.8.5)', () => {
    render(
      <CanvasOverlay
        enabled
        bbox={{ x: 10, y: 10, width: 40, height: 20 }}
        peerFrames={[
          {
            colorHint: 40,
            label: 'Alice',
            bboxes: [
              { x: 100, y: 80, width: 30, height: 16 },
              { x: 0, y: 0, width: 0, height: 0 },
            ],
          },
        ]}
      />,
    );
    const peers = screen.getAllByTestId('canvas-overlay-peer-frame');
    expect(peers).toHaveLength(1);
    expect(peers[0]!.getAttribute('data-color-hint')).toBe('40');
    expect(screen.getByTestId('canvas-overlay-peer-label').textContent).toBe('Alice');
  });

  it('renders peer-only overlay when no local bbox (v0.8.5)', () => {
    render(
      <CanvasOverlay
        enabled
        bbox={null}
        peerFrames={[
          {
            colorHint: 200,
            bboxes: [{ x: 5, y: 5, width: 10, height: 10 }],
          },
        ]}
      />,
    );
    const root = screen.getByTestId('canvas-overlay');
    expect(root.getAttribute('data-peer-only')).toBe('1');
    expect(screen.getByTestId('canvas-overlay-peer-frame')).toBeTruthy();
    expect(screen.queryByTestId('canvas-overlay-frame')).toBeNull();
  });
});
