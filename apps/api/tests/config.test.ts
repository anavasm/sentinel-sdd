import { describe, expect, it } from 'vitest';

import { resolvePort } from '../src/lib/config.js';

describe('resolvePort', () => {
  it('defaults to 3000 when PORT is unset (openapi servers: localhost:3000)', () => {
    expect(resolvePort({})).toBe(3000);
  });

  it('defaults to 3000 when PORT is an empty string', () => {
    expect(resolvePort({ PORT: '' })).toBe(3000);
  });

  it('parses a valid PORT value', () => {
    expect(resolvePort({ PORT: '8080' })).toBe(8080);
  });

  it.each(['abc', '0', '-1', '70000', '3.14'])('rejects invalid PORT value "%s"', (invalidPort) => {
    expect(() => resolvePort({ PORT: invalidPort })).toThrowError(/Invalid PORT value/);
  });
});
