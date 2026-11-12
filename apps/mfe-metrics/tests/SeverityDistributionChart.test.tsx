import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SeverityDistributionChart } from '../src/components/SeverityDistributionChart';
import { findingEvent } from './mocks/fixtures';

describe('SeverityDistributionChart', () => {
  it('exposes all severities and zero counts when there are no findings', () => {
    render(<SeverityDistributionChart findings={[]} />);

    expect(screen.getByRole('figure', { name: 'Findings by severity' })).toBeInTheDocument();
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      expect(
        within(screen.getByTestId(`severity-distribution-${severity}`)).getByRole('cell'),
      ).toHaveTextContent('0');
    }
  });

  it('shows matching counts for single and mixed severity findings', () => {
    render(
      <SeverityDistributionChart
        findings={[
          findingEvent(1, 'HIGH').payload,
          findingEvent(2, 'HIGH').payload,
          findingEvent(3, 'LOW').payload,
          findingEvent(4, 'CRITICAL').payload,
        ]}
      />,
    );

    expect(
      within(screen.getByTestId('severity-distribution-CRITICAL')).getByRole('cell'),
    ).toHaveTextContent('1');
    expect(
      within(screen.getByTestId('severity-distribution-HIGH')).getByRole('cell'),
    ).toHaveTextContent('2');
    expect(
      within(screen.getByTestId('severity-distribution-MEDIUM')).getByRole('cell'),
    ).toHaveTextContent('0');
    expect(
      within(screen.getByTestId('severity-distribution-LOW')).getByRole('cell'),
    ).toHaveTextContent('1');
  });
});
