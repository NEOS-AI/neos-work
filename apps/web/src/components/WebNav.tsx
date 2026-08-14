import { Link } from 'react-router-dom';

const LINKS: Array<{ to: string; label: string; testId: string }> = [
  { to: '/projects', label: 'Projects', testId: 'nav-projects' },
  { to: '/sessions', label: 'Sessions', testId: 'nav-sessions' },
  { to: '/workflows', label: 'Workflows', testId: 'nav-workflows' },
  { to: '/workers', label: 'Workers', testId: 'nav-workers' },
  { to: '/domain-packs', label: 'Packs', testId: 'nav-packs' },
  { to: '/blocks', label: 'Blocks', testId: 'nav-blocks' },
  { to: '/templates', label: 'Templates', testId: 'nav-templates' },
  { to: '/skills', label: 'Skills', testId: 'nav-skills' },
  { to: '/plugins', label: 'Plugins', testId: 'nav-plugins' },
  { to: '/memory', label: 'Memory', testId: 'nav-memory' },
  { to: '/design-systems', label: 'Design', testId: 'nav-design-systems' },
  { to: '/routines', label: 'Routines', testId: 'nav-routines' },
  { to: '/deployments', label: 'Deploy', testId: 'nav-deployments' },
  { to: '/media', label: 'Media', testId: 'nav-media' },
  { to: '/settings', label: 'Settings', testId: 'nav-settings' },
];

export function WebNav({ current }: { current?: string }) {
  return (
    <nav className="row" style={{ flexWrap: 'wrap', gap: 4 }} data-testid="web-nav">
      {LINKS.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          className="btn btn-ghost"
          data-testid={l.testId}
          aria-current={current === l.to ? 'page' : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
