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
});
