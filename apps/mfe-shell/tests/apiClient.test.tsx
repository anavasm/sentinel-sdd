import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Problem } from '@sentinel/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/AppShell';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { apiFetch, ApiProblemError, UnparseableProblemError } from '../src/lib/apiClient';

describe('AppShell', () => {
  it('renders header, navigation and its children', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>Shell content</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByText('Shell content')).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  function ThrowingComponent(): never {
    throw new Error('remote exploded');
  }

  it('renders a friendly fallback when a remote crashes', () => {
    // Silence the expected console.error from React + the boundary.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary contextLabel="Test Remote">
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Test Remote failed to load');
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary contextLabel="Test Remote">
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });
});

// Silence React's error-logging for the intentional crash above.
afterAll(() => {
  vi.restoreAllMocks();
});

describe('apiClient (RFC 9457 Problem handling)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('returns the parsed JSON body on 2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ auditId: 'aud_1', status: 'queued' }), { status: 201 }),
      ),
    );

    const result = await apiFetch<{ auditId: string; status: string }>('/audits', {
      method: 'POST',
    });

    expect(result.auditId).toBe('aud_1');
  });

  it('throws ApiProblemError carrying the Problem payload on 4xx', async () => {
    const problem: Problem = {
      type: 'https://sentinel.dev/problems/validation-error',
      title: 'Validation failed',
      status: 400,
      detail: 'Invalid audit configuration',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(problem), { status: 400 })),
    );

    const apiCall = apiFetch('/audits', { method: 'POST' });

    await expect(apiCall).rejects.toBeInstanceOf(ApiProblemError);
    try {
      await apiFetch('/audits', { method: 'POST' });
    } catch (error) {
      expect((error as ApiProblemError).problem.status).toBe(400);
      expect((error as ApiProblemError).problem.detail).toBe('Invalid audit configuration');
    }
  });

  it('throws UnparseableProblemError when the error body is not a Problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway error</html>', { status: 502 })),
    );

    await expect(apiFetch('/audits')).rejects.toBeInstanceOf(UnparseableProblemError);
  });

  it('requests paths under the configured API base URL', async () => {
    // The module resolves the base URL at import time; in tests no env var is
    // set, so the documented default applies.
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await apiFetch('/audits/aud_x');

    const recordedCall: unknown[] | undefined = fetchSpy.mock.calls.at(0);
    if (!isRecordedCall(recordedCall)) {
      throw new Error('fetch was not called');
    }
    expect(String(recordedCall[0])).toBe('http://localhost:3000/api/v1/audits/aud_x');
  });
});

function isRecordedCall(call: unknown[] | undefined): call is unknown[] {
  return Array.isArray(call) && call.length > 0;
}
