import { isValidSession, json } from './_session.mjs';

/**
 * Commit messages are permanent, and the older ones were written in English by
 * the previous CMS and during development. The panel is read by the editor, so
 * describe each change in Romanian rather than showing the raw message.
 */
function describe(message) {
  const first = (message ?? '').split('\n')[0].trim();

  if (/^Editare text/u.test(first)) {
    return { text: first, byEditor: true };
  }

  if (/^Update Cărți/u.test(first)) {
    return { text: 'Actualizare text (editorul vechi)', byEditor: false };
  }

  if (/^Delete Cărți/u.test(first)) {
    return { text: 'Ștergere carte (editorul vechi)', byEditor: false };
  }

  return { text: 'Modificare tehnică', byEditor: false };
}

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
      commits: commits.map((commit) => {
        const described = describe(commit.commit?.message);

        return {
          sha: commit.sha,
          message: described.text,
          byEditor: described.byEditor,
          date: commit.commit?.author?.date ?? '',
        };
      }),
    });
  } catch {
    return json(502, { error: 'Nu am putut încărca istoricul.' });
  }
}
