/**
 * US-2 acceptance tests: form defaults, fail-fast client validation (no
 * network call), successful POST -> navigation, and RFC 9457 field-error
 * binding (US2-AC1..AC4).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Problem } from '@sentinel/contracts';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigView } from '../src/ConfigView';

const VALID_REPO_URL = 'https://github.com/example/vulnerable-app.git';

function renderConfigView(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ConfigView />} />
        {/* Probe route: navigation on 201 lands here. */}
        <Route path="/audits/:auditId" element={<p>metrics view for audit</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConfigView (US-2 audit launch form)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the form with contract-derived defaults', () => {
    renderConfigView();

    expect(screen.getByRole('heading', { name: 'Audit Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Audit launch' })).toBeInTheDocument();

    // Repo source defaults to Git URL mode; the local-path input is not rendered.
    expect(screen.getByRole('radio', { name: 'Git URL' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Local path' })).not.toBeChecked();
    expect(screen.getByLabelText(/Repository URL/)).toHaveValue('');

    // Rule sets: OWASP Top 10 pre-selected, the other two not.
    expect(screen.getByRole('checkbox', { name: 'OWASP Top 10' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Test Quality' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Code Smells & Performance' })).not.toBeChecked();

    // Severity threshold defaults to MEDIUM per confirmed US-2 spec.
    expect(screen.getByLabelText(/Severity threshold/)).toHaveValue('MEDIUM');

    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeEnabled();
  });

  it('blocks submission with a field error and never calls the API when inputs are empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderConfigView();

    await userEvent.click(screen.getByRole('button', { name: 'Launch audit' }));

    expect(screen.getByText('Repository URL is required.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed repository URL client-side (format: uri)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderConfigView();

    await userEvent.type(screen.getByLabelText(/Repository URL/), 'not a uri at all');
    await userEvent.click(screen.getByRole('button', { name: 'Launch audit' }));

    expect(screen.getByText(/Repository URL must be a valid URI/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires a local path when the repo source is toggled to local', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderConfigView();

    await userEvent.click(screen.getByRole('radio', { name: 'Local path' }));
    await userEvent.click(screen.getByRole('button', { name: 'Launch audit' }));

    expect(screen.getByText('Local repository path is required.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires at least one rule set before submitting', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderConfigView();

    await userEvent.type(screen.getByLabelText(/Repository URL/), VALID_REPO_URL);
    await userEvent.click(screen.getByRole('checkbox', { name: 'OWASP Top 10' }));
    await userEvent.click(screen.getByRole('button', { name: 'Launch audit' }));

    expect(screen.getByText('Select at least one rule set.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the contract payload and navigates to /audits/:auditId on 201', async () => {
    const pendingResponse = deferred<Response>();
    const fetchSpy = vi.fn(() => pendingResponse.promise);
    vi.stubGlobal('fetch', fetchSpy);
    renderConfigView();

    await userEvent.type(screen.getByLabelText(/Repository URL/), VALID_REPO_URL);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Test Quality' }));
    await userEvent.selectOptions(screen.getByLabelText(/Severity threshold/), 'HIGH');
    await userEvent.click(screen.getByRole('button', { name: 'Launch audit' }));

    // In flight: submit button is disabled (double-submit guard, US2-AC4).
    expect(screen.getByRole('button', { name: 'Launching...' })).toBeDisabled();

    const recordedCall = fetchSpy.mock.calls[0] as unknown[] | undefined;
    expect(recordedCall).toBeDefined();
    expect(String(recordedCall?.[0])).toBe('http://localhost:3000/api/v1/audits');
    expect((recordedCall?.[1] as RequestInit).method).toBe('POST');
    const payload = JSON.parse(String((recordedCall?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(payload).toEqual({
      repoUrl: VALID_REPO_URL,
      ruleSets: { owaspTop10: true, testQuality: true, codeSmellsPerformance: false },
      severityThreshold: 'HIGH',
    });

    pendingResponse.resolve(
      new Response(JSON.stringify({ auditId: 'aud_123', status: 'queued' }), { status: 201 }),
    );

    // The probe route at /audits/:auditId renders, proving programmatic
    // navigation happened with the created auditId (MemoryRouter does not
    // mutate window.location).
    expect(await screen.findByText('metrics view for audit')).toBeInTheDocument();
  });

  it('renders RFC 9457 field errors and keeps the form usable after a 400 Problem', async () => {
    const problem: Problem = {
      type: 'https://sentinel.dev/problems/validation-error',
      title: 'Validation failed',
      status: 400,
      detail: 'Invalid audit configuration',
      errors: [
        { field: 'repoUrl', message: 'Repository is not reachable' },
        { field: 'unknownField', message: 'must never be rendered' },
      ],
    };
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(problem), { status: 400 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderConfigView();

    await userEvent.type(screen.getByLabelText(/Repository URL/), VALID_REPO_URL);
    await userEvent.click(screen.getByRole('button', { name: 'Launch audit' }));

    // Problem detail becomes the form-level alert; errors[] map onto inputs.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('Invalid audit configuration'))).toBe(true);
    expect(screen.getByText('Repository is not reachable')).toBeInTheDocument();
    expect(screen.queryByText('must never be rendered')).toBeNull();

    // Form recovered for a corrected resubmission.
    expect(screen.getByRole('button', { name: 'Launch audit' })).toBeEnabled();
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolveWith!: (value: T) => void;
  let rejectWith!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveWith = resolve;
    rejectWith = reject;
  });
  return { promise, resolve: resolveWith, reject: rejectWith };
}
