import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';

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

export default function App() {
  return (
    <ThemeProvider>
      <EngineProvider>
        <AppRouter />
      </EngineProvider>
    </ThemeProvider>
  );
}

function AppRouter() {
  const { status } = useEngine();

  // Show mode selection when not connected
  if (status === 'disconnected' || status === 'connecting' || status === 'error') {
    return <ModeSelection />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/:id" element={<WorkflowEditor />} />
          <Route path="harnesses" element={<Harnesses />} />
          <Route path="blocks" element={<Blocks />} />
          <Route path="templates" element={<Templates />} />
          <Route path="skills" element={<Skills />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
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
