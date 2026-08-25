import { useEffect, useRef, useState } from 'react';

import { renderTextWithNotes } from './markup';

const SESSION_KEY = 'nt-editor-session';
const WORK_KEY = 'nt-editor-work';

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
  canDelete: boolean;
  /** Free position set by dragging, as a share of the element's own width. */
  offsetX: number;
  /** Free position set by dragging, in rem. */
  offsetY: number;
};

export type Align = 'left' | 'center' | 'right' | '';

/** One element the editor has changed but not yet published. */
export type PendingChange = {
  address: string;
  path: string;
  label: string;
  where: string;
  original: string;
  current: string;
  /**
   * Size, alignment, spacing and position, before and after. Without these a
   * change that only moved or restyled an element compared equal to no change
   * at all, and was dropped before it could ever be published. Keeping the
   * values rather than a signature also lets "Anulează" put the old look back.
   */
  originalLook: Look;
  currentLook: Look;
  at: number;
};

/** Everything about an element except its words. */
export type Look = {
  size: number;
  align: Align;
  spaceBefore: number;
  spaceAfter: number;
  offsetX: number;
  offsetY: number;
};

export function sameLook(a: Look, b: Look) {
  return a.size === b.size
    && a.align === b.align
    && a.spaceBefore === b.spaceBefore
    && a.spaceAfter === b.spaceAfter
    && a.offsetX === b.offsetX
    && a.offsetY === b.offsetY;
}

export type PublishedChange = {
  sha: string;
  message: string;
  date: string;
  /** True when the change came from this editor rather than from development. */
  byEditor?: boolean;
};

export type BlockEdit = {
  text: string;
  size: number;
  align: Align;
  spaceBefore: number;
  spaceAfter: number;
  offsetX: number;
  offsetY: number;
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

/**
 * Edits that have not been published yet, kept so closing the tab, a refresh or
 * a crash does not throw away an afternoon of work. The changed files are
 * stored whole rather than replayed from `changes`, because a replay cannot
 * reproduce a deleted block or the layout fields.
 */
export type StoredWork = {
  at: number;
  changes: PendingChange[];
  files: Record<string, unknown>;
};

export function readStoredWork(): StoredWork | null {
  try {
    const raw = window.localStorage.getItem(WORK_KEY);
    const work = raw ? JSON.parse(raw) : null;

    if (!work || !Array.isArray(work.changes) || !work.files || work.changes.length === 0) {
      return null;
    }

    return work as StoredWork;
  } catch {
    return null;
  }
}

/**
 * Returns false when the work could not be stored — a full or disabled store —
 * so the editor can warn that the page must stay open until it is published.
 */
export function storeWork(work: StoredWork | null): boolean {
  try {
    if (work) {
      window.localStorage.setItem(WORK_KEY, JSON.stringify(work));
    } else {
      window.localStorage.removeItem(WORK_KEY);
    }

    return true;
  } catch {
    return false;
  }
}

export function EditorLogin({ notice, onLogin }: {
  /** Why the login screen appeared, when it was not the editor's own doing. */
  notice?: string;
  onLogin: (token: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      // A reply that is not JSON means the request never reached the function —
      // in local development, `/.netlify/functions/*` only exists once the dev
      // server mounts it — so say that rather than blaming the network.
      const body = await response.json().catch(() => null);

      if (!body) {
        setError(`Serverul a răspuns ${response.status}, fără un mesaj pe care să îl pot citi.`);
        return;
      }

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

        {notice ? <p className="editor-notice">{notice}</p> : null}

        <label htmlFor="editor-password">Parolă</label>
        <input
          autoFocus
          id="editor-password"
          onChange={(event) => setPassword(event.target.value)}
          type={showPassword ? 'text' : 'password'}
          value={password}
        />

        <label className="editor-password-toggle" htmlFor="editor-show-password">
          <input
            checked={showPassword}
            id="editor-show-password"
            onChange={(event) => setShowPassword(event.target.checked)}
            type="checkbox"
          />
          Arată parola
        </label>

        {error ? <p className="editor-error">{error}</p> : null}

        <button disabled={busy || !password} type="submit">
          {busy ? 'Se verifică...' : 'Intră'}
        </button>
      </form>
    </main>
  );
}

/** What a click on the page does: open the text dialog, or pick a thing up. */
export type EditorMode = 'text' | 'layout';

export function EditorBar({
  changeCount,
  mode,
  onMode,
  onPublish,
  onLogout,
  onShowChanges,
  status,
  busy,
}: {
  changeCount: number;
  mode: EditorMode;
  onMode: (mode: EditorMode) => void;
  onPublish: () => void;
  onLogout: () => void;
  onShowChanges: () => void;
  status: { kind: 'idle' | 'ok' | 'error'; message: string; problems?: string[] };
  busy: boolean;
}) {
  return (
    <div className="editor-bar">
      <span className="editor-mode">
        {([['text', 'Editez textul'], ['layout', 'Așez în pagină']] as const).map(([value, label]) => (
          <button
            aria-pressed={mode === value}
            className={mode === value ? 'is-active' : undefined}
            key={value}
            onClick={() => onMode(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </span>

      <span className="editor-bar-hint">
        {mode === 'layout'
          ? 'Trage cu mouse-ul orice vrei să muți. Le pui la loc din Modificări.'
          : changeCount > 0
            ? `${changeCount} ${changeCount === 1 ? 'modificare nepublicată' : 'modificări nepublicate'}`
            : 'Apasă pe un text ca să îl modifici'}
      </span>

      {status.message ? (
        <span className={status.kind === 'error' ? 'editor-bar-error' : 'editor-bar-ok'}>
          {status.message}
        </span>
      ) : null}

      <button className="editor-bar-changes" onClick={onShowChanges} type="button">
        Modificări{changeCount > 0 ? ` (${changeCount})` : ''}
      </button>

      <button className="editor-bar-publish" disabled={busy || changeCount === 0} onClick={onPublish} type="button">
        {busy ? 'Se publică...' : `Publică${changeCount > 0 ? ` (${changeCount})` : ''}`}
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
  onDelete,
}: {
  draft: BlockDraft;
  onCancel: () => void;
  onConfirm: (edit: BlockEdit) => void;
  onNavigate: (direction: -1 | 1, edit: BlockEdit) => void;
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

  // The position belongs to the layout mode; carry it through so saving a text
  // edit does not put a moved element back where it started.
  const edit = (): BlockEdit => ({
    text,
    size,
    align,
    spaceBefore,
    spaceAfter,
    offsetX: draft.offsetX,
    offsetY: draft.offsetY,
  });

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

  /**
   * Applies or removes markup around the selection, so pressing the button a
   * second time undoes it instead of nesting another pair. Handles both the
   * case where the markers are inside the selection and where they sit just
   * outside it. Italic uses `_` so it can never be read as a footnote marker.
   */
  function toggle(open: string, close = open) {
    const area = areaRef.current;

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;
    const selected = text.slice(start, end);

    if (!selected) {
      return;
    }

    // Markers included in the selection: **word** with all of it highlighted.
    if (
      selected.length >= open.length + close.length
      && selected.startsWith(open)
      && selected.endsWith(close)
    ) {
      const inner = selected.slice(open.length, selected.length - close.length);
      setText(`${text.slice(0, start)}${inner}${text.slice(end)}`);
      restoreSelection(area, start, start + inner.length);
      return;
    }

    // Markers just outside the selection: **word** with only `word` highlighted.
    if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
      setText(`${text.slice(0, start - open.length)}${selected}${text.slice(end + close.length)}`);
      restoreSelection(area, start - open.length, start - open.length + selected.length);
      return;
    }

    setText(`${text.slice(0, start)}${open}${selected}${close}${text.slice(end)}`);
    restoreSelection(area, start, start + open.length + selected.length + close.length);
  }

  function restoreSelection(area: HTMLTextAreaElement, start: number, end: number) {
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start, end);
    });
  }

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
      toggle('**');
      return;
    }

    if (modifier && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      toggle('_');
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
          <button onClick={() => toggle('**')} title="Îngroșat (Ctrl+B)" type="button"><strong>B</strong></button>
          <button onClick={() => toggle('_')} title="Înclinat (Ctrl+I)" type="button"><em>I</em></button>
          <button onClick={() => toggle('„', '”')} title="Ghilimele românești" type="button">„ ”</button>
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
          <button className="block-editor-cancel" onClick={onCancel} type="button">Anulează</button>
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


function shorten(text: string, limit = 90) {
  const clean = text.replace(/\s+/gu, ' ').trim();

  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean || '(gol)';
}

function formatWhen(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ro-RO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Everything the editor has changed: what is still waiting to be published,
 * with a way to put any of it back, and what has already gone live.
 */
export function ChangesPanel({
  pending,
  published,
  loadingPublished,
  onUndo,
  onClose,
  onOpen,
}: {
  pending: PendingChange[];
  published: PublishedChange[] | null;
  loadingPublished: boolean;
  onUndo: (address: string) => void;
  onClose: () => void;
  onOpen: (address: string) => void;
}) {
  return (
    <div aria-modal="true" className="block-editor-backdrop" role="dialog" onClick={onClose}>
      <div className="changes-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Modificările tale</h2>
          <button onClick={onClose} title="Închide" type="button">✕</button>
        </header>

        <section>
          <h3>
            Nepublicate
            <span className="changes-count">{pending.length}</span>
          </h3>

          {pending.length === 0 ? (
            <p className="changes-empty">Nu ai modificări nepublicate.</p>
          ) : (
            <ul className="changes-list">
              {pending.map((change) => (
                <li key={change.address}>
                  <div className="changes-item-head">
                    <span className="changes-item-label">{change.label}</span>
                    <span className="changes-item-where">{change.where}</span>

                    <button className="changes-open" onClick={() => onOpen(change.address)} type="button">
                      Vezi
                    </button>
                    <button className="changes-undo" onClick={() => onUndo(change.address)} type="button">
                      Anulează
                    </button>
                  </div>

                  {change.original === change.current ? (
                    <p className="changes-look">Aspectul a fost schimbat, textul a rămas la fel.</p>
                  ) : (
                    <>
                      <p className="changes-before">{shorten(change.original)}</p>
                      <p className="changes-after">{shorten(change.current)}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Publicate</h3>

          {loadingPublished ? <p className="changes-empty">Se încarcă...</p> : null}

          {!loadingPublished && published && published.length === 0 ? (
            <p className="changes-empty">Nicio modificare publicată încă.</p>
          ) : null}

          {!loadingPublished && published === null ? (
            <p className="changes-empty">Nu am putut încărca istoricul.</p>
          ) : null}

          {published && published.length > 0 ? (
            <ul className="changes-published">
              {published.map((entry) => (
                <li className={entry.byEditor ? 'is-editor' : undefined} key={entry.sha}>
                  <span className="changes-when">{formatWhen(entry.date)}</span>
                  <span>{entry.message}</span>
                  {entry.byEditor ? <span className="changes-tag">tu</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
