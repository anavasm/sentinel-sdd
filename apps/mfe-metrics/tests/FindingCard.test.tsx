import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FindingCard } from '../src/components/FindingCard';
import { findingEvent } from './mocks/fixtures';

describe('FindingCard', () => {
  it('renders Before and a clearly labeled manual After suggestion without applying a fix', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<FindingCard finding={findingEvent(1, 'HIGH').payload} />);

    expect(screen.getByTestId('finding-before')).toHaveTextContent('SELECT * FROM users');
    expect(screen.getByTestId('finding-after')).toHaveTextContent(
      'db.query("SELECT * FROM users WHERE id = ?", [userId]);',
    );
    expect(screen.getByText('Suggested After')).toBeInTheDocument();
    expect(screen.getByText(/apply it manually if appropriate/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply fix/i })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
