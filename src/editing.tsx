import { useEffect, useRef, useState } from 'react';

const SESSION_KEY = 'nt-editor-session';

export type BlockDraft = {
  address: string;
  bookId: string;
  kind: 'verse' | 'heading' | 'paragraph';
  verseNumber: string;
  text: string;
};

export function readStoredSession() {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function storeSession(token: string | null) {
  try {
    if (token) {
      window.localStorage.setItem(SESSION_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // A browser with storage disabled still works for the current page load.
  }
}

export function EditorLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/.netlify/functions/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Nu am putut intra.');
        return;
      }

      onLogin(body.token);
    } catch {
      setError('Nu am putut contacta serverul.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app editor-login">
      <form onSubmit={submit}>
        <h1>Editare text</h1>

        <label htmlFor="editor-password">Parolă</label>
        <input
          autoFocus
          id="editor-password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />

        {error ? <p className="editor-error">{error}</p> : null}

        <button disabled={busy || !password} type="submit">
          {busy ? 'Se verifică...' : 'Intră'}
        </button>
      </form>
    </main>
  );
}

export function EditorBar({
  dirtyCount,
  onPublish,
  onLogout,
  status,
  busy,
}: {
  dirtyCount: number;
  onPublish: () => void;
  onLogout: () => void;
  status: { kind: 'idle' | 'ok' | 'error'; message: string; problems?: string[] };
  busy: boolean;
}) {
  return (
    <div className="editor-bar">
      <span className="editor-bar-title">Mod editare</span>

      <span className="editor-bar-hint">
        {dirtyCount > 0
          ? `${dirtyCount} modificare${dirtyCount === 1 ? '' : 'i'} nepublicate`
          : 'Apasă pe un text ca să îl modifici'}
      </span>

      {status.message ? (
        <span className={status.kind === 'error' ? 'editor-bar-error' : 'editor-bar-ok'}>
          {status.message}
        </span>
      ) : null}

      <button className="editor-bar-publish" disabled={busy || dirtyCount === 0} onClick={onPublish} type="button">
        {busy ? 'Se publică...' : `Publică${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
      </button>

      <button className="editor-bar-logout" onClick={onLogout} type="button">Ieși</button>

      {status.problems?.length ? (
        <ul className="editor-problems">
          {status.problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function BlockEditor({
  draft,
  onCancel,
  onConfirm,
}: {
  draft: BlockDraft;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState(draft.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(draft.text);
    areaRef.current?.focus();
  }, [draft.address, draft.text]);

  const markersBefore = (draft.text.match(/\*/gu) ?? []).length;
  const markersAfter = (text.match(/\*/gu) ?? []).length;
  const markersChanged = markersBefore !== markersAfter;

  return (
    <div aria-modal="true" className="block-editor-backdrop" role="dialog" onClick={onCancel}>
      <div className="block-editor" onClick={(event) => event.stopPropagation()}>
        <header>
          {draft.kind === 'verse' ? (
            <span className="block-editor-verse">Versetul {draft.verseNumber}</span>
          ) : (
            <span className="block-editor-verse">{draft.kind === 'heading' ? 'Subtitlu' : 'Paragraf'}</span>
          )}
          <span className="block-editor-locked">numărul versetului este protejat</span>
        </header>

        <textarea
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onCancel();
            }
          }}
          ref={areaRef}
          rows={7}
          value={text}
        />

        {markersChanged ? (
          <p className="block-editor-warning">
            Ai schimbat numărul semnelor * ({markersBefore} → {markersAfter}). Fiecare notă de subsol are
            nevoie de exact un semn *, altfel textul nu poate fi publicat.
          </p>
        ) : null}

        <footer>
          <button onClick={onCancel} type="button">Anulează</button>
          <button className="block-editor-confirm" onClick={() => onConfirm(text)} type="button">Gata</button>
        </footer>
      </div>
    </div>
  );
}
