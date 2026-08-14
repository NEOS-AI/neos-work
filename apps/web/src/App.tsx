import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Blocks } from './pages/Blocks.js';
import { Connect } from './pages/Connect.js';
import { Deployments } from './pages/Deployments.js';
import { DesignSystemEditor } from './pages/DesignSystemEditor.js';
import { DesignSystems } from './pages/DesignSystems.js';
import { DomainPacks } from './pages/DomainPacks.js';
import { Media } from './pages/Media.js';
import { Memory } from './pages/Memory.js';
import { Plugins } from './pages/Plugins.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { Projects } from './pages/Projects.js';
import { Routines } from './pages/Routines.js';
import { Sessions } from './pages/Sessions.js';
import { Settings } from './pages/Settings.js';
import { Skills } from './pages/Skills.js';
import { Templates } from './pages/Templates.js';
import { Workers } from './pages/Workers.js';
import { WorkflowEditor } from './pages/WorkflowEditor.js';
import { Workflows } from './pages/Workflows.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Connect />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/media" element={<Media />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/:id" element={<WorkflowEditor />} />
        <Route path="/workers" element={<Workers />} />
        <Route path="/domain-packs" element={<DomainPacks />} />
        <Route path="/blocks" element={<Blocks />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/plugins" element={<Plugins />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/design-systems" element={<DesignSystems />} />
        <Route path="/design-systems/:id" element={<DesignSystemEditor />} />
        <Route path="/routines" element={<Routines />} />
        <Route path="/deployments" element={<Deployments />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
