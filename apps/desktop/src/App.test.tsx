import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useEngine = vi.fn();

vi.mock('./hooks/useEngine.js', () => ({
  EngineProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEngine: () => useEngine(),
}));

vi.mock('./hooks/useTheme.js', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./pages/ModeSelection.js', () => ({
  ModeSelection: () => <div data-testid="mode-selection">ModeSelection</div>,
}));

vi.mock('./components/Sidebar.js', () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

// Stub heavy pages so connected routing is lightweight
vi.mock('./pages/Dashboard.js', () => ({ Dashboard: () => <div>Dashboard</div> }));
vi.mock('./pages/Harnesses.js', () => ({ Harnesses: () => <div>Harnesses</div> }));
vi.mock('./pages/Blocks.js', () => ({ Blocks: () => <div>Blocks</div> }));
vi.mock('./pages/Sessions.js', () => ({ Sessions: () => <div>Sessions</div> }));
vi.mock('./pages/Settings.js', () => ({ Settings: () => <div>Settings</div> }));
vi.mock('./pages/Skills.js', () => ({ Skills: () => <div>Skills</div> }));
vi.mock('./pages/Templates.js', () => ({ Templates: () => <div>Templates</div> }));
vi.mock('./pages/Workflows.js', () => ({ Workflows: () => <div>Workflows</div> }));
vi.mock('./pages/WorkflowEditor.js', () => ({ WorkflowEditor: () => <div>WorkflowEditor</div> }));
vi.mock('./pages/Memory.js', () => ({ default: () => <div>Memory</div> }));
vi.mock('./pages/DesignSystems.js', () => ({ DesignSystems: () => <div>DesignSystems</div> }));
vi.mock('./pages/DesignSystemEditor.js', () => ({ DesignSystemEditor: () => <div>DesignSystemEditor</div> }));
vi.mock('./pages/Routines.js', () => ({ Routines: () => <div>Routines</div> }));
vi.mock('./pages/Plugins.js', () => ({ Plugins: () => <div>Plugins</div> }));
vi.mock('./pages/Deployments.js', () => ({ Deployments: () => <div>Deployments</div> }));
vi.mock('./pages/Media.js', () => ({ Media: () => <div>Media</div> }));

const App = (await import('./App.js')).default;

describe('App routing gate', () => {
  it('shows ModeSelection when disconnected', () => {
    useEngine.mockReturnValue({ status: 'disconnected' });
    render(<App />);
    expect(screen.getByTestId('mode-selection')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('shows ModeSelection when connecting', () => {
    useEngine.mockReturnValue({ status: 'connecting' });
    render(<App />);
    expect(screen.getByTestId('mode-selection')).toBeInTheDocument();
  });

  it('shows ModeSelection when error', () => {
    useEngine.mockReturnValue({ status: 'error' });
    render(<App />);
    expect(screen.getByTestId('mode-selection')).toBeInTheDocument();
  });

  it('shows main layout with sidebar when connected', () => {
    useEngine.mockReturnValue({ status: 'connected' });
    render(<App />);
    expect(screen.queryByTestId('mode-selection')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
