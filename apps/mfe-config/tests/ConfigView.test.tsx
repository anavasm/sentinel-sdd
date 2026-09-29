import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigView } from '../src/ConfigView';

// US-1 smoke test: the federated surface mounts without errors.
describe('mfe-config ConfigView', () => {
  it('mounts and renders its heading', () => {
    render(<ConfigView />);

    expect(screen.getByRole('heading', { name: 'Audit Configuration' })).toBeInTheDocument();
  });
});
