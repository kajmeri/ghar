import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '../src/redirects';

describe('safeRedirectPath', () => {
  it.each([
    ['/', '/'],
    ['/settings/household', '/settings/household'],
    ['/invite?token=abc123', '/invite?token=abc123'],
    ['/finances#recent', '/finances#recent'],
    ['/settings/../finances', '/finances'],
    ['/travel/.', '/travel/'],
  ])('keeps %s', (value, expected) => {
    expect(safeRedirectPath(value)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'settings',
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/..//evil.example',
    '/.//evil.example',
    '/%2e%2e//evil.example',
    '/a/../..//evil.example',
    '/\n/evil.example',
    'javascript:alert(1)',
  ])('refuses %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });

  it('uses the fallback it is given', () => {
    expect(safeRedirectPath('//evil.example', '/onboarding')).toBe('/onboarding');
  });
});
