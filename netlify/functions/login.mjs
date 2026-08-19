import { createSession, json, matchesPassword } from './_session.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Metodă nepermisă.' });
  }

  const password = process.env.EDITOR_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!password || !secret) {
    return json(500, { error: 'Serverul nu este configurat (EDITOR_PASSWORD / SESSION_SECRET).' });
  }

  let payload;

  try {
    payload = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Cerere invalidă.' });
  }

  if (!matchesPassword(payload.password, password)) {
    return json(401, { error: 'Parolă greșită.' });
  }

  return json(200, { token: createSession(secret) });
}
