import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_HOURS = 12;

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Sessions are stateless: `<expiry>.<hmac>`. There is a single editor, so there
 * is no user id to carry — only the expiry needs protecting from tampering.
 */
export function createSession(secret) {
  const expiresAt = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  return `${expiresAt}.${sign(expiresAt, secret)}`;
}

export function isValidSession(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return false;
  }

  const [expiresAt, signature] = token.split('.');

  if (!/^\d+$/u.test(expiresAt ?? '') || !signature) {
    return false;
  }

  const expected = Buffer.from(sign(expiresAt, secret));
  const received = Buffer.from(signature);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return false;
  }

  return Number(expiresAt) > Date.now();
}

export function matchesPassword(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !expected) {
    return false;
  }

  // Hash both sides first so timingSafeEqual never sees mismatched lengths,
  // which would leak the password length through an early return.
  const a = createHmac('sha256', 'pw').update(candidate).digest();
  const b = createHmac('sha256', 'pw').update(expected).digest();

  return timingSafeEqual(a, b);
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}
