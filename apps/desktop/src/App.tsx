import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';

import { Sidebar } from './components/Sidebar.js';
import { EngineProvider, useEngine } from './hooks/useEngine.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { Dashboard } from './pages/Dashboard.js';
import { Harnesses } from './pages/Harnesses.js';
import { Blocks } from './pages/Blocks.js';
import { ModeSelection } from './pages/ModeSelection.js';
import { Sessions } from './pages/Sessions.js';
import { Settings } from './pages/Settings.js';
import { Skills } from './pages/Skills.js';
import { Templates } from './pages/Templates.js';
import { Workflows } from './pages/Workflows.js';
import { WorkflowEditor } from './pages/WorkflowEditor.js';
import Memory from './pages/Memory.js';
import { DesignSystems } from './pages/DesignSystems.js';
import { DesignSystemEditor } from './pages/DesignSystemEditor.js';
import { Routines } from './pages/Routines.js';
import { Plugins } from './pages/Plugins.js';
import { Deployments } from './pages/Deployments.js';
import { Media } from './pages/Media.js';
import { Projects } from './pages/Projects.js';
import { ProjectWorkspace } from './pages/ProjectWorkspace.js';
import { DomainPacks } from './pages/DomainPacks.js';

export default function App() {
  return (
    <ThemeProvider>
      <EngineProvider>
        <AppRouter />
      </EngineProvider>
    </ThemeProvider>
  );
}

/**
 * Data router so useBlocker works in WorkflowEditor / ProjectWorkspace (RR7).
 * Built once; only mounted while engine is connected.
 */
const connectedRouter = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'workflows', element: <Workflows /> },
      { path: 'workflows/:id', element: <WorkflowEditor /> },
      { path: 'projects', element: <Projects /> },
      { path: 'projects/:id', element: <ProjectWorkspace /> },
      { path: 'harnesses', element: <Harnesses /> },
      { path: 'domain-packs', element: <DomainPacks /> },
      { path: 'blocks', element: <Blocks /> },
      { path: 'templates', element: <Templates /> },
      { path: 'skills', element: <Skills /> },
      { path: 'memory', element: <Memory /> },
      { path: 'settings', element: <Settings /> },
      { path: 'design-systems', element: <DesignSystems /> },
      { path: 'design-systems/:id', element: <DesignSystemEditor /> },
      { path: 'routines', element: <Routines /> },
      { path: 'plugins', element: <Plugins /> },
      { path: 'deployments', element: <Deployments /> },
      { path: 'media', element: <Media /> },
    ],
  },
]);

function AppRouter() {
  const { status } = useEngine();

  // Show mode selection when not connected
  if (status === 'disconnected' || status === 'connecting' || status === 'error') {
    return <ModeSelection />;
  }

  return <RouterProvider router={connectedRouter} />;
}

function MainLayout() {
  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
