import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const OWNER = 'owner@example.com';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/app'), { allowedEmails: [OWNER] });
    await setDoc(doc(db, 'daily/2026-11-10_noise'), { date: '2026-11-10' });
  });
});

const as = (email: string, verified = true) =>
  env.authenticatedContext('uid-' + email, { email, email_verified: verified }).firestore();

describe('firestore.rules', () => {
  it('lets the allowlisted, verified owner read', async () => {
    await assertSucceeds(getDoc(doc(as(OWNER), 'daily/2026-11-10_noise')));
    await assertSucceeds(getDoc(doc(as(OWNER), 'config/app')));
  });

  it('matches the allowlist case-insensitively', async () => {
    await assertSucceeds(getDoc(doc(as('Owner@Example.com'), 'daily/2026-11-10_noise')));
  });

  it('denies an unverified email', async () => {
    await assertFails(getDoc(doc(as(OWNER, false), 'daily/2026-11-10_noise')));
  });

  it('denies an email not on the allowlist', async () => {
    await assertFails(getDoc(doc(as('stranger@example.com'), 'daily/2026-11-10_noise')));
    await assertFails(getDoc(doc(as('stranger@example.com'), 'config/app')));
  });

  it('denies signed-out users', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'daily/2026-11-10_noise')));
  });

  it('denies all client writes, even for the owner', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'daily/2026-11-10_noise'), { date: 'x' }));
    await assertFails(setDoc(doc(as(OWNER), 'config/app'), { allowedEmails: [OWNER, 'evil@example.com'] }));
  });

  it('denies everyone when config/app is missing', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('config/app').delete());
    await assertFails(getDoc(doc(as(OWNER), 'daily/2026-11-10_noise')));
  });
});
