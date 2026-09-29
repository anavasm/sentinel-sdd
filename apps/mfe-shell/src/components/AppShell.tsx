import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface AppShellProps {
  children: ReactNode;
}

/**
 * App shell chrome: header + primary navigation. The shell owns all routing
 * and navigation; remotes never route across each other (ADR-005 rule 1).
 */
export function AppShell({ children }: AppShellProps): ReactNode {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-700 bg-sentinel-panel">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-sentinel-accent">
            DevSecOps Sentinel AI
          </span>
          <nav aria-label="Primary" className="flex gap-6 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive
                  ? 'font-medium text-sentinel-accent'
                  : 'text-slate-300 hover:text-slate-100'
              }
            >
              Configuration
            </NavLink>
            <span aria-hidden="true" className="text-slate-600">
              Metrics
            </span>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-slate-700 px-6 py-3 text-center text-xs text-slate-500">
        Sentinel AI MVP — microfrontend shell (host)
      </footer>
    </div>
  );
}
