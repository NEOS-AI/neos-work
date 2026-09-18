import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { VideoLayout } from './VideoLayout.js';

describe('VideoLayout', () => {
  it('renders studio nav destinations', () => {
    render(
      <MemoryRouter initialEntries={['/video']}>
        <Routes>
          <Route path="/video" element={<VideoLayout />}>
            <Route index element={<div>studio-home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('studio-home')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '분석' })).toHaveAttribute('href', '/video/probe');
    expect(screen.getByRole('link', { name: '타임라인' })).toHaveAttribute('href', '/video/timeline');
    expect(screen.getByRole('link', { name: '변환/합치기' })).toHaveAttribute('href', '/video/transcode');
    expect(screen.getByRole('link', { name: '작업' })).toHaveAttribute('href', '/video/jobs');
  });
});
