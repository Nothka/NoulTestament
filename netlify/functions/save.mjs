import { isValidSession, json } from './_session.mjs';
import { findBookProblems, findIntroductionProblems } from '../../src/content-validation.js';

const API = 'https://api.github.com';
const EDITABLE_PATH = /^public\/content\/(introduction\.json|books\/[a-z0-9-]+\.json)$/u;

async function github(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'noultestament-editor',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub ${options.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Metodă nepermisă.' });
  }

  const secret = process.env.SESSION_SECRET;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!secret || !token || !repo) {
    return json(500, { error: 'Serverul nu este configurat (SESSION_SECRET / GITHUB_TOKEN / GITHUB_REPO).' });
  }

  if (!isValidSession((event.headers.authorization ?? '').replace(/^Bearer /u, ''), secret)) {
    return json(401, { error: 'Sesiunea a expirat. Intră din nou cu parola.' });
  }

  let payload;

  try {
    payload = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Cerere invalidă.' });
  }

  const files = Array.isArray(payload.files) ? payload.files : [];

  if (files.length === 0) {
    return json(400, { error: 'Nu ai făcut nicio modificare.' });
  }

  // Reject anything outside the content folder before it reaches GitHub.
  for (const file of files) {
    if (typeof file?.path !== 'string' || !EDITABLE_PATH.test(file.path)) {
      return json(400, { error: `Fișier nepermis: ${file?.path}` });
    }
  }

  // Same invariants the build enforces, so a mistake is caught here in a
  // second rather than by a failed deploy a couple of minutes later.
  const problems = [];

  for (const file of files) {
    const location = file.path.replace('public/content/', '');

    problems.push(...(file.path.endsWith('introduction.json')
      ? findIntroductionProblems(file.content ?? {}, location)
      : findBookProblems(file.content ?? {}, location)));
  }

  if (problems.length > 0) {
    return json(422, { error: 'Textul nu poate fi salvat.', problems });
  }

  try {
    const ref = await github(`/repos/${repo}/git/ref/heads/${branch}`, token);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await github(`/repos/${repo}/git/commits/${baseCommitSha}`, token);

    const tree = await Promise.all(files.map(async (file) => {
      const blob = await github(`/repos/${repo}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify({
          content: `${JSON.stringify(file.content, null, 2)}\n`,
          encoding: 'utf-8',
        }),
      });

      return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
    }));

    const newTree = await github(`/repos/${repo}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });

    const message = typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim().slice(0, 72)
      : `Editare text (${files.length} fișier${files.length === 1 ? '' : 'e'})`;

    const commit = await github(`/repos/${repo}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
    });

    await github(`/repos/${repo}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });

    return json(200, { commit: commit.sha });
  } catch (error) {
    return json(502, { error: 'Salvarea a eșuat.', detail: String(error.message ?? error).slice(0, 300) });
  }
}
