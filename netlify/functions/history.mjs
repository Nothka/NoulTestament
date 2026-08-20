import { isValidSession, json } from './_session.mjs';

/** Recent commits that touched the content, for the editor's history panel. */
export async function handler(event) {
  const secret = process.env.SESSION_SECRET;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!secret || !token || !repo) {
    return json(500, { error: 'Serverul nu este configurat.' });
  }

  if (!isValidSession((event.headers.authorization ?? '').replace(/^Bearer /u, ''), secret)) {
    return json(401, { error: 'Sesiunea a expirat. Intră din nou cu parola.' });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/commits?sha=${branch}&path=public/content&per_page=25`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'noultestament-editor',
        },
      },
    );

    if (!response.ok) {
      return json(502, { error: 'Nu am putut încărca istoricul.' });
    }

    const commits = await response.json();

    return json(200, {
      commits: commits.map((commit) => ({
        sha: commit.sha,
        message: (commit.commit?.message ?? '').split('\n')[0],
        date: commit.commit?.author?.date ?? '',
      })),
    });
  } catch {
    return json(502, { error: 'Nu am putut încărca istoricul.' });
  }
}
