import { describe, expect, it } from 'vitest';
import { landingRedirect } from '@/server/auth/landing';
import type { Viewer } from '@/server/auth/viewer';

const PERSON = { userId: 'user_1', name: 'Lan', email: 'lan@example.test', image: null };

const member = (sample: boolean): Viewer => ({
  kind: 'member',
  orgId: 'org_1',
  canWrite: true,
  role: 'owner',
  sample,
  ...PERSON,
});

const unenrolled = (sample: boolean): Viewer => ({ kind: 'unenrolled', sample, ...PERSON });

describe('who the landing page steps aside for', () => {
  it('pitches to a visitor with no session', () => {
    expect(landingRedirect(null)).toBeNull();
  });

  it('sends a member to their books, sample or not', () => {
    expect(landingRedirect(member(false))).toBe('/overview');
    expect(landingRedirect(member(true))).toBe('/overview');
  });

  it('sends a sample session whose ledger never filled back to the retry, not the demo', () => {
    // The trap this exists for: redirecting every session to /overview left
    // a failed sample visitor on the read-only demo with no way back to `/`.
    expect(landingRedirect(unenrolled(true))).toBe('/sign-in');
  });

  it('sends a signed-in account with no ledger to make one', () => {
    expect(landingRedirect(unenrolled(false))).toBe('/onboarding');
  });
});
