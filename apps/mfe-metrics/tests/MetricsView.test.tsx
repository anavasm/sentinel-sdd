import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricsView } from '../src/MetricsView';

// US-1 smoke test: the federated surface mounts without errors.
describe('mfe-metrics MetricsView', () => {
  it('mounts and renders its heading', () => {
    render(<MetricsView />);

    expect(screen.getByRole('heading', { name: 'Audit Execution Metrics' })).toBeInTheDocument();
  });
});
