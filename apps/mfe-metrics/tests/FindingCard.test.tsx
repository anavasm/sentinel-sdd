/**
 * FindingCard remediation tests (US-5): "Apply Fix" triggers the API call,
 * button transitions to "Applying…", success renders the green "Fix Applied"
 * badge, and failures surface contextual RFC 9457 messages on the card.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '@sentinel/contracts';
import { FindingCard } from '../src/components/FindingCard';
import type { RemediationResult } from '@sentinel/contracts';
import { AUDIT_ID, findingEvent } from './mocks/fixtures';

const applyFixMock = vi.fn<(auditId: string, finding: unknown) => Promise<RemediationResult>>();

vi.mock('../src/lib/remediationApi', () => ({
  remediationApi: {
    applyFix: (auditId: string, finding: unknown) => applyFixMock(auditId, finding),
  },
}));

const SAMPLE_FINDING = findingEvent(1, 'HIGH').payload;

describe('FindingCard remediation (US-5)', () => {
  afterEach(() => {
    applyFixMock.mockReset();
  });

  it('renders no Apply Fix button when no auditId is provided', () => {
    render(<FindingCard finding={SAMPLE_FINDING} />);

    expect(screen.queryByTestId('apply-fix-button')).not.toBeInTheDocument();
  });

  it('triggers the remediation API call with the card audit and shows "Applying…"', async () => {
    let resolveApply: ((result: RemediationResult) => void) | undefined;
    applyFixMock.mockReturnValue(
      new Promise<RemediationResult>((resolve) => {
        resolveApply = resolve;
      }),
    );
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    const applyButton = screen.getByTestId('apply-fix-button');
    fireEvent.click(applyButton);

    // Pending request: button disabled with the in-flight label.
    expect(applyFixMock).toHaveBeenCalledWith(AUDIT_ID, SAMPLE_FINDING);
    expect(screen.getByTestId('apply-fix-button')).toHaveTextContent('Applying…');
    expect(screen.getByTestId('apply-fix-button')).toBeDisabled();

    await waitFor(() => resolveApply?.({ status: 'applied', message: 'ok' }));

    expect(screen.getByTestId('remediation-applied')).toHaveTextContent('✓ Fix Applied');
    expect(screen.queryByTestId('apply-fix-button')).not.toBeInTheDocument();
  });

  it('shows the green Fix Applied badge on a successful response', async () => {
    applyFixMock.mockResolvedValue({
      status: 'applied',
      message: 'Patch applied to src/auth/queries.ts (1 hunk)',
    });
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    fireEvent.click(screen.getByTestId('apply-fix-button'));

    const appliedBadge = await screen.findByTestId('remediation-applied');
    expect(appliedBadge).toHaveTextContent('✓ Fix Applied');
    expect(screen.queryByTestId('remediation-error')).not.toBeInTheDocument();
  });

  it('renders the 200 failed outcome message as a contextual failure', async () => {
    applyFixMock.mockResolvedValue({
      status: 'failed',
      message: 'Hunk no longer applies: file changed on disk',
    });
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    fireEvent.click(screen.getByTestId('apply-fix-button'));

    const failureMessage = await screen.findByTestId('remediation-error');
    expect(failureMessage).toHaveAttribute('role', 'alert');
    expect(failureMessage).toHaveTextContent('Hunk no longer applies: file changed on disk');
    // Failed attempts may be retried: the button comes back.
    expect(screen.getByTestId('apply-fix-button')).toHaveTextContent('Apply Fix');
    expect(screen.getByTestId('apply-fix-button')).toBeEnabled();
  });

  it('surfaces the RFC 9457 Problem detail when the API rejects', async () => {
    applyFixMock.mockRejectedValue(
      new ApiProblemError({
        type: 'https://sentinel.dev/problems/patch-conflict',
        title: 'Patch conflict',
        status: 409,
        detail: 'File changed since the finding was generated',
      }),
    );
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    fireEvent.click(screen.getByTestId('apply-fix-button'));

    const failureMessage = await screen.findByTestId('remediation-error');
    expect(failureMessage).toHaveTextContent('File changed since the finding was generated');
    expect(screen.queryByTestId('remediation-applied')).not.toBeInTheDocument();
  });

  it('falls back to the Problem title when no detail is present', async () => {
    applyFixMock.mockRejectedValue(
      new ApiProblemError({
        type: 'https://sentinel.dev/problems/not-found',
        title: 'Finding not found',
        status: 404,
      }),
    );
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    fireEvent.click(screen.getByTestId('apply-fix-button'));

    expect(await screen.findByTestId('remediation-error')).toHaveTextContent('Finding not found');
  });

  it('shows a contextual message for non-Problem transport errors', async () => {
    applyFixMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    fireEvent.click(screen.getByTestId('apply-fix-button'));

    expect(await screen.findByTestId('remediation-error')).toHaveTextContent('Failed to fetch');
  });

  it('describes unparseable Problem bodies with the HTTP status', async () => {
    const { UnparseableProblemError } = await import('@sentinel/contracts');
    applyFixMock.mockRejectedValue(new UnparseableProblemError(502, new Error('bad json')));
    render(<FindingCard finding={SAMPLE_FINDING} auditId={AUDIT_ID} />);

    fireEvent.click(screen.getByTestId('apply-fix-button'));

    expect(await screen.findByTestId('remediation-error')).toHaveTextContent(
      'Patch failed — API responded 502 with an unexpected body',
    );
  });
});
