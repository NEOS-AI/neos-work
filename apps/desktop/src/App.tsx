import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { createBrowserRouter, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom';

import { Sidebar } from './components/Sidebar.js';
import { EngineProvider, useEngine } from './hooks/useEngine.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { Dashboard } from './pages/Dashboard.js';
import { Harnesses, Workers } from './pages/Harnesses.js';
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
const VideoLayout = lazy(() =>
  import('./video/VideoLayout.js').then((m) => ({ default: m.VideoLayout })),
);
const VideoHomePage = lazy(() => import('./video/pages/HomePage.js'));
const VideoProbePage = lazy(() => import('./video/pages/ProbePage.js'));
const VideoExtractPage = lazy(() => import('./video/pages/ExtractPage.js'));
const VideoTranscodePage = lazy(() => import('./video/pages/TranscodePage.js'));
const VideoViewerPage = lazy(() => import('./video/pages/ViewerPage.js'));
const VideoResizePage = lazy(() => import('./video/pages/ResizePage.js'));
const VideoTrimPage = lazy(() => import('./video/pages/TrimPage.js'));
const VideoClipsPage = lazy(() => import('./video/pages/ClipsPage.js'));
const VideoConcatPage = lazy(() => import('./video/pages/ConcatPage.js'));
const VideoCropPage = lazy(() => import('./video/pages/CropPage.js'));
const VideoTransformPage = lazy(() => import('./video/pages/TransformPage.js'));
const VideoSpeedPage = lazy(() => import('./video/pages/SpeedPage.js'));
const VideoGifPage = lazy(() => import('./video/pages/GifPage.js'));
const VideoFadePage = lazy(() => import('./video/pages/FadePage.js'));
const VideoVolumePage = lazy(() => import('./video/pages/VolumePage.js'));
const VideoWatermarkPage = lazy(() => import('./video/pages/WatermarkPage.js'));
const VideoJobsPage = lazy(() => import('./video/pages/JobsPage.js'));
const VideoTimelinePage = lazy(() => import('./video/pages/TimelinePage.js'));
const VideoDownloadPage = lazy(() => import('./video/pages/DownloadPage.js'));

function VideoRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-sm">Loading video studio…</div>}>{children}</Suspense>;
}

/** sessionStorage key for path to restore after ModeSelection connect gate. */
const PENDING_PATH_KEY = 'neos-desktop-pending-path';

export default function App() {
  return (
    <ThemeProvider>
      <EngineProvider>
        <AppRouter />
      </EngineProvider>
    </ThemeProvider>
  );
}

function isVideoPath(pathname: string): boolean {
  return pathname === '/video' || pathname.startsWith('/video/');
}

/**
 * Data router so useBlocker works in WorkflowEditor / ProjectWorkspace (RR7).
 * Instantiated per App mount so tests (and first paint) read the current URL.
 * `/video` works without an engine connection.
 */
const appRoutes = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'workflows', element: <Workflows /> },
      { path: 'workflows/:id', element: <WorkflowEditor /> },
      { path: 'projects', element: <Projects /> },
      { path: 'projects/:id', element: <ProjectWorkspace /> },
      // Primary: /workers (v0.11 M3). Alias: /harnesses for bookmarks (Q37).
      { path: 'workers', element: <Workers /> },
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
      {
        path: 'video',
        element: (
          <VideoRoute>
            <VideoLayout />
          </VideoRoute>
        ),
        children: [
          { index: true, element: <VideoHomePage /> },
          { path: 'probe', element: <VideoProbePage /> },
          { path: 'extract', element: <VideoExtractPage /> },
          { path: 'transcode', element: <VideoTranscodePage /> },
          { path: 'viewer', element: <VideoViewerPage /> },
          { path: 'resize', element: <VideoResizePage /> },
          { path: 'trim', element: <VideoTrimPage /> },
          { path: 'clips', element: <VideoClipsPage /> },
          { path: 'concat', element: <VideoConcatPage /> },
          { path: 'crop', element: <VideoCropPage /> },
          { path: 'transform', element: <VideoTransformPage /> },
          { path: 'speed', element: <VideoSpeedPage /> },
          { path: 'gif', element: <VideoGifPage /> },
          { path: 'fade', element: <VideoFadePage /> },
          { path: 'volume', element: <VideoVolumePage /> },
          { path: 'watermark', element: <VideoWatermarkPage /> },
          { path: 'jobs', element: <VideoJobsPage /> },
          { path: 'timeline', element: <VideoTimelinePage /> },
          { path: 'download', element: <VideoDownloadPage /> },
        ],
      },
    ],
  },
];

function isSafePendingPath(raw: string): boolean {
  if (!raw || raw.length > 500 || /[\0\r\n]/.test(raw)) return false;
  // App-relative paths only (no protocol / open-redirect)
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  return true;
}

function rememberPendingPath(): void {
  try {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (isSafePendingPath(path) && path !== '/') {
      sessionStorage.setItem(PENDING_PATH_KEY, path);
    }
  } catch {
    /* private mode / storage blocked */
  }
}

function restorePendingPath(navigate: (to: string, opts: { replace: boolean }) => void): void {
  try {
    const pending = sessionStorage.getItem(PENDING_PATH_KEY);
    if (!pending || !isSafePendingPath(pending)) {
      sessionStorage.removeItem(PENDING_PATH_KEY);
      return;
    }
    sessionStorage.removeItem(PENDING_PATH_KEY);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (pending !== current) {
      navigate(pending, { replace: true });
    }
  } catch {
    /* ignore */
  }
}

function RootLayout() {
  const { status } = useEngine();
  const location = useLocation();
  const navigate = useNavigate();
  const connected = status === 'connected';
  const videoOpen = isVideoPath(location.pathname);

  // Capture deep links (except /video, which does not need the engine)
  useEffect(() => {
    if (connected || videoOpen) return;
    rememberPendingPath();
  }, [connected, videoOpen, location.pathname, location.search, location.hash]);

  // After connect, restore intended path if browser location was reset
  useEffect(() => {
    if (!connected) return;
    const t = window.setTimeout(() => restorePendingPath(navigate), 0);
    return () => window.clearTimeout(t);
  }, [connected, navigate]);

  if (!connected && !videoOpen) {
    return <ModeSelection />;
  }

  return <MainLayout />;
}

function AppRouter() {
  const router = useMemo(() => createBrowserRouter(appRoutes), []);
  return <RouterProvider router={router} />;
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
