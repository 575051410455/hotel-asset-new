// Whether a verified Google identity may sign in, and to which account
// (docs/specs/security-hardening-and-user-management.md, "Identity and MFA").
//
// Google identifies a person; only an account an administrator prepared grants
// access, so sign-in never creates one. Once linked, the immutable Google
// subject is the account's identity: a later email change does not rebind it,
// and a different Google account that happens to use the same email is refused.
// Pure, so the rule is tested without Google.

export type AccountForGoogle = { id: number; status: string; googleSub: string | null };

export type GoogleClaims = { sub: string; emailVerified: boolean };

export type GoogleRefusal =
  | 'email_unverified'
  | 'no_account'
  | 'account_inactive'
  | 'linked_to_another_google_account';

export type GoogleSignInDecision =
  | { ok: true; userId: number; /** first sign-in: record the subject on the account */ link: boolean }
  | { ok: false; reason: GoogleRefusal };

/**
 * @param bySubject the account already linked to this Google subject, if any
 * @param byEmail   the account whose email matches the verified Google email, if any
 */
export function googleSignInDecision(
  bySubject: AccountForGoogle | undefined,
  byEmail: AccountForGoogle | undefined,
  claims: GoogleClaims
): GoogleSignInDecision {
  if (!claims.emailVerified) return { ok: false, reason: 'email_unverified' };

  if (bySubject) {
    return bySubject.status === 'active'
      ? { ok: true, userId: bySubject.id, link: false }
      : { ok: false, reason: 'account_inactive' };
  }

  if (!byEmail) return { ok: false, reason: 'no_account' };
  if (byEmail.status !== 'active') return { ok: false, reason: 'account_inactive' };
  if (byEmail.googleSub !== null && byEmail.googleSub !== claims.sub) {
    return { ok: false, reason: 'linked_to_another_google_account' };
  }
  return { ok: true, userId: byEmail.id, link: byEmail.googleSub === null };
}
