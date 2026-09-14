// The Google sign-in rule: link only to a prepared, Active account; never create one.
import { describe, expect, test } from 'bun:test';
import { googleSignInDecision, type AccountForGoogle } from '../src/lib/google-identity';

const verified = { sub: 'google-sub-1', emailVerified: true };
const account = (over: Partial<AccountForGoogle> = {}): AccountForGoogle => ({
  id: 7,
  status: 'active',
  googleSub: null,
  ...over,
});

describe('googleSignInDecision', () => {
  test('an unverified Google email is refused, whatever accounts exist', () => {
    expect(googleSignInDecision(account({ googleSub: 'google-sub-1' }), undefined, { ...verified, emailVerified: false }))
      .toEqual({ ok: false, reason: 'email_unverified' });
  });

  test('no prepared account means no sign-in — nothing is created', () => {
    expect(googleSignInDecision(undefined, undefined, verified)).toEqual({ ok: false, reason: 'no_account' });
  });

  test('first sign-in links the Google subject to the prepared Active account with that email', () => {
    expect(googleSignInDecision(undefined, account(), verified)).toEqual({ ok: true, userId: 7, link: true });
  });

  test('a linked subject signs in to its own account, even after the account email changed', () => {
    expect(googleSignInDecision(account({ googleSub: 'google-sub-1' }), undefined, verified))
      .toEqual({ ok: true, userId: 7, link: false });
  });

  test('a different Google account using an already-linked email is refused', () => {
    expect(googleSignInDecision(undefined, account({ googleSub: 'google-sub-OTHER' }), verified))
      .toEqual({ ok: false, reason: 'linked_to_another_google_account' });
  });

  test('suspended and archived accounts are refused by subject and by email', () => {
    for (const status of ['suspended', 'archived']) {
      expect(googleSignInDecision(account({ status, googleSub: 'google-sub-1' }), undefined, verified))
        .toEqual({ ok: false, reason: 'account_inactive' });
      expect(googleSignInDecision(undefined, account({ status }), verified))
        .toEqual({ ok: false, reason: 'account_inactive' });
    }
  });
});
