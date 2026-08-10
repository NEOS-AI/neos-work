import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Connect } from './pages/Connect.js';
import { Media } from './pages/Media.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { Projects } from './pages/Projects.js';
import { Settings } from './pages/Settings.js';
import { WorkflowEditor } from './pages/WorkflowEditor.js';
import { Workflows } from './pages/Workflows.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Connect />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/media" element={<Media />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/:id" element={<WorkflowEditor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
