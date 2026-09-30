/**
 * FindingsList + FindingCard tests (US-4 Task 4.3): severity badges, rule
 * metadata, file/line location, and Before/After diff rendering.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FindingsList } from '../src/components/FindingsList';
import { findingEvent } from './mocks/fixtures';

describe('FindingsList', () => {
  it('shows an empty-state message before any finding arrives', () => {
    render(<FindingsList findings={[]} />);

    expect(screen.getByText(/findings will appear here/i)).toBeInTheDocument();
  });

  it('renders one card per finding with severity badge and metadata', () => {
    render(
      <FindingsList
        findings={[
          findingEvent(1, 'HIGH').payload,
          findingEvent(2, 'CRITICAL', {
            ruleId: 'owasp-a01-broken-access-control',
            title: 'Missing authorization check',
            filePath: 'src/api/admin.ts',
            lineNumber: 15,
            cweId: 'CWE-862',
          }).payload,
        ]}
      />,
    );

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(2);

    const [firstCard, secondCard] = cards;
    expect(within(firstCard!).getByTestId('finding-severity')).toHaveTextContent('HIGH');
    expect(within(firstCard!).getByText('owasp-a03-injection')).toBeInTheDocument();
    expect(within(firstCard!).getByText('src/auth/queries.ts:42')).toBeInTheDocument();

    expect(within(secondCard!).getByTestId('finding-severity')).toHaveTextContent('CRITICAL');
    expect(within(secondCard!).getByText('CWE-862')).toBeInTheDocument();
    expect(within(secondCard!).getByText('src/api/admin.ts:15')).toBeInTheDocument();
  });

  it('renders Before/After code snippets in the diff panels', () => {
    render(<FindingsList findings={[findingEvent(1, 'MEDIUM').payload]} />);

    const beforePanel = screen.getByTestId('finding-before');
    const afterPanel = screen.getByTestId('finding-after');
    expect(within(beforePanel).getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(
      within(afterPanel).getByText('db.query("SELECT * FROM users WHERE id = ?", [userId]);'),
    ).toBeInTheDocument();
  });

  it('omits the line suffix when lineNumber is absent', () => {
    const findingWithoutLine = { ...findingEvent(1, 'LOW') };
    delete (findingWithoutLine.payload as { lineNumber?: number }).lineNumber;
    render(<FindingsList findings={[findingWithoutLine.payload]} />);

    expect(screen.getByText('src/auth/queries.ts')).toBeInTheDocument();
  });
});
