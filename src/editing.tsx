import { useEffect, useRef, useState } from 'react';

import { renderTextWithNotes } from './markup';

const SESSION_KEY = 'nt-editor-session';

export type BlockDraft = {
  address: string;
  /** Content file this edit belongs to, e.g. public/content/books/matei.json */
  path: string;
  label: string;
  /** Leading verse number, held aside so it cannot be edited away. */
  verseNumber: string;
  text: string;
  size: number;
  /** Footnote numbers for this text, so the preview matches the page. */
  noteRefs: number[];
  hasPrevious: boolean;
  hasNext: boolean;
  align: Align;
  spaceBefore: number;
  spaceAfter: number;
  /** Verses share a paragraph, so alignment and spacing only apply to some. */
  canLayout: boolean;
  /** Titles and footnotes have a fixed place; only blocks can be restructured. */
  canStructure: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
};

export type Align = 'left' | 'center' | 'right' | '';

export type BlockEdit = {
  text: string;
  size: number;
  align: Align;
  spaceBefore: number;
  spaceAfter: number;
};

const SIZES = [70, 80, 90, 100, 110, 125, 140, 160];
const SPACES = [
  { value: 0, label: 'Fără' },
  { value: 0.5, label: 'Puțin' },
  { value: 1, label: 'Mediu' },
  { value: 1.75, label: 'Mult' },
];

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
  onNavigate,
  onMove,
  onAdd,
  onDelete,
}: {
  draft: BlockDraft;
  onCancel: () => void;
  onConfirm: (edit: BlockEdit) => void;
  onNavigate: (direction: -1 | 1, edit: BlockEdit) => void;
  onMove: (direction: -1 | 1, edit: BlockEdit) => void;
  onAdd: (type: 'heading' | 'paragraph', edit: BlockEdit) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(draft.text);
  const [size, setSize] = useState(draft.size);
  const [align, setAlign] = useState<Align>(draft.align);
  const [spaceBefore, setSpaceBefore] = useState(draft.spaceBefore);
  const [spaceAfter, setSpaceAfter] = useState(draft.spaceAfter);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(draft.text);
    setSize(draft.size);
    setAlign(draft.align);
    setSpaceBefore(draft.spaceBefore);
    setSpaceAfter(draft.spaceAfter);
    setConfirmingDelete(false);
    areaRef.current?.focus();
  }, [draft.address, draft.text, draft.size, draft.align, draft.spaceBefore, draft.spaceAfter]);

  const edit = (): BlockEdit => ({ text, size, align, spaceBefore, spaceAfter });

  /** Replaces the selection, keeping it selected so edits can be stacked. */
  function replaceSelection(build: (selected: string) => string) {
    const area = areaRef.current;

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;
    const selected = text.slice(start, end);

    if (!selected) {
      return;
    }

    const replacement = build(selected);
    setText(`${text.slice(0, start)}${replacement}${text.slice(end)}`);

    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start, start + replacement.length);
    });
  }

  /** Italic uses `_` so it can never be mistaken for a footnote marker. */
  const wrap = (open: string, close = open) => replaceSelection((selected) => `${open}${selected}${close}`);

  /** Only paired markup is removed; a lone `*` is a footnote marker. */
  const clearFormatting = () => replaceSelection((selected) => selected
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/_([^_\n]+)_/gu, '$1'));

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const modifier = event.metaKey || event.ctrlKey;

    if (event.key === 'Escape') {
      onCancel();
      return;
    }

    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      onConfirm(edit());
      return;
    }

    if (modifier && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      wrap('**');
      return;
    }

    if (modifier && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      wrap('_');
    }
  }

  const markersBefore = countMarkers(draft.text);
  const markersAfter = countMarkers(text);
  const markersChanged = markersBefore !== markersAfter;

  const previewStyle: React.CSSProperties = { fontSize: `calc(1.02rem * ${size / 100})` };

  if (draft.canLayout && align) {
    previewStyle.textAlign = align;
  }

  return (
    <div aria-modal="true" className="block-editor-backdrop" role="dialog" onClick={onCancel}>
      <div className="block-editor" onClick={(event) => event.stopPropagation()}>
        <header>
          <span className="block-editor-verse">{draft.label}</span>

          <span className="block-editor-nav">
            <button disabled={!draft.hasPrevious} onClick={() => onNavigate(-1, edit())} title="Textul dinainte" type="button">←</button>
            <button disabled={!draft.hasNext} onClick={() => onNavigate(1, edit())} title="Textul următor" type="button">→</button>
          </span>
        </header>

        <div className="block-toolbar">
          <button onClick={() => wrap('**')} title="Îngroșat (Ctrl+B)" type="button"><strong>B</strong></button>
          <button onClick={() => wrap('_')} title="Înclinat (Ctrl+I)" type="button"><em>I</em></button>
          <button onClick={() => wrap('„', '”')} title="Ghilimele românești" type="button">„ ”</button>
          <button className="block-toolbar-clear" onClick={clearFormatting} type="button">Șterge formatarea</button>

          <span className="block-toolbar-divider" />

          <label className="block-toolbar-size">
            Mărime
            <select onChange={(event) => setSize(Number(event.target.value))} value={size}>
              {SIZES.map((option) => <option key={option} value={option}>{option}%</option>)}
            </select>
          </label>
        </div>

        {draft.canLayout ? (
          <div className="block-toolbar block-toolbar-layout">
            <span className="block-toolbar-caption">Așezare</span>

            <span className="block-align-group">
              {([['left', '⟵'], ['center', '↔'], ['right', '⟶']] as const).map(([value, glyph]) => (
                <button
                  aria-pressed={align === value}
                  className={align === value ? 'is-active' : undefined}
                  key={value}
                  onClick={() => setAlign(align === value ? '' : value)}
                  title={value === 'left' ? 'La stânga' : value === 'center' ? 'La mijloc' : 'La dreapta'}
                  type="button"
                >
                  {glyph}
                </button>
              ))}
            </span>

            <label className="block-toolbar-size">
              Spațiu deasupra
              <select onChange={(event) => setSpaceBefore(Number(event.target.value))} value={spaceBefore}>
                {SPACES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <label className="block-toolbar-size">
              dedesubt
              <select onChange={(event) => setSpaceAfter(Number(event.target.value))} value={spaceAfter}>
                {SPACES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        <textarea onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} ref={areaRef} rows={5} value={text} />

        <div className="block-preview">
          <span className="block-preview-label">Cum va arăta</span>
          <p className="block-preview-body" style={previewStyle}>
            {draft.verseNumber ? <sup>{draft.verseNumber}</sup> : null}
            {renderTextWithNotes(draft.verseNumber ? text.trimStart() : text, draft.noteRefs)}
          </p>
        </div>

        {markersChanged ? (
          <p className="block-editor-warning">
            Ai schimbat numărul semnelor * ({markersBefore} → {markersAfter}). Fiecare notă de subsol are
            nevoie de exact un semn *, altfel textul nu poate fi publicat.
          </p>
        ) : null}

        {draft.canStructure ? (
          <div className="block-structure">
            <span className="block-toolbar-caption">Structură</span>

            <button disabled={!draft.canMoveUp} onClick={() => onMove(-1, edit())} type="button">↑ Mută mai sus</button>
            <button disabled={!draft.canMoveDown} onClick={() => onMove(1, edit())} type="button">↓ Mută mai jos</button>
            <button onClick={() => onAdd('heading', edit())} type="button">+ Subtitlu</button>
            <button onClick={() => onAdd('paragraph', edit())} type="button">+ Paragraf</button>

            <button
              className={confirmingDelete ? 'block-delete is-confirming' : 'block-delete'}
              disabled={!draft.canDelete}
              onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
              type="button"
            >
              {confirmingDelete ? 'Sigur? Apasă din nou' : 'Șterge textul'}
            </button>
          </div>
        ) : null}

        <footer>
          {draft.verseNumber ? <span className="block-editor-locked">numărul versetului este protejat</span> : null}
          <button onClick={onCancel} type="button">Anulează</button>
          <button className="block-editor-confirm" onClick={() => onConfirm(edit())} type="button">Gata</button>
        </footer>
      </div>
    </div>
  );
}

/** Counts lone asterisks, ignoring the `**` used for bold. */
function countMarkers(text: string) {
  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '*' && text[index - 1] !== '*' && text[index + 1] !== '*') {
      count += 1;
    }
  }

  return count;
}
