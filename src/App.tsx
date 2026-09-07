import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_READING_WIDTH, resolveReadingWidth } from './reading-layout.js';
import { renderInlineMarkup, renderTextWithNotes, trimVerseTextStart } from './markup';
import {
  BlockEditor,
  ChangesPanel,
  EditorBar,
  EditorLogin,
  PassageEditor,
  readStoredSession,
  readStoredWork,
  storeSession,
  storeWork,
  sameLook,
  VERSE_NUMBER_SPACES,
  type Align,
  type EditorMode,
  type BlockDraft,
  type BlockEdit,
  type Look,
  type PendingChange,
  type PublishedChange,
  type StoredWork,
} from './editing';
import { removeBlock } from './passage-edits.js';
import {
  blockStyle,
  effectiveParagraphAlign,
  fragmentStyle,
  getResolvedNoteRefsForBlock,
  PassageBlocks,
  textRunBounds,
  type ContentBlock,
  type Footnote,
} from './passage-render';
import './App.css';

const MOBILE_QUERY = '(max-width: 560px)';
const CONTENT_BOOKS_INDEX_URL = '/content/books-index.json';
const INTRODUCTION_PATH = 'public/content/introduction.json';
const CONTENT_INTRODUCTION_URL = '/content/introduction.json';
const defaultSectionId = 'introduction';
const fallbackBookId = 'matei';

/** A footnote plus where it lives, so edit mode can address it. */
type PageFootnote = Footnote & {
  passageId: string;
  noteIndex: number;
};

type Passage = {
  id: string;
  number: number;
  reference: string;
  title: string;
  titleSize?: number;
  titleAlign?: ContentBlock['align'];
  titleSpaceBefore?: number;
  titleSpaceAfter?: number;
  titleOffsetX?: number;
  titleOffsetY?: number;
  /** Layout of the "1 (Matei 1:1-17)" line above the title. */
  referenceSize?: number;
  referenceAlign?: ContentBlock['align'];
  referenceSpaceBefore?: number;
  referenceSpaceAfter?: number;
  referenceOffsetX?: number;
  referenceOffsetY?: number;
  pageNumber?: number;
  blocks: ContentBlock[];
  notes?: Footnote[];
};

type Book = {
  id: string;
  navTitle: string;
  title: string;
  titleSize?: number;
  titleAlign?: ContentBlock['align'];
  titleSpaceBefore?: number;
  titleSpaceAfter?: number;
  titleOffsetX?: number;
  titleOffsetY?: number;
  passages: Passage[];
};

type Introduction = {
  id: string;
  title: string;
  titleSize?: number;
  titleAlign?: ContentBlock['align'];
  titleSpaceBefore?: number;
  titleSpaceAfter?: number;
  titleOffsetX?: number;
  titleOffsetY?: number;
  subtitle: string;
  subtitleSize?: number;
  subtitleAlign?: ContentBlock['align'];
  subtitleSpaceBefore?: number;
  subtitleSpaceAfter?: number;
  subtitleOffsetX?: number;
  subtitleOffsetY?: number;
  /**
   * The gap between every verse number and its first word, in em. Site-wide
   * rather than per-verse, and kept here because introduction.json is the one
   * global file the editor can publish. Undefined keeps the stylesheet's own
   * hairline gap.
   */
  verseNumberSpacing?: number;
  /** Site-wide reading column width in rem. Omitted uses the standard width. */
  readingWidth?: number | null;
  blocks: ContentBlock[];
};

type TestamentData = {
  introduction?: Introduction | null;
  books: Book[];
};

type BookIndexEntry = {
  id: string;
  navTitle: string;
  title: string;
  file: string;
};

function App() {
  const [data, setData] = useState<TestamentData | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState(defaultSectionId);
  const [hasError, setHasError] = useState(false);
  const [isNoticeVisible, setIsNoticeVisible] = useState(true);

  const isMobile = useIsMobile();
  const isEditorRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/edit');
  const [session, setSession] = useState<string | null>(() => (isEditorRoute ? readStoredSession() : null));
  const [signedOutNotice, setSignedOutNotice] = useState('');
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [passageId, setPassageId] = useState<string | null>(null);
  // Read before the first render so the save effect below cannot clear the
  // store while the content is still being fetched.
  const [storedWork] = useState<StoredWork | null>(() => (isEditorRoute ? readStoredWork() : null));
  const [changes, setChanges] = useState<PendingChange[]>(() => storedWork?.changes ?? []);
  const [isWorkStored, setIsWorkStored] = useState(true);
  const [editorMode, setEditorMode] = useState<EditorMode>('text');
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [published, setPublished] = useState<PublishedChange[] | null>(null);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const dirtyPaths = [...new Set(changes.map((change) => change.path))];
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string;
    problems?: string[];
  }>({ kind: 'idle', message: '' });

  const isEditing = isEditorRoute && Boolean(session);

  useEffect(() => {
    let isMounted = true;

    loadTestamentData()
      .then((nextData) => {
        if (!isMounted) {
          return;
        }

        setData(storedWork ? withStoredFiles(nextData, storedWork.files) : nextData);

        if (storedWork) {
          const count = storedWork.changes.length;

          setPublishStatus({
            kind: 'ok',
            message: count === 1
              ? 'Am păstrat modificarea pe care nu ai publicat-o.'
              : `Am păstrat cele ${count} modificări pe care nu le-ai publicat.`,
          });
        }

        if (!nextData.introduction) {
          setSelectedSectionId(nextData.books[0]?.id ?? fallbackBookId);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasError(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Unpublished edits otherwise live only in React state, so a refresh, a closed
   * tab or a flat battery threw away the whole session's work without a word.
   */
  useEffect(() => {
    if (!isEditing || !data) {
      return;
    }

    setIsWorkStored(storeWork(
      changes.length === 0
        ? null
        : {
          version: 2,
          at: Date.now(),
          changes,
          files: Object.fromEntries(dirtyPaths.map((path) => [path, fileContent(data, path)])),
        },
    ));
  }, [isEditing, data, changes]);

  /**
   * Only warn on the way out when the work could not be stored, since that is
   * the one case where leaving really does lose it.
   */
  useEffect(() => {
    if (!isEditing || isWorkStored || changes.length === 0) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener('beforeunload', warn);

    return () => window.removeEventListener('beforeunload', warn);
  }, [isEditing, isWorkStored, changes.length]);

  useEffect(() => {
    if (!pendingAddress) {
      return;
    }

    openBlockEditor(pendingAddress);
    setPendingAddress(null);
  }, [pendingAddress, data]);

  const selectedBook = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.books.find((book) => book.id === selectedSectionId) ?? null;
  }, [data, selectedSectionId]);

  const isIntroductionSelected = selectedSectionId === defaultSectionId && Boolean(data?.introduction);
  const selectedTitle = isIntroductionSelected
    ? data?.introduction?.title
    : selectedBook?.title;

  function openBlockEditor(address: string) {
    setDraft(draftFor(address));
    setPassageId(null);
  }

  function openPassageEditor(id: string) {
    setPassageId(id);
    setDraft(null);
  }

  /**
   * Every block of the open passage, resolved fresh from `data` each render
   * so the "⋯" escape hatch and Prev/Next passage never hand PassageEditor a
   * stale draft. Built from the same draftFor used for a single block, just
   * once per block in the passage instead of once for the clicked address.
   */
  const passagePanel = useMemo(() => {
    if (!passageId || !data) {
      return null;
    }

    const book = data.books.find((candidate) => candidate.passages.some((p) => p.id === passageId));
    const passage = book?.passages.find((p) => p.id === passageId);

    if (!book || !passage) {
      return null;
    }

    const drafts = passage.blocks
      .map((_, index) => draftFor(`block:${passageId}:${index}`))
      .filter((entry): entry is BlockDraft => entry !== null);

    if (drafts.length === 0) {
      return null;
    }

    const passageIndex = book.passages.findIndex((p) => p.id === passageId);

    return {
      drafts,
      passageId,
      passageLabel: `Pasajul ${passage.number} (${passage.reference})`,
      previousPassageId: passageIndex > 0 ? book.passages[passageIndex - 1].id : null,
      nextPassageId: passageIndex >= 0 && passageIndex < book.passages.length - 1
        ? book.passages[passageIndex + 1].id
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passageId, data]);

  /**
   * Folds freshly-built change records into the pending list, exactly the
   * way applyChange already does for one block — shared so the batched
   * passage save and the passage delete path (which also has to record
   * whatever else was pending) don't each carry their own copy.
   */
  function mergeChangeRecords(
    current: PendingChange[],
    records: Array<{ target: BlockDraft; record: { label: string; where: string; current: string; currentLook: Look } }>,
  ) {
    let updated = current;

    for (const { target, record } of records) {
      const existing = updated.find((change) => change.address === target.address);
      const entry: PendingChange = {
        address: target.address,
        path: target.path,
        label: record.label,
        where: record.where,
        original: existing ? existing.original : target.text,
        originalLook: existing ? existing.originalLook : lookOf(target),
        current: record.current,
        currentLook: record.currentLook,
        at: Date.now(),
      };

      updated = entry.original === entry.current && sameLook(entry.originalLook, entry.currentLook)
        ? updated.filter((change) => change.address !== target.address)
        : [entry, ...updated.filter((change) => change.address !== target.address)];
    }

    return updated;
  }

  /**
   * Commits every changed field of a passage in one pass. Threads the
   * updated TestamentData through each block's applyTextEdit manually,
   * because chaining applyChange calls in a loop would build every edit
   * from the same stale `data` closure and silently drop all but the last.
   */
  function applyPassageChanges(edits: Array<{ draft: BlockDraft; edit: BlockEdit }>) {
    if (!data || edits.length === 0) {
      return;
    }

    let next = data;
    const records = edits.map(({ draft, edit }) => {
      next = applyTextEdit(next, draft, edit);
      return { target: draft, record: describeDraft(draft, edit) };
    });

    setData(next);
    setPublishStatus({ kind: 'idle', message: '' });
    setChanges((current) => mergeChangeRecords(current, records));
  }

  function savePassage(edits: Array<{ draft: BlockDraft; edit: BlockEdit }>) {
    applyPassageChanges(edits);
    setPassageId(null);
  }

  function navigatePassage(direction: -1 | 1, edits: Array<{ draft: BlockDraft; edit: BlockEdit }>) {
    applyPassageChanges(edits);

    const target = direction === -1 ? passagePanel?.previousPassageId : passagePanel?.nextPassageId;

    setPassageId(target ?? null);
  }

  /**
   * Removes one block from the passage screen, reusing the exact same
   * removeBlock/applyPassageChange path the single-block editor's delete
   * already uses (footnotes stay attached to the blocks they belong to).
   * Saves every other field's pending edit first, same as Prev/Next.
   */
  /**
   * Everything the editor needs about one element. Both the text dialog and a
   * drag in layout mode start here, so a drag records its change through the
   * same path as a typed edit.
   */
  function draftFor(address: string): BlockDraft | null {
    if (!data) {
      return null;
    }

    const [kind, first, second] = address.split(':');

    if (kind === 'introtitle' || kind === 'introsubtitle') {
      const introduction = data.introduction;

      if (!introduction) {
        return null;
      }

      const isTitle = kind === 'introtitle';

      return draftForText({
        address,
        path: INTRODUCTION_PATH,
        label: isTitle ? 'Titlul introducerii' : 'Subtitlul introducerii',
        rawText: isTitle ? introduction.title : introduction.subtitle,
        size: isTitle ? introduction.titleSize : introduction.subtitleSize,
        align: isTitle ? introduction.titleAlign : introduction.subtitleAlign,
        spaceBefore: isTitle ? introduction.titleSpaceBefore : introduction.subtitleSpaceBefore,
        spaceAfter: isTitle ? introduction.titleSpaceAfter : introduction.subtitleSpaceAfter,
        offsetX: isTitle ? introduction.titleOffsetX : introduction.subtitleOffsetX,
        offsetY: isTitle ? introduction.titleOffsetY : introduction.subtitleOffsetY,
        isVerse: false,
        canLayout: true,
      });
    }

    if (kind === 'booktitle') {
      const book = data.books.find((candidate) => candidate.id === first);

      if (!book) {
        return null;
      }

      return draftForText({
        address,
        path: `public/content/books/${book.id}.json`,
        label: 'Numele cărții',
        rawText: book.title,
        size: book.titleSize,
        align: book.titleAlign,
        spaceBefore: book.titleSpaceBefore,
        spaceAfter: book.titleSpaceAfter,
        offsetX: book.titleOffsetX,
        offsetY: book.titleOffsetY,
        isVerse: false,
        canLayout: true,
      });
    }

    if (kind === 'intro') {
      const block = data.introduction?.blocks[Number(first)];

      if (!block) {
        return null;
      }

      return draftForText({
        address,
        path: INTRODUCTION_PATH,
        label: 'Paragraf (introducere)',
        rawText: block.text,
        size: block.size,
        align: block.align,
        spaceBefore: block.spaceBefore,
        spaceAfter: block.spaceAfter,
        hidden: block.hidden,
        isVerse: block.type === 'verse',
        noteRefs: block.noteRefs,
        canLayout: true,
        offsetX: block.offsetX,
        offsetY: block.offsetY,
        blockIndex: Number(first),
        blockCount: data.introduction?.blocks.length ?? 0,
      });
    }

    const book = data.books.find((candidate) => candidate.passages.some((passage) => passage.id === first));
    const passage = book?.passages.find((candidate) => candidate.id === first);

    if (!book || !passage) {
      return null;
    }

    const path = `public/content/books/${book.id}.json`;

    if (kind === 'reference') {
      return draftForText({
        address,
        path,
        // The number beside it belongs to the structure of the book and is not
        // the editor's to retype; only the traditional reference is text.
        label: 'Referința capitolului',
        rawText: passage.reference,
        size: passage.referenceSize,
        align: passage.referenceAlign,
        spaceBefore: passage.referenceSpaceBefore,
        spaceAfter: passage.referenceSpaceAfter,
        offsetX: passage.referenceOffsetX,
        offsetY: passage.referenceOffsetY,
        isVerse: false,
        canLayout: true,
      });
    }

    if (kind === 'title') {
      return draftForText({
        address,
        path,
        label: 'Titlul pasajului',
        rawText: passage.title,
        size: passage.titleSize,
        align: passage.titleAlign,
        spaceBefore: passage.titleSpaceBefore,
        spaceAfter: passage.titleSpaceAfter,
        isVerse: false,
        canLayout: true,
        offsetX: passage.titleOffsetX,
        offsetY: passage.titleOffsetY,
      });
    }

    if (kind === 'note') {
      const note = passage.notes?.[Number(second)];

      if (!note) {
        return null;
      }

      return draftForText({
        address,
        path,
        label: `Nota ${note.number}`,
        rawText: note.text,
        size: note.size,
        isVerse: false,
        canLayout: false,
        offsetX: note.offsetX,
        offsetY: note.offsetY,
      });
    }

    const block = passage.blocks[Number(second)];

    if (!block) {
      return null;
    }

    const label = block.type === 'heading' ? 'Subtitlu' : block.type === 'verse' ? 'Verset' : 'Paragraf';

    return draftForText({
      address,
      path,
      label,
      rawText: block.text,
      size: block.size,
      align: block.type === 'heading'
        ? block.align
        : effectiveParagraphAlign(passage.blocks, Number(second)),
      spaceBefore: block.spaceBefore,
      spaceAfter: block.spaceAfter,
      hidden: block.hidden,
      isVerse: block.type === 'verse',
      noteRefs: getResolvedNoteRefsForBlock(block, passage.blocks, passage.notes ?? []),
      // Paragraph grouping below turns spacing/alignment on any selected block
      // into a real paragraph boundary, so these controls work for verses too.
      canLayout: true,
      offsetX: block.offsetX,
      offsetY: block.offsetY,
      blockIndex: Number(second),
      blockCount: passage.blocks.length,
    });
  }

  function confirmBlockEdit(edit: BlockEdit) {
    if (!draft || !data) {
      return;
    }

    applyChange(draft, applyTextEdit(data, draft, edit), describeDraft(draft, edit));
    setDraft(null);
  }

  /**
   * Dragging in layout mode. The element is offset relative to where the flow
   * put it, so it keeps its place and nothing around it shifts while it moves.
   * X is stored as a share of the column width and Y in rem, so a position
   * chosen on this screen still holds on a narrower one.
   */
  function startDrag(event: React.PointerEvent) {
    const element = (event.target as HTMLElement).closest('[data-edit]');

    if (!(element instanceof HTMLElement) || !element.dataset.edit || !data) {
      return;
    }

    const target = draftFor(element.dataset.edit);

    if (!target) {
      return;
    }

    event.preventDefault();

    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const fromX = event.clientX;
    const fromY = event.clientY;
    const guides = openGuides();
    let offsetX = target.offsetX;
    let offsetY = target.offsetY;
    let pointer = { x: fromX, y: fromY };
    let frame = 0;

    element.classList.add('is-dragging');

    /**
     * Styles are written and measured once per frame. Doing both on every
     * pointer event would force the browser to lay the page out again each
     * time, which on a page of this length is visibly jerky.
     */
    const draw = () => {
      frame = 0;

      // Percentages resolve against the containing block, so that is what the
      // pointer's travel has to be measured against.
      const column = element.parentElement?.getBoundingClientRect().width || element.offsetWidth || 1;

      offsetX = clamp(target.offsetX + ((pointer.x - fromX) / column) * 100, -40, 40);
      offsetY = clamp(target.offsetY + (pointer.y - fromY) / rem, -20, 20);

      element.style.position = 'relative';
      element.style.left = `${round(offsetX)}%`;
      element.style.top = `${round(offsetY)}rem`;

      guides.update(element);
    };

    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };

      if (!frame) {
        frame = requestAnimationFrame(draw);
      }
    };

    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      cancelAnimationFrame(frame);
      element.classList.remove('is-dragging');
      guides.close();

      const edit: BlockEdit = {
        text: target.text,
        size: target.size,
        align: target.align,
        spaceBefore: target.spaceBefore,
        spaceAfter: target.spaceAfter,
        hidden: target.hidden,
        offsetX: round(offsetX),
        offsetY: round(offsetY),
      };

      applyChange(target, applyTextEdit(data, target, edit), describeDraft(target, edit));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
  }

  /** Saves the open draft, then opens its neighbour in reading order. */
  function navigateDraft(direction: -1 | 1, edit: BlockEdit) {
    if (!draft || !data) {
      return;
    }

    applyChange(draft, applyTextEdit(data, draft, edit), describeDraft(draft, edit));

    const addresses = editableAddresses();
    const target = addresses[addresses.indexOf(draft.address) + direction];

    setPendingAddress(target ?? null);
    setDraft(null);
  }

  /**
   * Structural changes apply the pending text edit first, in one pass, so the
   * two cannot overwrite each other. passage-edits keeps footnotes attached to
   * the blocks they belong to.
   */
  function restructure(
    edit: BlockEdit | null,
    change: (passage: Passage) => Passage,
    nextIndex: number | null,
  ) {
    if (!draft || !data) {
      return;
    }

    const [, passageId] = draft.address.split(':');
    const base = edit ? applyTextEdit(data, draft, edit) : data;

    applyChange(
      draft,
      applyPassageChange(base, passageId, change),
      { label: draft.label, where: passageId, current: '(șters)', currentLook: lookOf(draft) },
    );
    setPendingAddress(nextIndex === null ? null : `block:${passageId}:${nextIndex}`);
    setDraft(null);
  }

  /**
   * Applies new data and records what changed, keeping the first value seen for
   * an element so "Anulează" always restores the original rather than an
   * intermediate edit.
   */
  function applyChange(
    target: BlockDraft,
    next: TestamentData,
    record?: { label: string; where: string; current: string; currentLook: Look },
  ) {
    setData(next);
    setPublishStatus({ kind: 'idle', message: '' });

    if (!record) {
      return;
    }

    setChanges((current) => {
      const existing = current.find((change) => change.address === target.address);
      const entry: PendingChange = {
        address: target.address,
        path: target.path,
        label: record.label,
        where: record.where,
        original: existing ? existing.original : target.text,
        originalLook: existing ? existing.originalLook : lookOf(target),
        current: record.current,
        currentLook: record.currentLook,
        at: Date.now(),
      };

      // An element is back to how it started only when both its words and its
      // look match; moving it and typing nothing is still a change to publish.
      if (entry.original === entry.current && sameLook(entry.originalLook, entry.currentLook)) {
        return current.filter((change) => change.address !== target.address);
      }

      return [entry, ...current.filter((change) => change.address !== target.address)];
    });
  }

  /**
   * Site-wide reading settings share the content editor's publish and undo
   * path, including local recovery of changes that have not been published.
   */
  function setReadingSetting(address: 'versespace' | 'readingwidth', amount: number | null) {
    if (!data?.introduction) {
      return;
    }

    const isWidth = address === 'readingwidth';
    const previous = isWidth ? data.introduction.readingWidth : data.introduction.verseNumberSpacing;
    const current = amount === null ? '' : String(amount);
    const neutralLook: Look = {
      size: 100, align: '', spaceBefore: null, spaceAfter: null, hidden: false, offsetX: 0, offsetY: 0,
    };

    setData(applyTextEdit(
      data,
      { ...(draft ?? ({} as BlockDraft)), address, text: '' },
      { text: current, ...neutralLook },
    ));
    setPublishStatus({ kind: 'idle', message: '' });

    setChanges((changesNow) => {
      const existing = changesNow.find((change) => change.address === address);
      const original = existing ? existing.original : (previous == null ? '' : String(previous));
      const label = isWidth
        ? `${Math.round(resolveReadingWidth(amount) / DEFAULT_READING_WIDTH * 100)}%`
        : VERSE_NUMBER_SPACES.find((option) => option.amount === amount)?.label ?? 'Normal';
      const entry: PendingChange = {
        address,
        path: INTRODUCTION_PATH,
        label: isWidth ? 'Lățime coloană' : 'Spațiu după numărul versetului',
        where: `${isWidth ? 'Întregul site' : 'Toate cărțile'} — ${label}`,
        original,
        originalLook: existing ? existing.originalLook : neutralLook,
        current,
        currentLook: neutralLook,
        at: Date.now(),
      };

      return entry.original === entry.current
        ? changesNow.filter((change) => change.address !== address)
        : [entry, ...changesNow.filter((change) => change.address !== address)];
    });
  }

  function undoChange(address: string) {
    const change = changes.find((entry) => entry.address === address);

    if (!change || !data) {
      return;
    }

    setData(applyTextEdit(
      data,
      { ...(draft ?? ({} as BlockDraft)), address, text: '' },
      { text: change.original, ...change.originalLook },
    ));

    setChanges((current) => current.filter((entry) => entry.address !== address));
  }

  /**
   * Puts every unpublished change back at once. Threads `data` through each
   * revert manually rather than calling undoChange in a loop, for the same
   * reason applyPassageChanges does: looped setData calls from the same
   * stale closure would silently drop all but the last one.
   */
  function undoAllChanges() {
    if (!data || changes.length === 0) {
      return;
    }

    let next = data;

    for (const change of changes) {
      next = applyTextEdit(
        next,
        { ...(draft ?? ({} as BlockDraft)), address: change.address, text: '' },
        { text: change.original, ...change.originalLook },
      );
    }

    setData(next);
    setChanges([]);
  }

  /** Ends the session, saying why so the login screen is not a dead end. */
  function signOut(notice: string) {
    storeSession(null);
    setSession(null);
    setSignedOutNotice(notice);
  }

  async function loadPublished() {
    setLoadingPublished(true);

    try {
      const response = await fetch('/.netlify/functions/history', {
        headers: { authorization: `Bearer ${session}` },
      });

      if (response.status === 401) {
        signOut('Sesiunea a expirat, dar modificările tale sunt păstrate. Intră din nou.');
        return;
      }

      const body = await response.json();
      setPublished(response.ok ? body.commits ?? [] : null);
    } catch {
      setPublished(null);
    } finally {
      setLoadingPublished(false);
    }
  }

  const draftBlockIndex = () => Number(draft?.address.split(':')[2]);

  function deleteDraftBlock(edit: BlockEdit) {
    if (!draft || !data) {
      return;
    }

    const [kind] = draft.address.split(':');

    if (kind === 'intro') {
      // Keep the array position stable so every other pending edit keeps its
      // address and can still be undone. Empty rows are hidden by the reader.
      const cleared = { ...edit, text: '', spaceBefore: 0, spaceAfter: 0, hidden: true };

      applyChange(
        draft,
        applyTextEdit(data, draft, cleared),
        { label: draft.label, where: 'introducere', current: '(șters)', currentLook: lookOf(cleared) },
      );
      setDraft(null);
      return;
    }

    restructure(
      null,
      (passage) => removeBlock(passage, draftBlockIndex()) as Passage,
      null,
    );
  }

  async function publishChanges() {
    if (!data || dirtyPaths.length === 0) {
      return;
    }

    setPublishing(true);
    setPublishStatus({ kind: 'idle', message: '' });

    try {
      const response = await fetch('/.netlify/functions/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
        body: JSON.stringify({
          files: dirtyPaths.map((path) => ({ path, content: fileContent(data, path) })),
        }),
      });
      const body = await response.json();

      if (response.status === 401) {
        signOut('Sesiunea a expirat, dar modificările tale sunt păstrate. Intră din nou și apasă Publică.');
        return;
      }

      if (!response.ok) {
        setPublishStatus({ kind: 'error', message: body.error ?? 'Salvarea a eșuat.', problems: body.problems });
        return;
      }

      setChanges([]);
      setPublishStatus({ kind: 'ok', message: 'Salvat. Site-ul se actualizează în ~1 minut.' });
    } catch {
      setPublishStatus({ kind: 'error', message: 'Nu am putut contacta serverul.' });
    } finally {
      setPublishing(false);
    }
  }

  /**
   * On a phone the book menu is taller than the screen, so scrolling back to the
   * top after a choice leaves the reader looking at the same menu and nothing
   * seems to have happened. Bring the book's title into view instead. On wider
   * screens the title is already visible from the top, and going to the top
   * keeps the menu within reach.
   */
  function revealSelection() {
    window.requestAnimationFrame(() => {
      const heading = document.getElementById('selected-book-title');

      if (!isMobile || !heading) {
        window.scrollTo({ top: 0, behavior: 'smooth' });

        return;
      }

      // The edit bar is sticky, so leave room for it rather than scrolling the
      // title underneath.
      const bar = document.querySelector('.editor-bar');
      const offset = (bar ? bar.getBoundingClientRect().height : 0) + 12;
      const top = heading.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }

  function selectBook(bookId: string) {
    setSelectedSectionId(bookId);
    revealSelection();
  }

  function selectIntroduction() {
    setSelectedSectionId(data?.introduction ? defaultSectionId : data?.books[0]?.id ?? fallbackBookId);
    revealSelection();
  }

  if (isEditorRoute && !session) {
    return (
      <EditorLogin
        notice={signedOutNotice}
        onLogin={(token) => {
          storeSession(token);
          setSession(token);
          setSignedOutNotice('');
        }}
      />
    );
  }

  if (hasError) {
    return (
      <main className="app app-state">
        <p>Textul nu a putut fi încărcat.</p>
      </main>
    );
  }

  if (!data || !selectedTitle) {
    return (
      <main className="app app-state">
        <p>Se încarcă textul...</p>
      </main>
    );
  }

  const isArranging = isEditing && editorMode === 'layout';

  return (
    <main
      className={`app${isEditing ? ' app-editing' : ''}${isArranging ? ' app-arranging' : ''}`}
      onClick={isEditing && !isArranging ? (event) => {
        const target = (event.target as HTMLElement).closest('[data-edit]');
        const address = target instanceof HTMLElement ? target.dataset.edit : undefined;

        if (!address) {
          return;
        }

        event.preventDefault();

        // A verse/paragraph/heading belongs to a passage — edit the whole
        // passage on one screen. Everything else (title, reference, note,
        // introduction) keeps its own single-field dialog, unchanged.
        const [kind, passageIdFromAddress] = address.split(':');

        if (kind === 'block') {
          openPassageEditor(passageIdFromAddress);
        } else {
          openBlockEditor(address);
        }
      } : undefined}
      onPointerDown={isArranging ? startDrag : undefined}
      style={{
        '--reading-width': `${resolveReadingWidth(data.introduction?.readingWidth)}rem`,
        '--verse-number-gap': data.introduction?.verseNumberSpacing !== undefined
          ? `${data.introduction.verseNumberSpacing}em` : undefined,
      } as React.CSSProperties}
    >
      {isEditing ? (
        <EditorBar
          busy={publishing}
          changeCount={changes.length}
          mode={editorMode}
          onVerseNumberSpacing={(amount) => setReadingSetting('versespace', amount)}
          verseNumberSpacing={data.introduction?.verseNumberSpacing ?? null}
          onReadingWidth={(amount) => setReadingSetting('readingwidth', amount)}
          readingWidth={data.introduction?.readingWidth ?? null}
          onMode={(next) => {
            setEditorMode(next);
            setDraft(null);
          }}
          onLogout={() => {
            if (changes.length > 0 && !window.confirm('Ai modificări nepublicate. Ele te așteaptă când intri din nou. Ieși acum?')) {
              return;
            }

            signOut('');
          }}
          onPublish={publishChanges}
          onShowChanges={() => {
            setIsHistoryOpen(true);
            loadPublished();
          }}
          status={publishStatus}
        />
      ) : null}

      {isEditing && isHistoryOpen ? (
        <ChangesPanel
          loadingPublished={loadingPublished}
          onClose={() => setIsHistoryOpen(false)}
          onOpen={(address) => {
            setIsHistoryOpen(false);
            if (address === 'readingwidth' || address === 'versespace') {
              requestAnimationFrame(() => {
                document.getElementById(address === 'readingwidth' ? 'reading-width' : 'verse-number-spacing')?.focus();
              });
              return;
            }
            openBlockEditor(address);
          }}
          onUndo={undoChange}
          onUndoAll={undoAllChanges}
          pending={changes}
          published={published}
        />
      ) : null}

      {draft ? (
        <BlockEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onConfirm={confirmBlockEdit}
          onNavigate={navigateDraft}
          onDelete={deleteDraftBlock}
        />
      ) : null}

      {passagePanel ? (
        <PassageEditor
          // Remounts on a passage switch — a fresh passage's `drafts` must
          // never be read against local field state staged for a different
          // one, or a different-length one, for even one render.
          key={passageId}
          drafts={passagePanel.drafts}
          hasNextPassage={passagePanel.nextPassageId !== null}
          hasPreviousPassage={passagePanel.previousPassageId !== null}
          onCancel={() => setPassageId(null)}
          onNavigatePassage={navigatePassage}
          onSave={savePassage}
          passageId={passagePanel.passageId}
          passageLabel={passagePanel.passageLabel}
        />
      ) : null}

      {isNoticeVisible && !isEditing ? (
        <aside aria-live="polite" className="site-notice" role="status">
          <p>
            Vă rugăm să ne scuzați, aranjarea notițelor și a textului este încă în lucru, lucrăm la
            finalizarea aranjării textului pentru a ajunge la un aspect satisfăcător
          </p>

          <button
            aria-label="Închide notificarea"
            className="site-notice-close"
            onClick={() => setIsNoticeVisible(false)}
            type="button"
          >
            ×
          </button>
        </aside>
      ) : null}

      <header className="document-header">
        <h1>
          <button className="brand-title-button" onClick={selectIntroduction} type="button">
            <span>NOUL</span> <span>TESTAMENT</span>
          </button>
        </h1>

        <p>- o nouă divizare a textului -</p>

        <nav className="book-nav" aria-label="Cărțile Noului Testament">
          {data.books.map((book) => (
            <button
              aria-current={book.id === selectedSectionId ? 'page' : undefined}
              className="book-nav-button"
              key={book.id}
              onClick={() => selectBook(book.id)}
              type="button"
            >
              {book.navTitle}
            </button>
          ))}
        </nav>
      </header>

      <section className="reader-shell" aria-labelledby="selected-book-title">
        <h2
          data-edit={isIntroductionSelected ? 'introtitle' : selectedBook ? `booktitle:${selectedBook.id}` : undefined}
          id="selected-book-title"
          style={blockStyle(isIntroductionSelected
            ? {
              size: data.introduction?.titleSize,
              align: data.introduction?.titleAlign,
              spaceBefore: data.introduction?.titleSpaceBefore,
              spaceAfter: data.introduction?.titleSpaceAfter,
              offsetX: data.introduction?.titleOffsetX,
              offsetY: data.introduction?.titleOffsetY,
            }
            : {
              size: selectedBook?.titleSize,
              align: selectedBook?.titleAlign,
              spaceBefore: selectedBook?.titleSpaceBefore,
              spaceAfter: selectedBook?.titleSpaceAfter,
              offsetX: selectedBook?.titleOffsetX,
              offsetY: selectedBook?.titleOffsetY,
            })}
        >
          {selectedTitle.toUpperCase()}
        </h2>

        {isIntroductionSelected && data.introduction ? (
          <IntroductionPages introduction={data.introduction} />
        ) : selectedBook ? (
          <BookPassages book={selectedBook} />
        ) : null}
      </section>
    </main>
  );
}

async function loadTestamentData(): Promise<TestamentData> {
  const [introduction, bookIndex] = await Promise.all([
    fetchJson<Introduction | null>(CONTENT_INTRODUCTION_URL),
    fetchJson<BookIndexEntry[]>(CONTENT_BOOKS_INDEX_URL),
  ]);

  const books = await Promise.all(
    bookIndex.map((book) => fetchJson<Book>(`/content/books/${book.file}`)),
  );

  return {
    introduction,
    books,
  };
}

/** The content of one editable file, for publishing and for the local backup. */
function fileContent(data: TestamentData, path: string) {
  return path === INTRODUCTION_PATH
    ? data.introduction
    : data.books.find((book) => `public/content/books/${book.id}.json` === path);
}

/** Puts locally kept edits back over the freshly loaded content. */
function withStoredFiles(data: TestamentData, files: Record<string, unknown>): TestamentData {
  return {
    introduction: (files[INTRODUCTION_PATH] as Introduction) ?? data.introduction,
    books: data.books.map((book) => (files[`public/content/books/${book.id}.json`] as Book) ?? book),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Nu am putut încărca ${url}`);
  }

  return response.json() as Promise<T>;
}

/** Summarises a saved edit for the changes panel. */
function describeDraft(draft: BlockDraft, edit: BlockEdit) {
  return {
    label: draft.label,
    where: draft.address.split(':')[1] ?? '',
    current: edit.text,
    currentLook: lookOf(edit),
  };
}

/**
 * A hairline at the column edge, shown only while an element is being dragged
 * past it. It answers the one question dragging free text raises — "have I
 * pushed this out of the column?" — and says nothing the rest of the time.
 */
function openGuides() {
  const layer = document.createElement('div');
  const left = document.createElement('span');
  const right = document.createElement('span');

  layer.className = 'arrange-guides';
  layer.append(left, right);
  document.body.append(layer);

  return {
    update(element: HTMLElement) {
      const column = element.parentElement?.getBoundingClientRect();
      const box = textBounds(element);

      if (!column || !box) {
        return;
      }

      for (const [guide, edge, crossed] of [
        [left, column.left, box.left < column.left - 1],
        [right, column.right, box.right > column.right + 1],
      ] as const) {
        guide.style.left = `${edge}px`;
        guide.classList.toggle('is-on', crossed);
      }
    },
    close() {
      layer.remove();
    },
  };
}

/**
 * How far the words themselves reach, rather than the box around them. A
 * heading fills the column whatever its text says, so measuring its box would
 * report it out of bounds the moment it was nudged an inch to the right.
 */
function textBounds(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);

  const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);

  if (lines.length === 0) {
    return element.getBoundingClientRect();
  }

  return {
    left: Math.min(...lines.map((line) => line.left)),
    right: Math.max(...lines.map((line) => line.right)),
  };
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/** Two decimals is finer than the eye can see and keeps the JSON readable. */
function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** Pulls the look out of a draft or an edit, which carry the same fields. */
function lookOf(layout: {
  size: number;
  align: Align;
  spaceBefore: number | null;
  spaceAfter: number | null;
  hidden: boolean;
  offsetX: number;
  offsetY: number;
}): Look {
  return {
    size: layout.size,
    align: layout.align,
    spaceBefore: layout.spaceBefore,
    spaceAfter: layout.spaceAfter,
    hidden: layout.hidden,
    offsetX: layout.offsetX,
    offsetY: layout.offsetY,
  };
}

/** Returns new data with one passage replaced. */
function applyPassageChange(
  data: TestamentData,
  passageId: string,
  change: (passage: Passage) => Passage,
): TestamentData {
  return {
    ...data,
    books: data.books.map((book) => (!book.passages.some((passage) => passage.id === passageId) ? book : {
      ...book,
      passages: book.passages.map((passage) => (passage.id === passageId ? change(passage) : passage)),
    })),
  };
}

/** Returns new data with the edited text, size and layout written back. */
function applyTextEdit(data: TestamentData, draft: BlockDraft, edit: BlockEdit): TestamentData {
  const [kind, first, second] = draft.address.split(':');
  const size = edit.size === 100 ? undefined : edit.size;
  const align = edit.align || undefined;
  // null restores the page's normal stylesheet value; numeric zero is kept so
  // "Fără" can genuinely remove the built-in paragraph gap.
  const spaceBefore = edit.spaceBefore === null ? undefined : edit.spaceBefore;
  const spaceAfter = edit.spaceAfter === null ? undefined : edit.spaceAfter;
  const offsetX = edit.offsetX || undefined;
  const offsetY = edit.offsetY || undefined;
  const hidden = edit.hidden || undefined;
  // The whole text, verse number included: the number is the first characters
  // of the block, editable like any other word rather than held aside and
  // stitched back on here.
  const text = edit.text;

  // Route reading settings through the same function as text edits so both
  // individual undo and "Anulează tot" restore their original values.
  if (kind === 'versespace' || kind === 'readingwidth') {
    if (!data.introduction) {
      return data;
    }

    return {
      ...data,
      introduction: {
        ...data.introduction,
        [kind === 'readingwidth' ? 'readingWidth' : 'verseNumberSpacing']:
          edit.text === '' ? undefined : Number(edit.text),
      },
    };
  }

  if (kind === 'introtitle' || kind === 'introsubtitle') {
    if (!data.introduction) {
      return data;
    }

    return {
      ...data,
      introduction: kind === 'introtitle'
        ? {
          ...data.introduction,
          title: text,
          titleSize: size,
          titleAlign: align,
          titleSpaceBefore: spaceBefore,
          titleSpaceAfter: spaceAfter,
          titleOffsetX: offsetX,
          titleOffsetY: offsetY,
        }
        : {
          ...data.introduction,
          subtitle: text,
          subtitleSize: size,
          subtitleAlign: align,
          subtitleSpaceBefore: spaceBefore,
          subtitleSpaceAfter: spaceAfter,
          subtitleOffsetX: offsetX,
          subtitleOffsetY: offsetY,
        },
    };
  }

  if (kind === 'booktitle') {
    return {
      ...data,
      books: data.books.map((book) => (book.id !== first ? book : {
        ...book,
        title: text,
        titleSize: size,
        titleAlign: align,
        titleSpaceBefore: spaceBefore,
        titleSpaceAfter: spaceAfter,
        titleOffsetX: offsetX,
        titleOffsetY: offsetY,
      })),
    };
  }

  if (kind === 'intro') {
    if (!data.introduction) {
      return data;
    }

    return {
      ...data,
      introduction: {
        ...data.introduction,
        blocks: data.introduction.blocks.map((block, index) => (
          index !== Number(first)
            ? block
            : { ...block, text, size, align, spaceBefore, spaceAfter, hidden, offsetX, offsetY }
        )),
      },
    };
  }

  return applyPassageChange(data, first, (passage) => {
    if (kind === 'reference') {
      return {
        ...passage,
        reference: text,
        referenceSize: size,
        referenceAlign: align,
        referenceSpaceBefore: spaceBefore,
        referenceSpaceAfter: spaceAfter,
        referenceOffsetX: offsetX,
        referenceOffsetY: offsetY,
      };
    }

    if (kind === 'title') {
      return {
        ...passage,
        title: text,
        titleSize: size,
        titleAlign: align,
        titleSpaceBefore: spaceBefore,
        titleSpaceAfter: spaceAfter,
        titleOffsetX: offsetX,
        titleOffsetY: offsetY,
      };
    }

    if (kind === 'note') {
      return {
        ...passage,
        notes: passage.notes?.map((note, index) => (
          index !== Number(second) ? note : { ...note, text, size, offsetX, offsetY }
        )),
      };
    }

    const targetIndex = Number(second);
    const targetBlock = passage.blocks[targetIndex];
    const [runStart, runEnd] = textRunBounds(passage.blocks, targetIndex);

    return {
      ...passage,
      blocks: passage.blocks.map((block, index) => {
        let nextBlock = block;

        // Alignment belongs to the real paragraph (the run between headings),
        // not to one inline verse. Store it once at the run's first block so it
        // survives page/column splits and opening any verse shows the same value.
        if (targetBlock?.type !== 'heading' && index >= runStart && index <= runEnd) {
          nextBlock = { ...nextBlock, align: index === runStart ? align : undefined };
        }

        if (index !== targetIndex) {
          return nextBlock;
        }

        return targetBlock?.type === 'heading'
          ? { ...nextBlock, text, size, align, spaceBefore, spaceAfter, hidden, offsetX, offsetY }
          : { ...nextBlock, text, size, spaceBefore, spaceAfter, hidden, offsetX, offsetY };
      }),
    };
  });
}

/**
 * Builds a draft. The verse number stays inside the editable text — it is read
 * off the front only to name the row ("Versetul 5") and to anchor the flowing
 * editor's split, never to withhold it from being retyped.
 */
function draftForText(options: {
  address: string;
  path: string;
  label: string;
  rawText: string;
  size?: number;
  align?: ContentBlock['align'];
  spaceBefore?: number;
  spaceAfter?: number;
  hidden?: boolean;
  isVerse: boolean;
  noteRefs?: number[];
  canLayout: boolean;
  offsetX?: number;
  offsetY?: number;
  blockCount?: number;
  blockIndex?: number;
}): BlockDraft {
  const match = options.isVerse ? options.rawText.match(/^(\d{1,3})(.*)$/su) : null;
  const addresses = editableAddresses();
  const position = addresses.indexOf(options.address);
  const canStructure = options.blockIndex !== undefined && options.blockCount !== undefined;

  return {
    address: options.address,
    path: options.path,
    label: match ? `${options.label} ${match[1]}` : options.label,
    size: options.size ?? 100,
    align: options.align ?? '',
    spaceBefore: options.spaceBefore ?? null,
    spaceAfter: options.spaceAfter ?? null,
    hidden: options.hidden ?? false,
    text: options.rawText,
    verseNumber: match ? match[1] : '',
    noteRefs: options.noteRefs ?? [],
    hasPrevious: position > 0,
    hasNext: position >= 0 && position < addresses.length - 1,
    canLayout: options.canLayout,
    canStructure,
    canDelete: canStructure && options.blockCount! > 1,
    offsetX: options.offsetX ?? 0,
    offsetY: options.offsetY ?? 0,
  };
}

/**
 * Editable addresses in reading order, so the arrows in the editor step through
 * the page the way the eye does. One block can render as several lines, so
 * duplicates are collapsed.
 */
function editableAddresses() {
  const seen = new Set<string>();

  for (const element of document.querySelectorAll<HTMLElement>('[data-edit]')) {
    if (
      element.dataset.edit
      && !element.classList.contains('hidden-text-line')
      && !element.classList.contains('hidden-text-fragment')
    ) {
      seen.add(element.dataset.edit);
    }
  }

  return [...seen];
}

function IntroductionPages({ introduction }: { introduction: Introduction }) {
  const pages = [{ number: 1, blocks: introduction.blocks }];

  return (
    <div className="introduction-stack">
      {pages.map((page, pageIndex) => (
        <article className="document-page introduction-page" key={`introduction-${page.number}`}>
          {pageIndex === 0 && introduction.subtitle ? (
            <h3
              data-edit="introsubtitle"
              style={blockStyle({
                size: introduction.subtitleSize,
                align: introduction.subtitleAlign,
                spaceBefore: introduction.subtitleSpaceBefore,
                spaceAfter: introduction.subtitleSpaceAfter,
                offsetX: introduction.subtitleOffsetX,
                offsetY: introduction.subtitleOffsetY,
              })}
            >
              {introduction.subtitle}
            </h3>
          ) : null}

          <div className="introduction-body">
            {page.blocks.map((block, index) => (
              <ContentBlockView
                address={`intro:${index}`}
                block={block}
                key={`introduction-${page.number}-${index}`}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function BookPassages({ book }: { book: Book }) {
  return (
    <div className="book-stack">
      {book.passages.map((passage) => <PassageView key={passage.id} passage={passage} />)}
    </div>
  );
}

/** Tracks the phone breakpoint for navigation and the site notice. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(query.matches);

    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function PassageView({ passage }: { passage: Passage }) {
  return (
    <article className="passage">
      <header className="passage-header">
        {passage.reference ? (
          <p
            className="passage-reference"
            data-edit={`reference:${passage.id}`}
            style={blockStyle({
              size: passage.referenceSize,
              align: passage.referenceAlign,
              spaceBefore: passage.referenceSpaceBefore,
              spaceAfter: passage.referenceSpaceAfter,
              offsetX: passage.referenceOffsetX,
              offsetY: passage.referenceOffsetY,
            })}
          >
            <span>{passage.number}</span>
            <span>({passage.reference})</span>
          </p>
        ) : null}

        <h3
          className="passage-title"
          data-edit={`title:${passage.id}`}
          style={blockStyle({
            size: passage.titleSize,
            align: passage.titleAlign,
            spaceBefore: passage.titleSpaceBefore,
            spaceAfter: passage.titleSpaceAfter,
            offsetX: passage.titleOffsetX,
            offsetY: passage.titleOffsetY,
          })}
        >
          {renderInlineMarkup(passage.title, `${passage.id}-title`)}
        </h3>
      </header>

      <div className="passage-body">
        <PassageBlocks
          blocks={passage.blocks}
          passageId={passage.id}
          allBlocks={passage.blocks}
          notes={passage.notes}
        />
      </div>

      {passage.notes?.length ? (
        <PassageNotes notes={passage.notes.map((note, noteIndex) => ({
          ...note,
          passageId: passage.id,
          noteIndex,
        }))} />
      ) : null}
    </article>
  );
}

function PassageNotes({ notes }: { notes: PageFootnote[] }) {
  return (
    <footer className="passage-notes" aria-label="Note de subsol">
      <ol>
        {notes.map((note) => (
          <li
            data-edit={`note:${note.passageId}:${note.noteIndex}`}
            key={note.number}
            style={fragmentStyle(note)}
            value={note.number}
          >
            {renderInlineMarkup(note.text)}
          </li>
        ))}
      </ol>
    </footer>
  );
}

function ContentBlockView({ block, address }: { block: ContentBlock; address?: string }) {
  const style = blockStyle(block);
  const isEmpty = block.text.trim().length === 0;

  if (block.type === 'heading') {
    return (
      <h4 className="inline-heading" data-edit={address} style={style}>
        {renderTextWithNotes(block.text, block.noteRefs)}
      </h4>
    );
  }

  if (block.type === 'verse') {
    const match = block.text.match(/^(\d{1,3})(.*)$/su);

    if (match) {
      return (
        <p className="verse-line" data-edit={address} style={style}>
          <sup>{match[1]}</sup>
          {renderTextWithNotes(trimVerseTextStart(match[2]), block.noteRefs)}
        </p>
      );
    }
  }

  return (
    <p
      aria-label={isEmpty ? 'Rând gol — apasă pentru a-l modifica' : undefined}
      className={`text-line${isEmpty ? ' empty-text-line' : ''}${block.hidden ? ' hidden-text-line' : ''}`}
      data-edit={address}
      style={style}
    >
      {renderTextWithNotes(block.text, block.noteRefs)}
    </p>
  );
}

export default App;
