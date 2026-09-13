// Shared by JWT issuance and verification during the session migration.
// Never permit a source-visible fallback, including in development.
export function parseJwtSecret(value: string | undefined): Uint8Array {
  if (!value || value.trim() !== value || value.length < 32 ||
      /default|change[-_ ]?(?:me|this)|placeholder|example|your[-_ ]?secret/i.test(value)) {
    throw new Error('JWT_SECRET must be a generated secret of at least 32 characters, not a placeholder');
  }
  return new TextEncoder().encode(value);
}

export const jwtSecret = parseJwtSecret(process.env.JWT_SECRET);
