import { describe, expect, it } from 'vitest';
import { isAllowedCaller } from './requestSync';

describe('isAllowedCaller', () => {
  const allowed = ['owner@example.com'];
  it('allows a verified allowlisted email, case-insensitively', () => {
    expect(isAllowedCaller({ email: 'Owner@Example.com', email_verified: true }, allowed)).toBe(true);
  });
  it('rejects unverified, unlisted or missing identities', () => {
    expect(isAllowedCaller({ email: 'owner@example.com', email_verified: false }, allowed)).toBe(false);
    expect(isAllowedCaller({ email: 'other@example.com', email_verified: true }, allowed)).toBe(false);
    expect(isAllowedCaller(undefined, allowed)).toBe(false);
  });
});
