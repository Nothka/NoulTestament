import { useEffect, useRef, useState } from 'react';

import { renderTextWithNotes, trimVerseTextStart } from './markup';
import { PassageBlocks, type ContentBlock } from './passage-render';

const SESSION_KEY = 'nt-editor-session';
const WORK_KEY = 'nt-editor-work';

export type BlockDraft = {
  address: string;
  /** Content file this edit belongs to, e.g. public/content/books/matei.json */
  path: string;
  label: string;
  /**
   * The verse number this row is stored with. It names the row ("Versetul 5")
   * and anchors the flowing editor's split, but it is not held back from the
   * editor: the number is simply the first characters of `text`, and can be
   * retyped, corrected or added there like any other word.
   */
  verseNumber: string;
  text: string;
  size: number;
  /** Footnote numbers for this text, so the preview matches the page. */
  noteRefs: number[];
  hasPrevious: boolean;
  hasNext: boolean;
  align: Align;
  /** null means to use the normal spacing from the page stylesheet. */
  spaceBefore: number | null;
  spaceAfter: number | null;
  /** Soft-deleted rows stay addressable so Undo remains reliable. */
  hidden: boolean;
  /** Some fixed elements, such as footnotes, do not expose layout controls. */
  canLayout: boolean;
  /** Titles and footnotes have a fixed place; only blocks can be restructured. */
  canStructure: boolean;
  canDelete: boolean;
  /** Free position set by dragging, as a share of the element's own width. */
  offsetX: number;
  /** Free position set by dragging, in rem. */
  offsetY: number;
};

export type Align = 'left' | 'center' | 'right' | 'justify' | '';

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
  spaceBefore: number | null;
  spaceAfter: number | null;
  hidden: boolean;
  offsetX: number;
  offsetY: number;
};

export function sameLook(a: Look, b: Look) {
  return a.size === b.size
    && a.align === b.align
    && a.spaceBefore === b.spaceBefore
    && a.spaceAfter === b.spaceAfter
    && a.hidden === b.hidden
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
  spaceBefore: number | null;
  spaceAfter: number | null;
  hidden: boolean;
  offsetX: number;
  offsetY: number;
};

const SIZES = [70, 80, 90, 100, 110, 125, 140, 160];
const SPACES = [
  { value: 'auto', amount: null, label: 'Normal' },
  { value: '0', amount: 0, label: 'Fără' },
  { value: '0.75', amount: 0.75, label: '½ rând' },
  { value: '1.5', amount: 1.5, label: '1 rând' },
  { value: '3', amount: 3, label: '2 rânduri' },
] as const;

/**
 * The gap between a verse number and its first word, in em so it scales with
 * the text. One choice covers the whole site: a Bible reads as one document,
 * and a verse spaced differently from the one beside it looks like a mistake
 * rather than a decision. `null` keeps the stylesheet's own hairline gap,
 * which is how every verse has always been set.
 */
export const VERSE_NUMBER_SPACES = [
  { value: 'auto', amount: null, label: 'Lipit (ca acum)' },
  { value: '0.25', amount: 0.25, label: 'Mic' },
  { value: '0.45', amount: 0.45, label: 'Normal' },
  { value: '0.7', amount: 0.7, label: 'Mare' },
] as const;

const ALIGNMENTS: Array<{ value: Align; label: string; title: string }> = [
  { value: '', label: 'Normal', title: 'Alinierea normală a paginii' },
  { value: 'left', label: 'Stânga', title: 'Aliniere la stânga' },
  { value: 'center', label: 'Centru', title: 'Aliniere la mijloc' },
  { value: 'right', label: 'Dreapta', title: 'Aliniere la dreapta' },
  { value: 'justify', label: 'Margini egale', title: 'Aliniere la ambele margini (text justificat) — toate rândurile ajung la aceeași lungime' },
];

/**
 * The classic word-processor alignment glyph (four bars), so the button reads
 * at a glance to anyone who has used Word or Google Docs. "Normal" has no
 * bars of its own — it means no override, not literally left-aligned.
 */
function AlignIcon({ value }: { value: Align }) {
  if (!value) {
    return null;
  }

  const widths = { left: [16, 10, 16, 7], center: [16, 10, 16, 7], right: [16, 10, 16, 7], justify: [16, 16, 16, 16] }[value];
  const x = (width: number) => (
    value === 'center' ? (16 - width) / 2 : value === 'right' ? 16 - width : 0
  );

  return (
    <svg aria-hidden="true" className="align-icon" height="14" viewBox="0 0 16 14" width="16">
      {widths.map((width, row) => (
        <rect height="1.8" key={row} rx="0.6" width={width} x={x(width)} y={row * 3.6} />
      ))}
    </svg>
  );
}

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
  version?: number;
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

    const stored = work as StoredWork;

    if (stored.version !== 2) {
      // In the old editor zero meant "use the normal stylesheet spacing"; it
      // could not represent an explicit zero. Migrate that unambiguously to the
      // new null sentinel before Undo or another save can reinterpret it.
      stored.changes = stored.changes.map((change) => ({
        ...change,
        originalLook: migrateLegacyLook(change.originalLook),
        currentLook: migrateLegacyLook(change.currentLook),
      }));
      stored.version = 2;
    }

    return stored;
  } catch {
    return null;
  }
}

function migrateLegacyLook(look: Look): Look {
  return {
    ...look,
    spaceBefore: look.spaceBefore === 0 ? null : look.spaceBefore,
    spaceAfter: look.spaceAfter === 0 ? null : look.spaceAfter,
    hidden: look.hidden ?? false,
  };
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
  verseNumberSpacing,
  onVerseNumberSpacing,
}: {
  changeCount: number;
  mode: EditorMode;
  onMode: (mode: EditorMode) => void;
  onPublish: () => void;
  onLogout: () => void;
  onShowChanges: () => void;
  status: { kind: 'idle' | 'ok' | 'error'; message: string; problems?: string[] };
  busy: boolean;
  verseNumberSpacing: number | null;
  onVerseNumberSpacing: (amount: number | null) => void;
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

      {/* Site-wide, so it lives on the bar rather than inside a passage
          dialog, where it would look like it only affected that passage. */}
      <label className="editor-bar-setting">
        Spațiu după număr
        <select
          onChange={(event) => onVerseNumberSpacing(
            VERSE_NUMBER_SPACES.find((option) => option.value === event.target.value)?.amount ?? null,
          )}
          title="Spațiul dintre numărul versetului și primul cuvânt, în toate cărțile"
          value={verseNumberSpacing === null ? 'auto' : String(verseNumberSpacing)}
        >
          {VERSE_NUMBER_SPACES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

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
  onDelete: (edit: BlockEdit) => void;
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
    hidden: draft.hidden,
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

  /** Inserts text at the caret and leaves the caret immediately after it. */
  function insertAtCaret(inserted: string) {
    const area = areaRef.current;

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;
    const nextText = `${text.slice(0, start)}${inserted}${text.slice(end)}`;
    const nextCaret = start + inserted.length;

    setText(nextText);

    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(nextCaret, nextCaret);
    });
  }

  /**
   * At an edge, spacing moves the whole element (including a protected verse
   * number). Inside the text, two newlines create one visibly blank row.
   */
  function addBlankRow() {
    const area = areaRef.current;

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;

    if (draft.canLayout && start === end && start === 0) {
      setSpaceBefore(1.5);
      area.focus();
      return;
    }

    if (draft.canLayout && start === end && end === text.length) {
      setSpaceAfter(1.5);
      area.focus();
      return;
    }

    insertAtCaret('\n\n');
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

    // Enter is an ordinary row break, the way it is in a word processor. The
    // one place it cannot be one is the very start of a verse: the break
    // would land in front of the verse number, which is where a verse has to
    // begin, so there it becomes the gap above the row instead — the same
    // thing the "+ Rând liber" button does at that spot.
    if (!modifier && !event.shiftKey && event.key === 'Enter') {
      const area = areaRef.current;

      if (draft.verseNumber !== '' && area && area.selectionStart === 0 && area.selectionEnd === 0) {
        event.preventDefault();
        addBlankRow();
      }

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
  // The number is read off whatever is in the box right now, so retyping it
  // shows up in the preview immediately, exactly as it will on the page.
  const previewMatch = draft.verseNumber ? text.match(/^(\d{1,3})(.*)$/su) : null;
  // A verse is stored with its number at the front of its own text. Losing it
  // is refused when publishing, so it is said here instead — while the number
  // can still be typed back — rather than several screens later.
  const numberMissing = draft.verseNumber !== '' && !/^\d/u.test(text);

  const previewStyle: React.CSSProperties = { fontSize: `calc(1.02rem * ${size / 100})` };

  if (draft.canLayout && align) {
    previewStyle.textAlign = align;
  }

  if (draft.canLayout && spaceBefore !== null) {
    previewStyle.marginTop = `${spaceBefore}rem`;
  }

  if (draft.canLayout && spaceAfter !== null) {
    previewStyle.marginBottom = `${spaceAfter}rem`;
  }

  return (
    <div
      aria-labelledby="block-editor-title"
      aria-modal="true"
      className="block-editor-backdrop"
      role="dialog"
      onClick={onCancel}
    >
      <div className="block-editor" onClick={(event) => event.stopPropagation()}>
        <header>
          <span className="block-editor-verse" id="block-editor-title">{draft.label}</span>

          <span className="block-editor-nav">
            <button disabled={!draft.hasPrevious} onClick={() => onNavigate(-1, edit())} title="Textul dinainte" type="button">←</button>
            <button disabled={!draft.hasNext} onClick={() => onNavigate(1, edit())} title="Textul următor" type="button">→</button>
          </span>
        </header>

        <div className="block-toolbar">
          <button onClick={() => toggle('**')} title="Îngroșat (Ctrl+B)" type="button"><strong>B</strong></button>
          <button onClick={() => toggle('_')} title="Înclinat (Ctrl+I)" type="button"><em>I</em></button>
          <button onClick={() => toggle('„', '”')} title="Ghilimele românești" type="button">„ ”</button>
          <button onClick={addBlankRow} title="Lasă un rând gol la poziția cursorului" type="button">
            + Rând liber
          </button>
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
            <span className="block-toolbar-caption">Aliniere</span>

            <span className="block-align-group">
              {ALIGNMENTS.map((option) => (
                <button
                  aria-pressed={align === option.value}
                  className={align === option.value ? 'is-active' : undefined}
                  key={option.value || 'normal'}
                  onClick={() => setAlign(option.value)}
                  title={option.title}
                  type="button"
                >
                  <AlignIcon value={option.value} />
                  {option.label}
                </button>
              ))}
            </span>

            <label className="block-toolbar-size">
              Spațiu înainte
              <select
                onChange={(event) => setSpaceBefore(
                  SPACES.find((option) => option.value === event.target.value)?.amount ?? null,
                )}
                value={spaceBefore === null ? 'auto' : String(spaceBefore)}
              >
                {SPACES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <label className="block-toolbar-size">
              Spațiu după
              <select
                onChange={(event) => setSpaceAfter(
                  SPACES.find((option) => option.value === event.target.value)?.amount ?? null,
                )}
                value={spaceAfter === null ? 'auto' : String(spaceAfter)}
              >
                {SPACES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <p className="block-layout-help">
              „1 rând” coboară textul. „Margini egale” aliniază întregul paragraf la ambele margini.
            </p>
          </div>
        ) : null}

        <textarea
          aria-label="Text de modificat"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          ref={areaRef}
          rows={5}
          value={text}
        />

        <div className="block-preview">
          <span className="block-preview-label">Cum va arăta</span>
          <p className="block-preview-body" style={previewStyle}>
            {previewMatch ? <sup>{previewMatch[1]}</sup> : null}
            {renderTextWithNotes(previewMatch ? trimVerseTextStart(previewMatch[2]) : text, draft.noteRefs)}
          </p>
        </div>

        {numberMissing ? (
          <p className="block-editor-warning">
            Rândul nu mai începe cu numărul versetului. Scrie-l la început (de exemplu „{draft.verseNumber}”),
            altfel textul nu poate fi publicat.
          </p>
        ) : null}

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
              onClick={() => (confirmingDelete ? onDelete(edit()) : setConfirmingDelete(true))}
              type="button"
            >
              {confirmingDelete
                ? 'Sigur? Apasă din nou'
                : text.trim()
                  ? 'Șterge textul'
                  : 'Șterge rândul gol'}
            </button>
          </div>
        ) : null}

        <footer>
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

/** One block's locally-edited fields, staged until Salvează pasajul commits them. */
type PassageField = {
  text: string;
  size: number;
  align: Align;
  spaceBefore: number | null;
  spaceAfter: number | null;
};

function fieldFromDraft(draft: BlockDraft): PassageField {
  return {
    text: draft.text,
    size: draft.size,
    align: draft.align,
    spaceBefore: draft.spaceBefore,
    spaceAfter: draft.spaceAfter,
  };
}

/**
 * Consecutive verses with no explicit spacing of their own share one flowing
 * textarea, so they can be typed and backspaced across like a real document
 * instead of one box per verse. Every run of verses — even a lone one boxed
 * in by spacing on both sides — gets the same flowing, number-editable
 * treatment, so editing never quietly behaves differently from one verse to
 * the next. Only a heading, a hidden block, or a run mixing in a non-verse
 * paragraph falls back to the older single-block field, because the
 * marker-recovery below only works when every block in a group carries a
 * findable number.
 */
type EditGroup = { kind: 'flow' | 'single'; indices: number[] };

function computeEditGroups(drafts: BlockDraft[], fields: PassageField[]): EditGroup[] {
  const groups: EditGroup[] = [];
  let current: number[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    if (current.every((index) => drafts[index].verseNumber !== '')) {
      groups.push({ kind: 'flow', indices: current });
    } else {
      current.forEach((index) => groups.push({ kind: 'single', indices: [index] }));
    }

    current = [];
  };

  drafts.forEach((draft, index) => {
    if (draft.label.startsWith('Subtitlu') || draft.hidden) {
      flush();
      groups.push({ kind: 'single', indices: [index] });
      return;
    }

    if (current.length > 0 && fields[index].spaceBefore !== null) {
      flush();
    }

    current.push(index);

    if (fields[index].spaceAfter !== null) {
      flush();
    }
  });

  flush();

  return groups;
}

/** The verse number a row's text currently begins with, if it still has one. */
function leadingVerseNumber(text: string) {
  return text.match(/^(\d{1,3})/u)?.[1] ?? '';
}

/**
 * What may follow a number glued to it for that number to be a verse's own.
 * Almost every verse in the text is written that way — "5Şi a zis",
 * "6„Iată" — and it is what tells a verse start apart from an ordinary
 * figure in the prose, which in Romanian is followed by a space ("2
 * Corinteni") or closes a sentence ("numărul lui este 666.").
 */
const GLUED_VERSE_NUMBER = '[^\\s\\d.,;:!?%)\\]”’]';

/**
 * The two ways a verse number is written, strictest first: glued to the first
 * word, or — as some dozens of older rows in this text are — loose, with a
 * space or a full stop after it ("10 De exemplu", "1. În acord"). Trying the
 * glued form everywhere first is what keeps a figure in the prose from
 * outranking the real verse start further along the line.
 */
function verseMarkerPatterns(number: string, flags: string) {
  return [
    new RegExp(`(?:^|\\s)${number}(?=${GLUED_VERSE_NUMBER})`, flags),
    new RegExp(`(?:^|\\s)${number}(?!\\d)`, flags),
  ];
}

/**
 * Finds where one specific verse number begins inside a flow of several
 * verses' text glued together, so free typing can be mapped back to the
 * verse it belongs to.
 */
function findVerseMarker(text: string, verseNumber: string, fromIndex: number): number {
  if (verseNumber === '') {
    return -1;
  }

  const haystack = text.slice(fromIndex);

  for (const pattern of verseMarkerPatterns(verseNumber, 'u')) {
    const match = haystack.match(pattern);

    if (match && match.index !== undefined) {
      return fromIndex + match.index + (match[0].length - verseNumber.length);
    }
  }

  return -1;
}

/** Every number in a stretch of text written the way a verse number is. */
function findVerseMarkers(text: string, loose = false): Array<{ position: number; number: string }> {
  const markers: Array<{ position: number; number: string }> = [];
  const pattern = verseMarkerPatterns('(\\d{1,3})', 'gu')[loose ? 1 : 0];
  let match = pattern.exec(text);

  while (match !== null) {
    markers.push({ position: match.index + (match[0].length - match[1].length), number: match[1] });
    match = pattern.exec(text);
  }

  return markers;
}

/** Where each verse's own marker was found in a flow's text, in verse order — or -1 for one that could not be located. */
function locateFlowMarkers(text: string, verseNumbers: string[]): number[] {
  const positions: number[] = [];
  let searchFrom = 0;

  verseNumbers.forEach((number) => {
    const at = findVerseMarker(text, number, searchFrom);

    positions.push(at);

    if (at !== -1) {
      searchFrom = at + number.length;
    }
  });

  return positions;
}

/**
 * The numbers written in the stretch of text that belongs to `count` verses
 * whose own numbers could not be found — one apiece, or nothing at all, since
 * anything else would be a guess about the editor's words.
 */
function retypedVerseNumbers(text: string, count: number) {
  const glued = findVerseMarkers(text);

  if (glued.length === count) {
    return glued;
  }

  const loose = findVerseMarkers(text, true);

  return loose.length === count ? loose : null;
}

/**
 * Where each verse of a flowing group begins inside the combined text.
 *
 * Anchored on the numbers the verses already carry, so ordinary typing never
 * moves a boundary. A number that has just been retyped is by definition not
 * one of those — and retyping it is now allowed — so any verse left
 * unlocated is looked for again in the stretch of text between the located
 * verses on either side of it: if exactly one number is written there per
 * missing verse, those are their new numbers. Anything less certain is left
 * alone, and the verse folds into the one before it exactly as it did
 * before — plainly visible, and undone by typing a number back.
 */
function flowVerseStarts(text: string, verseNumbers: string[]): number[] {
  const positions = locateFlowMarkers(text, verseNumbers);
  const numbers = [...verseNumbers];
  let slot = 0;

  while (slot < positions.length) {
    if (positions[slot] !== -1) {
      slot += 1;
      continue;
    }

    let last = slot;

    while (last + 1 < positions.length && positions[last + 1] === -1) {
      last += 1;
    }

    const from = slot > 0 ? positions[slot - 1] + numbers[slot - 1].length : 0;
    const to = last + 1 < positions.length ? positions[last + 1] : text.length;

    retypedVerseNumbers(text.slice(from, to), last - slot + 1)?.forEach((marker, offset) => {
      positions[slot + offset] = from + marker.position;
      numbers[slot + offset] = marker.number;
    });

    slot = last + 1;
  }

  return positions;
}

/**
 * Tidies one verse recovered from a flowing box without eating the row break
 * the editor typed at the end of it. Leading whitespace goes entirely — a
 * verse is stored starting at its own number, and a break in front of that
 * number could not be saved — and so do trailing spaces, but a trailing
 * newline is exactly what puts the next verse on a new row and has to
 * survive the trip out of the box and back into it.
 */
function tidyVerseText(value: string) {
  return value.replace(/^\s+/u, '').replace(/[^\S\r\n]+$/u, '');
}

/**
 * Glues a group's verses back into the single stretch of text its box shows.
 * Verses are separated by one space, which is how they read on the page —
 * except after one that already ends in a row break, where the break is
 * meant to be the last thing on its row rather than a break followed by a
 * stray space at the start of the next one.
 */
function joinVerseTexts(pieces: string[]) {
  return pieces.reduce((combined, piece, order) => {
    if (order === 0) {
      return piece;
    }

    return /\n[^\S\r\n]*$/u.test(combined) ? `${combined}${piece}` : `${combined} ${piece}`;
  }, '');
}

/**
 * Recovers each verse's own text — its number included, since that is how a
 * verse is stored — from a flowing textarea's combined value. A verse whose
 * number was deleted outright simply cannot be found: its words fold into the
 * previous verse (or, if it was the very first verse, into whichever verse's
 * number survived first) rather than the split silently losing or
 * misattributing any of them. The verse re-splits correctly again the moment
 * a number is typed back.
 */
function splitFlowText(text: string, verseNumbers: string[]): string[] {
  const positions = flowVerseStarts(text, verseNumbers);
  const texts = verseNumbers.map(() => '');
  const found = positions
    .map((position, slot) => ({ position, slot }))
    .filter((entry): entry is { position: number; slot: number } => entry.position !== -1);

  if (found.length === 0) {
    texts[0] = tidyVerseText(text);
    return texts;
  }

  found.forEach(({ position, slot }, order) => {
    const contentEnd = order + 1 < found.length ? found[order + 1].position : text.length;
    const leading = order === 0 ? text.slice(0, position) : '';

    texts[slot] = `${leading}${text.slice(position, contentEnd)}`;
  });

  return texts.map(tidyVerseText);
}

/**
 * Which verse in a flowing group a cursor position falls in, plus that
 * verse's own content boundaries within the combined text — the same
 * "nearest boundary" information the single-verse editor uses for Enter and
 * for tracking which row formatting applies to.
 */
function locateFlowCursor(
  text: string,
  verseNumbers: string[],
  cursorPos: number,
): { slot: number; start: number; end: number } {
  const positions = flowVerseStarts(text, verseNumbers);
  const found = positions
    .map((position, slot) => ({ position, slot }))
    .filter((entry): entry is { position: number; slot: number } => entry.position !== -1);

  if (found.length === 0) {
    return { slot: 0, start: 0, end: text.length };
  }

  let order = 0;

  found.forEach((entry, index) => {
    if (entry.position <= cursorPos) {
      order = index;
    }
  });

  const { position } = found[order];
  const end = order + 1 < found.length ? found[order + 1].position : text.length;

  return { slot: found[order].slot, start: position, end };
}

/**
 * Every block of one passage, editable on a single screen instead of one
 * verse-at-a-time dialog — a non-technical editor thinks of "the genealogy"
 * as one piece of text, not seventeen separate confirmations. Each block is
 * still its own field, saved through the exact same per-block path
 * (verse-number protection, footnote balance) as the single-block editor;
 * this is a different screen over the same safe data, not a new one.
 * Formatting (bold/italic/quotes/blank row, alignment, size, spacing) lives
 * in one toolbar at the top and acts on whichever field is currently
 * focused, rather than needing a menu per row.
 */
export function PassageEditor({
  passageId,
  passageLabel,
  drafts,
  hasPreviousPassage,
  hasNextPassage,
  onCancel,
  onSave,
  onNavigatePassage,
}: {
  passageId: string;
  passageLabel: string;
  drafts: BlockDraft[];
  hasPreviousPassage: boolean;
  hasNextPassage: boolean;
  onCancel: () => void;
  onSave: (edits: Array<{ draft: BlockDraft; edit: BlockEdit }>) => void;
  onNavigatePassage: (direction: -1 | 1, edits: Array<{ draft: BlockDraft; edit: BlockEdit }>) => void;
}) {
  const [fields, setFields] = useState<PassageField[]>(() => drafts.map(fieldFromDraft));
  const areaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  // One shared textarea per flowing group of verses, keyed by the group's
  // own indices (e.g. "0,1,2") — a plain ref map rather than an array
  // because groups can split or merge as spacing changes.
  const flowRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  // The group that just pushed a change up from its own onChange, so the
  // DOM-sync effect below skips writing back into the exact textarea the
  // customer is mid-keystroke in — see that effect for why.
  const lastFlowEditRef = useRef<string | null>(null);
  // The verse to put the caret in front of once two boxes have been joined
  // into one. Joining them replaces both textareas with a new one, so the
  // caret cannot simply stay where it was; it is placed by an effect below.
  const mergeCaretRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Whole-passage selection, for applying one formatting choice to every
  // verse at once (e.g. "Margini egale" for a whole genealogy). Individual
  // per-verse selection does not exist any more now that verses can share a
  // flowing textarea — highlighting text the normal way and using Bold/
  // Italic covers that case instead.
  const [selected, setSelected] = useState<boolean[]>(() => drafts.map(() => false));
  const [showPreview, setShowPreview] = useState(true);

  // No effect resets `fields`/`selected` when `drafts` changes — the caller
  // remounts this component with a fresh `key` whenever the passage or its
  // block count changes, so stale arrays (from before, possibly a
  // different length) can never be read against new `drafts` for even one
  // render.

  const editGroups = computeEditGroups(drafts, fields);

  function groupKey(group: EditGroup) {
    return group.indices.join(',');
  }

  /** A flowing group's current combined text — one verse, a space, the next,
   *  and so on — the value the shared textarea for that group is seeded with.
   *  Each verse's number is already the front of its own text, and a verse
   *  ending in a row break keeps that break as the end of its row. */
  function groupCombinedText(group: EditGroup) {
    return joinVerseTexts(group.indices.map((index) => fields[index].text));
  }

  /** Where one verse of a group starts inside that group's combined text —
   *  the spot to put the caret after two boxes have been joined into one. */
  function verseStartInGroup(group: EditGroup, index: number) {
    const upToIndex = group.indices.slice(0, group.indices.indexOf(index) + 1);
    const combined = joinVerseTexts(upToIndex.map((member) => fields[member].text));

    return Math.max(0, combined.length - fields[index].text.length);
  }

  /** The number each verse of a group currently starts with, which is what the
   *  split anchors on — read from the fields rather than from `drafts`, so a
   *  number the editor has retyped is the one looked for next. */
  function groupVerseNumbers(group: EditGroup) {
    return group.indices.map((index) => leadingVerseNumber(fields[index].text));
  }

  /** Recovers each verse's text from a flowing group's edited textarea and
   *  writes it back into `fields`, one per verse. */
  function applyFlowText(group: EditGroup, nextText: string) {
    const splitTexts = splitFlowText(nextText, groupVerseNumbers(group));

    setFields((current) => current.map((field, i) => {
      const slot = group.indices.indexOf(i);

      return slot === -1 ? field : { ...field, text: splitTexts[slot] };
    }));
  }

  /**
   * A flowing group's textarea is uncontrolled after its initial render —
   * React never re-renders its `value`, so the browser owns the cursor and
   * every keystroke feels native, with no risk of the cursor jumping
   * mid-word the way it would if `fields` (which normalizes whitespace on
   * every split) fed straight back into a controlled `value`. `fields` stays
   * the source of truth for saving/preview/formatting, so anything that
   * changes a flowing verse's text from *outside* its own textarea — the
   * "select all" checkbox plus Bold, for instance — needs to be pushed back
   * into that DOM node by hand. This runs after every render and does
   * exactly that, for every flowing group except the one that just caused
   * this render via its own onChange (already showing what was typed).
   */
  useEffect(() => {
    for (const group of editGroups) {
      if (group.kind !== 'flow') {
        continue;
      }

      const key = groupKey(group);

      if (lastFlowEditRef.current === key) {
        lastFlowEditRef.current = null;
        continue;
      }

      const textarea = flowRefs.current[key];

      if (!textarea) {
        continue;
      }

      const nextValue = groupCombinedText(group);

      if (textarea.value !== nextValue) {
        const position = Math.min(textarea.selectionStart, nextValue.length);

        textarea.value = nextValue;
        textarea.setSelectionRange(position, position);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  /**
   * Puts the caret back at the join after two boxes have become one. The
   * merged box is a brand-new textarea with its own combined text, so the
   * position has to be worked out from the verses rather than carried over
   * from the box the key was pressed in.
   */
  useEffect(() => {
    const index = mergeCaretRef.current;

    if (index === null) {
      return;
    }

    const group = editGroups.find((candidate) => candidate.indices.includes(index));

    // Anything but a flowing box means the join did not happen after all —
    // drop the request rather than waiting for a box that will never render.
    if (!group || group.kind !== 'flow') {
      mergeCaretRef.current = null;
      return;
    }

    const textarea = flowRefs.current[groupKey(group)];

    if (!textarea) {
      return;
    }

    mergeCaretRef.current = null;

    const caret = verseStartInGroup(group, index);

    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Textareas auto-grow to their content, like a document rather than a form
  // — kept imperative because it has to re-run after every kind of edit
  // (typing, the blank-row button, bold/italic), not just onChange.
  useEffect(() => {
    for (const area of [...areaRefs.current, ...Object.values(flowRefs.current)]) {
      if (area) {
        area.style.height = 'auto';
        area.style.height = `${area.scrollHeight}px`;
      }
    }
  }, [fields]);

  function setField(index: number, patch: Partial<PassageField>) {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  /**
   * Puts two neighbouring boxes back together, which is how two verses come
   * to share a row again after one of them was pushed onto its own. A box
   * ends where a verse asks for space above or below it, so joining them
   * means clearing exactly that space — the verses themselves are not
   * touched, and their numbers still say where each one begins. Returns
   * false when there is nothing to join, so the key that asked for it can
   * fall through to its ordinary meaning.
   */
  function mergeGroups(before: EditGroup, after: EditGroup) {
    const last = before.indices[before.indices.length - 1];
    const first = after.indices[0];

    // Only two runs of ordinary verses can flow into one box: a heading, a
    // deleted row, or a paragraph with no number of its own each has to stay
    // in a box of its own, because the split back into verses has nothing to
    // anchor on without a number.
    if (first !== last + 1) {
      return false;
    }

    for (const index of [last, first]) {
      if (drafts[index].verseNumber === '' || drafts[index].hidden || drafts[index].label.startsWith('Subtitlu')) {
        return false;
      }
    }

    if (fields[last].spaceAfter === null && fields[first].spaceBefore === null) {
      return false;
    }

    setFields((current) => current.map((field, i) => {
      if (i === last) {
        return { ...field, spaceAfter: null };
      }

      return i === first ? { ...field, spaceBefore: null } : field;
    }));

    mergeCaretRef.current = first;

    return true;
  }

  const selectedIndices = selected.flatMap((isSelected, index) => (isSelected ? [index] : []));
  // Formatting (alignment/size/spacing) targets whatever is checked; with
  // nothing checked, it falls back to the single field being typed in, so
  // the everyday one-verse workflow needs no checkbox at all.
  const formatTargets = selectedIndices.length > 0
    ? selectedIndices
    : activeIndex !== null ? [activeIndex] : [];
  const formatAnchor = formatTargets.length > 0 ? fields[formatTargets[0]] : null;
  // The flowing group `activeIndex` currently belongs to, if any — Bold,
  // Italic, quotes, Clear formatting and "+ Spațiu" all need to know whether
  // to act on that group's shared textarea or on a single-verse one.
  const activeGroup = activeIndex === null
    ? null
    : editGroups.find((group) => group.indices.includes(activeIndex)) ?? null;
  const activeIsFlow = activeGroup !== null && activeGroup.kind === 'flow';

  function setFormatFields(patch: Partial<PassageField>) {
    if (formatTargets.length === 0) {
      return;
    }

    setFields((current) => current.map((field, i) => (formatTargets.includes(i) ? { ...field, ...patch } : field)));
  }

  // A number is ordinary text now, so one can be deleted by accident. The
  // publish step refuses a verse that does not begin with its number; naming
  // them here keeps the fix next to the words rather than several screens on.
  const versesMissingNumbers = drafts.flatMap((draft, index) => (
    draft.verseNumber !== '' && !/^\d/u.test(fields[index].text) ? [draft.verseNumber] : []
  ));

  const allSelected = selected.length > 0 && selected.every(Boolean);

  function toggleSelectAll(checked: boolean) {
    setSelected(drafts.map(() => checked));
  }

  function changedEdits(): Array<{ draft: BlockDraft; edit: BlockEdit }> {
    const edits: Array<{ draft: BlockDraft; edit: BlockEdit }> = [];

    drafts.forEach((draft, index) => {
      const field = fields[index];
      const original = fieldFromDraft(draft);

      if (
        field.text === original.text
        && field.size === original.size
        && field.align === original.align
        && field.spaceBefore === original.spaceBefore
        && field.spaceAfter === original.spaceAfter
      ) {
        return;
      }

      edits.push({
        draft,
        edit: {
          text: field.text,
          size: field.size,
          align: field.align,
          spaceBefore: field.spaceBefore,
          spaceAfter: field.spaceAfter,
          hidden: draft.hidden,
          offsetX: draft.offsetX,
          offsetY: draft.offsetY,
        },
      });
    });

    return edits;
  }

  /**
   * The "+ Spațiu" button: adds space above or below the row the cursor is
   * in, whichever edge it sits nearer. This is the gap between rows, not a
   * row break — Enter types the break. On a verse long enough to wrap, the
   * browser's Home/End only reach the current visual line, not the true
   * start/end of the field, so the nearer boundary is used rather than a
   * strict start===0/end===length check. Blocks without layout controls
   * (footnotes) get two newlines at the cursor instead, mirroring
   * BlockEditor's addBlankRow.
   */
  function addBlankRow(index: number) {
    const area = areaRefs.current[index];
    const draft = drafts[index];
    const field = fields[index];

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;

    if (draft.canLayout && start === end) {
      const distanceToStart = start;
      const distanceToEnd = field.text.length - end;

      if (distanceToStart <= distanceToEnd) {
        setField(index, { spaceBefore: 1.5 });
      } else {
        setField(index, { spaceAfter: 1.5 });
      }

      area.focus();
      return;
    }

    const nextText = `${field.text.slice(0, start)}\n\n${field.text.slice(end)}`;
    setField(index, { text: nextText });

    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + 2, start + 2);
    });
  }

  /** Mirrors BlockEditor's toggle, scoped to one field of the list. */
  function toggle(index: number, open: string, close = open) {
    const area = areaRefs.current[index];
    const field = fields[index];

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;
    const selected = field.text.slice(start, end);

    if (!selected) {
      return;
    }

    let nextText: string;
    let nextStart: number;
    let nextEnd: number;

    if (
      selected.length >= open.length + close.length
      && selected.startsWith(open)
      && selected.endsWith(close)
    ) {
      const inner = selected.slice(open.length, selected.length - close.length);
      nextText = `${field.text.slice(0, start)}${inner}${field.text.slice(end)}`;
      nextStart = start;
      nextEnd = start + inner.length;
    } else if (
      field.text.slice(start - open.length, start) === open
      && field.text.slice(end, end + close.length) === close
    ) {
      nextText = `${field.text.slice(0, start - open.length)}${selected}${field.text.slice(end + close.length)}`;
      nextStart = start - open.length;
      nextEnd = nextStart + selected.length;
    } else {
      nextText = `${field.text.slice(0, start)}${open}${selected}${close}${field.text.slice(end)}`;
      nextStart = start;
      nextEnd = start + open.length + selected.length + close.length;
    }

    setField(index, { text: nextText });

    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(nextStart, nextEnd);
    });
  }

  /** Only paired markup is removed; a lone `*` is a footnote marker. */
  function clearFormatting(index: number) {
    const area = areaRefs.current[index];
    const field = fields[index];

    if (!area) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = area;
    const selected = field.text.slice(start, end);

    if (!selected) {
      return;
    }

    const cleaned = selected
      .replace(/\*\*([^*]+)\*\*/gu, '$1')
      .replace(/__([^_]+)__/gu, '$1')
      .replace(/_([^_\n]+)_/gu, '$1');

    setField(index, { text: `${field.text.slice(0, start)}${cleaned}${field.text.slice(end)}` });

    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start, start + cleaned.length);
    });
  }

  /** Wraps (or unwraps, on a second press) the whole field's text — the
   *  natural meaning of "bold" for a checked row, where there's no cursor
   *  selection to act on the way there is inside a single field. */
  function wholeFieldToggle(text: string, open: string, close: string) {
    return text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)
      ? text.slice(open.length, text.length - close.length)
      : `${open}${text}${close}`;
  }

  /**
   * Bold/italic/quotes act on checked rows first, applying to each row's
   * whole text — the same thing selecting several paragraphs and pressing
   * Bold does in a word processor. With nothing checked, this falls back to
   * the original single-field behaviour: whatever text is actually
   * highlighted inside the focused field.
   */
  function applyMarkup(open: string, close = open) {
    if (selectedIndices.length > 0) {
      setFields((current) => current.map((field, i) => (
        selectedIndices.includes(i) ? { ...field, text: wholeFieldToggle(field.text, open, close) } : field
      )));
      return;
    }

    if (activeIndex === null) {
      return;
    }

    if (activeGroup && activeIsFlow) {
      const textarea = flowRefs.current[groupKey(activeGroup)];

      if (textarea) {
        flowToggle(activeGroup, textarea, open, close);
      }

      return;
    }

    toggle(activeIndex, open, close);
  }

  function applyClearFormatting() {
    const strip = (text: string) => text
      .replace(/\*\*([^*]+)\*\*/gu, '$1')
      .replace(/__([^_]+)__/gu, '$1')
      .replace(/_([^_\n]+)_/gu, '$1');

    if (selectedIndices.length > 0) {
      setFields((current) => current.map((field, i) => (
        selectedIndices.includes(i) ? { ...field, text: strip(field.text) } : field
      )));
      return;
    }

    if (activeIndex === null) {
      return;
    }

    if (activeGroup && activeIsFlow) {
      const textarea = flowRefs.current[groupKey(activeGroup)];

      if (textarea) {
        flowClearFormatting(activeGroup, textarea);
      }

      return;
    }

    clearFormatting(activeIndex);
  }

  function triggerAddSpacing() {
    if (activeIndex === null) {
      return;
    }

    if (activeGroup && activeIsFlow) {
      const textarea = flowRefs.current[groupKey(activeGroup)];

      if (textarea) {
        flowAddSpacing(activeGroup, textarea);
      }

      return;
    }

    addBlankRow(activeIndex);
  }

  function onFieldKeyDown(index: number, event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const modifier = event.metaKey || event.ctrlKey;

    if (event.key === 'Escape') {
      onCancel();
      return;
    }

    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      onSave(changedEdits());
      return;
    }

    // Same as the flowing box: Enter is an ordinary row break, except at the
    // very start of a verse, where the break has nowhere to go in front of
    // the number and becomes the gap above the row instead.
    if (!modifier && !event.shiftKey && event.key === 'Enter') {
      const area = areaRefs.current[index];

      if (drafts[index].verseNumber !== '' && area && area.selectionStart === 0 && area.selectionEnd === 0) {
        event.preventDefault();
        addBlankRow(index);
      }

      return;
    }

    if (modifier && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      toggle(index, '**');
      return;
    }

    if (modifier && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      toggle(index, '_');
    }
  }

  /** Which verse a flowing group's textarea currently has its cursor in — drives the active-row indicator and Enter's spacing target. */
  function updateActiveFromFlow(group: EditGroup, textarea: HTMLTextAreaElement) {
    const { slot } = locateFlowCursor(textarea.value, groupVerseNumbers(group), textarea.selectionStart);

    setActiveIndex(group.indices[slot]);
  }

  function onFlowChange(group: EditGroup, textarea: HTMLTextAreaElement) {
    lastFlowEditRef.current = groupKey(group);
    applyFlowText(group, textarea.value);
    updateActiveFromFlow(group, textarea);
  }

  /**
   * "+ Spațiu" inside a flowing group: adds space above or below whichever
   * verse the cursor is nearest the edge of. Enter is a plain row break and
   * goes through the textarea itself; this is the wider gap that also splits
   * the run into two boxes, which Backspace at the start of one joins back.
   */
  function flowAddSpacing(group: EditGroup, textarea: HTMLTextAreaElement) {
    const cursorPos = textarea.selectionStart;
    const { slot, start, end } = locateFlowCursor(textarea.value, groupVerseNumbers(group), cursorPos);
    const index = group.indices[slot];
    const distanceToStart = Math.max(0, cursorPos - start);
    const distanceToEnd = Math.max(0, end - cursorPos);

    if (distanceToStart <= distanceToEnd) {
      setField(index, { spaceBefore: 1.5 });
    } else {
      setField(index, { spaceAfter: 1.5 });
    }

    textarea.focus();
  }

  /** Mirrors `toggle`, but wraps a selection inside a flowing group's shared textarea — which may span more than one verse. */
  function flowToggle(group: EditGroup, textarea: HTMLTextAreaElement, open: string, close = open) {
    const combined = textarea.value;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const selectedText = combined.slice(start, end);

    if (!selectedText) {
      return;
    }

    let nextText: string;
    let nextStart: number;
    let nextEnd: number;

    if (
      selectedText.length >= open.length + close.length
      && selectedText.startsWith(open)
      && selectedText.endsWith(close)
    ) {
      const inner = selectedText.slice(open.length, selectedText.length - close.length);

      nextText = `${combined.slice(0, start)}${inner}${combined.slice(end)}`;
      nextStart = start;
      nextEnd = start + inner.length;
    } else if (
      combined.slice(start - open.length, start) === open
      && combined.slice(end, end + close.length) === close
    ) {
      nextText = `${combined.slice(0, start - open.length)}${selectedText}${combined.slice(end + close.length)}`;
      nextStart = start - open.length;
      nextEnd = nextStart + selectedText.length;
    } else {
      nextText = `${combined.slice(0, start)}${open}${selectedText}${close}${combined.slice(end)}`;
      nextStart = start;
      nextEnd = start + open.length + selectedText.length + close.length;
    }

    // Written to the DOM directly and synchronously — this textarea is
    // uncontrolled (see the sync effect above), so nothing else will put
    // the new text on screen. `applyFlowText` only updates `fields`, the
    // copy used for saving/preview/formatting.
    textarea.value = nextText;
    textarea.setSelectionRange(nextStart, nextEnd);
    textarea.focus();
    applyFlowText(group, nextText);
  }

  /** Mirrors `clearFormatting`, scoped to a flowing group's shared textarea. */
  function flowClearFormatting(group: EditGroup, textarea: HTMLTextAreaElement) {
    const combined = textarea.value;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const selectedText = combined.slice(start, end);

    if (!selectedText) {
      return;
    }

    const cleaned = selectedText
      .replace(/\*\*([^*]+)\*\*/gu, '$1')
      .replace(/__([^_]+)__/gu, '$1')
      .replace(/_([^_\n]+)_/gu, '$1');

    const nextText = `${combined.slice(0, start)}${cleaned}${combined.slice(end)}`;

    textarea.value = nextText;
    textarea.setSelectionRange(start, start + cleaned.length);
    textarea.focus();
    applyFlowText(group, nextText);
  }

  function onFlowKeyDown(group: EditGroup, event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const modifier = event.metaKey || event.ctrlKey;
    const textarea = event.currentTarget;

    if (event.key === 'Escape') {
      onCancel();
      return;
    }

    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      onSave(changedEdits());
      return;
    }

    // Enter starts a new row, exactly as it does in a word processor: a plain
    // break in the text, which the page renders as a break in the same place,
    // and two of them leave a blank row. Nothing about it moves a verse
    // boundary — the numbers alone say where each verse begins, so a row may
    // hold one verse, two, or half of one. The single spot a break cannot go
    // is the very top of a box, where it would land in front of the first
    // verse's number; there it adds the gap above that verse instead, which
    // pushes the text down the same way.
    if (!modifier && !event.shiftKey && event.key === 'Enter') {
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        event.preventDefault();
        setField(group.indices[0], { spaceBefore: 1.5 });
      }

      return;
    }

    // Backspace at the very start of a box, and Delete at its very end, join
    // it to the box next to it — the same "this belongs on the line above"
    // reflex a word processor answers, and the way two verses that were
    // pushed apart are brought back onto one row.
    if (!modifier && event.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      const order = editGroups.indexOf(group);
      const previous = order > 0 ? editGroups[order - 1] : null;

      if (previous && mergeGroups(previous, group)) {
        event.preventDefault();
      }

      return;
    }

    if (
      !modifier
      && event.key === 'Delete'
      && textarea.selectionStart === textarea.value.length
      && textarea.selectionEnd === textarea.value.length
    ) {
      const order = editGroups.indexOf(group);
      const next = order >= 0 && order + 1 < editGroups.length ? editGroups[order + 1] : null;

      if (next && mergeGroups(group, next)) {
        event.preventDefault();
      }

      return;
    }

    // Select All on a box that holds several verses would otherwise select
    // every verse in it at once — a completely ordinary "select what I'm
    // editing" reflex that would silently wipe out every neighbouring verse
    // the moment the next character is typed. Scoping it to the verse the
    // cursor is actually in matches what pressing it is meant to do; a
    // deliberate wider selection is still possible by dragging with the
    // mouse, which this does not touch.
    if (modifier && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      const { start, end } = locateFlowCursor(textarea.value, groupVerseNumbers(group), textarea.selectionStart);

      textarea.setSelectionRange(start, end);
      return;
    }

    if (modifier && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      flowToggle(group, textarea, '**');
      return;
    }

    if (modifier && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      flowToggle(group, textarea, '_');
    }
  }

  /**
   * Rendered through the exact same PassageBlocks/GenealogyBlocks used by the
   * live page, rather than one isolated <p> per verse — so "Margini egale"
   * and every other layout choice previews the way it will really look, with
   * verses flowing into the same shared paragraph they flow into on the page
   * instead of each being justified on its own.
   */
  const previewBlocks: ContentBlock[] = drafts.map((draft, index) => {
    const field = fields[index];
    const isHeading = draft.label.startsWith('Subtitlu');

    return {
      type: isHeading ? 'heading' : draft.verseNumber ? 'verse' : 'paragraph',
      text: field.text,
      noteRefs: draft.noteRefs,
      size: field.size,
      align: field.align || undefined,
      spaceBefore: field.spaceBefore ?? undefined,
      spaceAfter: field.spaceAfter ?? undefined,
      hidden: draft.hidden,
      offsetX: draft.offsetX,
      offsetY: draft.offsetY,
    };
  });

  return (
    <div
      aria-labelledby="passage-editor-title"
      aria-modal="true"
      className="block-editor-backdrop"
      role="dialog"
      onClick={onCancel}
    >
      <div className="passage-editor" onClick={(event) => event.stopPropagation()}>
        <header>
          <span className="block-editor-verse" id="passage-editor-title">{passageLabel}</span>

          <span className="block-editor-nav">
            <button
              disabled={!hasPreviousPassage}
              onClick={() => onNavigatePassage(-1, changedEdits())}
              title="Pasajul precedent"
              type="button"
            >
              ←
            </button>
            <button
              disabled={!hasNextPassage}
              onClick={() => onNavigatePassage(1, changedEdits())}
              title="Pasajul următor"
              type="button"
            >
              →
            </button>
          </span>
        </header>

        <p className="passage-editor-help">
          {selectedIndices.length > 0
            ? `Formatarea de mai jos se aplică la toate cele ${selectedIndices.length} versete ale pasajului.`
            : 'Scrii ca într-un document: Enter începe un rând nou, iar Backspace la începutul unui rând îl lipește de cel de deasupra. Numerele arată unde începe fiecare verset, așa că două sau mai multe versete pot sta pe același rând. Formatarea de mai jos se aplică textului selectat, sau rândului în care scrii acum dacă nu ai selectat nimic.'}
        </p>

        <div className="block-toolbar">
          <button
            disabled={formatTargets.length === 0}
            onClick={() => applyMarkup('**')}
            title={selectedIndices.length > 0 ? 'Îngroșat — tot textul rândurilor bifate' : 'Îngroșat (Ctrl+B)'}
            type="button"
          >
            <strong>B</strong>
          </button>
          <button
            disabled={formatTargets.length === 0}
            onClick={() => applyMarkup('_')}
            title={selectedIndices.length > 0 ? 'Înclinat — tot textul rândurilor bifate' : 'Înclinat (Ctrl+I)'}
            type="button"
          >
            <em>I</em>
          </button>
          <button
            disabled={formatTargets.length === 0}
            onClick={() => applyMarkup('„', '”')}
            title="Ghilimele românești"
            type="button"
          >
            „ ”
          </button>
          <button
            disabled={selectedIndices.length > 0 || activeIndex === null}
            onClick={triggerAddSpacing}
            title="Adaugă spațiu deasupra sau dedesubtul rândului, după poziția cursorului. Pentru un simplu rând nou, apasă Enter în text."
            type="button"
          >
            + Spațiu
          </button>
          <button
            className="block-toolbar-clear"
            disabled={formatTargets.length === 0}
            onClick={applyClearFormatting}
            type="button"
          >
            Șterge formatarea
          </button>

          <span className="block-toolbar-divider" />

          <label className="block-toolbar-size">
            Mărime
            <select
              disabled={formatTargets.length === 0}
              onChange={(event) => setFormatFields({ size: Number(event.target.value) })}
              value={formatAnchor ? formatAnchor.size : 100}
            >
              {SIZES.map((option) => <option key={option} value={option}>{option}%</option>)}
            </select>
          </label>
        </div>

        <div className="block-toolbar block-toolbar-layout">
          <span className="block-toolbar-caption">Aliniere</span>

          <span className="block-align-group">
            {ALIGNMENTS.map((option) => (
              <button
                aria-pressed={formatAnchor !== null && formatAnchor.align === option.value}
                className={formatAnchor !== null && formatAnchor.align === option.value ? 'is-active' : undefined}
                disabled={formatTargets.length === 0}
                key={option.value || 'normal'}
                onClick={() => setFormatFields({ align: option.value })}
                title={option.title}
                type="button"
              >
                <AlignIcon value={option.value} />
                {option.label}
              </button>
            ))}
          </span>

          <label className="block-toolbar-size">
            Spațiu înainte
            <select
              disabled={formatTargets.length === 0}
              onChange={(event) => setFormatFields({
                spaceBefore: SPACES.find((option) => option.value === event.target.value)?.amount ?? null,
              })}
              value={formatAnchor ? (formatAnchor.spaceBefore === null ? 'auto' : String(formatAnchor.spaceBefore)) : 'auto'}
            >
              {SPACES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="block-toolbar-size">
            Spațiu după
            <select
              disabled={formatTargets.length === 0}
              onChange={(event) => setFormatFields({
                spaceAfter: SPACES.find((option) => option.value === event.target.value)?.amount ?? null,
              })}
              value={formatAnchor ? (formatAnchor.spaceAfter === null ? 'auto' : String(formatAnchor.spaceAfter)) : 'auto'}
            >
              {SPACES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="passage-editor-body-controls">
          <label className="passage-editor-select-all">
            <input
              checked={allSelected}
              onChange={(event) => toggleSelectAll(event.target.checked)}
              type="checkbox"
            />
            Selectează toate versetele pasajului
          </label>

          <button
            className="passage-editor-preview-toggle"
            onClick={() => setShowPreview((current) => !current)}
            type="button"
          >
            {showPreview ? 'Ascunde previzualizarea' : 'Arată previzualizarea'}
          </button>
        </div>

        <div className="passage-editor-body">
          <div className="passage-editor-fields">
            {editGroups.map((group) => (
              group.kind === 'single' ? (
                <div className="passage-editor-field" key={drafts[group.indices[0]].address}>
                  <textarea
                    aria-label={drafts[group.indices[0]].label}
                    className={`passage-editor-input${drafts[group.indices[0]].label.startsWith('Subtitlu') ? ' is-heading' : ''}${activeIndex === group.indices[0] ? ' is-active' : ''}`}
                    onChange={(event) => setField(group.indices[0], { text: event.target.value })}
                    onFocus={() => setActiveIndex(group.indices[0])}
                    onKeyDown={(event) => onFieldKeyDown(group.indices[0], event)}
                    ref={(el) => { areaRefs.current[group.indices[0]] = el; }}
                    rows={1}
                    style={{
                      textAlign: fields[group.indices[0]].align || undefined,
                      fontSize: fields[group.indices[0]].size !== 100
                        ? `calc(1.05rem * ${fields[group.indices[0]].size / 100})` : undefined,
                      marginTop: fields[group.indices[0]].spaceBefore !== null
                        ? `${fields[group.indices[0]].spaceBefore}rem` : undefined,
                      marginBottom: fields[group.indices[0]].spaceAfter !== null
                        ? `${fields[group.indices[0]].spaceAfter}rem` : undefined,
                    }}
                    value={fields[group.indices[0]].text}
                  />
                </div>
              ) : (
                <div className="passage-editor-field passage-editor-flow-field" key={groupKey(group)}>
                  <textarea
                    aria-label={group.indices.length === 1
                      ? `Verset ${drafts[group.indices[0]].verseNumber}`
                      : `${passageLabel}, versetele ${drafts[group.indices[0]].verseNumber}–${drafts[group.indices[group.indices.length - 1]].verseNumber}`}
                    className={`passage-editor-input passage-editor-flow${group.indices.includes(activeIndex ?? -1) ? ' is-active' : ''}`}
                    defaultValue={groupCombinedText(group)}
                    onChange={(event) => onFlowChange(group, event.currentTarget)}
                    onClick={(event) => updateActiveFromFlow(group, event.currentTarget)}
                    onFocus={(event) => updateActiveFromFlow(group, event.currentTarget)}
                    onKeyDown={(event) => onFlowKeyDown(group, event)}
                    onKeyUp={(event) => updateActiveFromFlow(group, event.currentTarget)}
                    ref={(el) => { flowRefs.current[groupKey(group)] = el; }}
                    rows={1}
                  />
                </div>
              )
            ))}
          </div>

          {showPreview ? (
            <div className="block-preview passage-editor-preview-pane">
              <span className="block-preview-label">Cum va arăta</span>

              <article className="passage passage-editor-preview-article">
                <div className="passage-body">
                  <PassageBlocks
                    allBlocks={previewBlocks}
                    blocks={previewBlocks}
                    editable={false}
                    passageId={passageId}
                  />
                </div>
              </article>
            </div>
          ) : null}
        </div>

        {versesMissingNumbers.length > 0 ? (
          <p className="block-editor-warning">
            {versesMissingNumbers.length === 1
              ? `Versetul ${versesMissingNumbers[0]} nu mai începe cu numărul lui.`
              : `Aceste versete nu mai încep cu numărul lor: ${versesMissingNumbers.join(', ')}.`}
            {' '}Scrie numărul la începutul versetului, altfel textul nu poate fi publicat.
          </p>
        ) : null}

        <footer>
          <button className="block-editor-cancel" onClick={onCancel} type="button">Anulează</button>
          <button className="block-editor-confirm" onClick={() => onSave(changedEdits())} type="button">
            Salvează pasajul
          </button>
        </footer>
      </div>
    </div>
  );
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
  onUndoAll,
  onClose,
  onOpen,
}: {
  pending: PendingChange[];
  published: PublishedChange[] | null;
  loadingPublished: boolean;
  onUndo: (address: string) => void;
  onUndoAll: () => void;
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

            {pending.length > 1 ? (
              <button
                className="changes-undo-all"
                onClick={() => {
                  if (window.confirm(`Anulezi toate cele ${pending.length} modificări nepublicate? Textul publicat deja nu este afectat.`)) {
                    onUndoAll();
                  }
                }}
                type="button"
              >
                Anulează tot
              </button>
            ) : null}
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
