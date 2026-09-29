import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

// Smoke tests per plan US1-AC4. The remote module specifiers are aliased to
// the real remote sources in vitest.config.ts, so this exercises the full
// routing + shell + boundary composition without running remote dev servers.
// Remote views are lazy-loaded, so assertions use findBy* (async resolution).
describe('mfe-shell App', () => {
  it('renders the shell chrome and the config remote at "/"', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('banner')).toHaveTextContent('DevSecOps Sentinel AI');
    expect(
      await screen.findByRole('heading', { name: 'Audit Configuration' }),
    ).toBeInTheDocument();
  });

  it('routes /audits/:auditId to the metrics remote', async () => {
    render(
      <MemoryRouter initialEntries={['/audits/aud_test123']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Audit Execution Metrics' }),
    ).toBeInTheDocument();
  });

  it('renders the not-found fallback for unknown routes', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('renders the primary navigation', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });
});
