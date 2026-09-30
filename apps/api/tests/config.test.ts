import { describe, expect, it } from 'vitest';

import { resolveAllowedOrigins, resolvePort } from '../src/lib/config.js';

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

describe('resolveAllowedOrigins', () => {
  it('defaults to the MFE dev-server ports when ALLOWED_ORIGINS is unset', () => {
    expect(resolveAllowedOrigins({})).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
    ]);
  });

  it('defaults to the MFE dev-server ports when ALLOWED_ORIGINS is empty', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGINS: '' })).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
    ]);
  });

  it('parses a comma-separated ALLOWED_ORIGINS override', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGINS: 'https://app.example.com, https://app2.example.com' })).toEqual([
      'https://app.example.com',
      'https://app2.example.com',
    ]);
  });

  it('trims whitespace and drops empty entries from the override', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGINS: '  https://a.example.com , , https://b.example.com ' })).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('rejects an ALLOWED_ORIGINS value containing only separators', () => {
    expect(() => resolveAllowedOrigins({ ALLOWED_ORIGINS: ' , , ' })).toThrowError(
      /Invalid ALLOWED_ORIGINS value/,
    );
  });
});
