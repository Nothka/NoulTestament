import { Fragment, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { countFootnoteMarkers } from './footnote-markers.js';
import { renderInlineMarkup, renderTextWithNotes } from './markup';
import {
  BlockEditor,
  EditorBar,
  EditorLogin,
  readStoredSession,
  storeSession,
  type BlockDraft,
} from './editing';
import './App.css';

const CONTENT_BOOKS_INDEX_URL = '/content/books-index.json';
const INTRODUCTION_PATH = 'public/content/introduction.json';
const CONTENT_INTRODUCTION_URL = '/content/introduction.json';
const defaultSectionId = 'introduction';
const fallbackBookId = 'matei';

type ContentBlock = {
  type: 'heading' | 'paragraph' | 'verse';
  text: string;
  noteRefs?: number[];
  /** Font size as a percentage of the normal size, set from edit mode. */
  size?: number;
};

type Footnote = {
  number: number;
  text: string;
  size?: number;
};

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
  pageNumber?: number;
  blocks: ContentBlock[];
  notes?: Footnote[];
};

type PagePassage = {
  id: string;
  passageId: string;
  titleSize?: number;
  bookId: string;
  number: number;
  reference: string;
  title: string;
  isContinuation: boolean;
  blocks: ContentBlock[];
  allBlocks: ContentBlock[];
  notes?: Footnote[];
};

type VisualBookPage = {
  number: number;
  columns: [PagePassage[], PagePassage[]];
  notes: PageFootnote[];
};

type Book = {
  id: string;
  navTitle: string;
  title: string;
  passages: Passage[];
};

type Introduction = {
  id: string;
  title: string;
  subtitle: string;
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

  const isEditorRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/edit');
  const [session, setSession] = useState<string | null>(() => (isEditorRoute ? readStoredSession() : null));
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
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

        setData(nextData);

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
    if (!data) {
      return;
    }

    const [kind, first, second] = address.split(':');

    if (kind === 'intro') {
      const block = data.introduction?.blocks[Number(first)];

      if (!block) {
        return;
      }

      setDraft(draftForText({
        address,
        path: INTRODUCTION_PATH,
        label: 'Paragraf (introducere)',
        rawText: block.text,
        size: block.size,
        isVerse: block.type === 'verse',
        noteRefs: block.noteRefs,
      }));
      return;
    }

    const book = data.books.find((candidate) => candidate.passages.some((passage) => passage.id === first));
    const passage = book?.passages.find((candidate) => candidate.id === first);

    if (!book || !passage) {
      return;
    }

    const path = `public/content/books/${book.id}.json`;

    if (kind === 'title') {
      setDraft(draftForText({
        address, path, label: 'Titlul pasajului', rawText: passage.title, size: passage.titleSize, isVerse: false,
      }));
      return;
    }

    if (kind === 'note') {
      const note = passage.notes?.[Number(second)];

      if (!note) {
        return;
      }

      setDraft(draftForText({
        address, path, label: `Nota ${note.number}`, rawText: note.text, size: note.size, isVerse: false,
      }));
      return;
    }

    const block = passage.blocks[Number(second)];

    if (!block) {
      return;
    }

    const label = block.type === 'heading' ? 'Subtitlu' : block.type === 'verse' ? 'Verset' : 'Paragraf';

    setDraft(draftForText({
      address,
      path,
      label,
      rawText: block.text,
      size: block.size,
      isVerse: block.type === 'verse',
      noteRefs: getResolvedNoteRefsForBlock(block, passage.blocks, passage.notes ?? []),
    }));
  }

  function confirmBlockEdit(nextText: string, nextSize: number) {
    commitDraft(nextText, nextSize);
    setDraft(null);
  }

  /** Saves the open draft, then opens its neighbour in reading order. */
  function navigateDraft(direction: -1 | 1, nextText: string, nextSize: number) {
    if (!draft) {
      return;
    }

    commitDraft(nextText, nextSize);

    const addresses = editableAddresses();
    const target = addresses[addresses.indexOf(draft.address) + direction];

    if (target) {
      openBlockEditor(target);
    } else {
      setDraft(null);
    }
  }

  function commitDraft(nextText: string, nextSize: number) {
    if (!draft || !data) {
      return;
    }

    const [kind, first, second] = draft.address.split(':');
    const size = nextSize === 100 ? undefined : nextSize;
    const text = `${draft.verseNumber}${nextText}`;

    if (kind === 'intro' && data.introduction) {
      setData({
        ...data,
        introduction: {
          ...data.introduction,
          blocks: data.introduction.blocks.map((block, index) => (
            index !== Number(first) ? block : { ...block, text, size }
          )),
        },
      });
    } else {
      setData({
        ...data,
        books: data.books.map((book) => (!book.passages.some((passage) => passage.id === first) ? book : {
          ...book,
          passages: book.passages.map((passage) => {
            if (passage.id !== first) {
              return passage;
            }

            if (kind === 'title') {
              return { ...passage, title: text, titleSize: size };
            }

            if (kind === 'note') {
              return {
                ...passage,
                notes: passage.notes?.map((note, index) => (
                  index !== Number(second) ? note : { ...note, text, size }
                )),
              };
            }

            return {
              ...passage,
              blocks: passage.blocks.map((block, index) => (
                index !== Number(second) ? block : { ...block, text, size }
              )),
            };
          }),
        })),
      });
    }

    setDirtyPaths((current) => (current.includes(draft.path) ? current : [...current, draft.path]));
    setPublishStatus({ kind: 'idle', message: '' });
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
          files: dirtyPaths.map((path) => ({
            path,
            content: path === INTRODUCTION_PATH
              ? data.introduction
              : data.books.find((book) => `public/content/books/${book.id}.json` === path),
          })),
        }),
      });
      const body = await response.json();

      if (response.status === 401) {
        storeSession(null);
        setSession(null);
        return;
      }

      if (!response.ok) {
        setPublishStatus({ kind: 'error', message: body.error ?? 'Salvarea a eșuat.', problems: body.problems });
        return;
      }

      setDirtyPaths([]);
      setPublishStatus({ kind: 'ok', message: 'Salvat. Site-ul se actualizează în ~1 minut.' });
    } catch {
      setPublishStatus({ kind: 'error', message: 'Nu am putut contacta serverul.' });
    } finally {
      setPublishing(false);
    }
  }

  function selectBook(bookId: string) {
    setSelectedSectionId(bookId);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  function selectIntroduction() {
    setSelectedSectionId(data?.introduction ? defaultSectionId : data?.books[0]?.id ?? fallbackBookId);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  if (isEditorRoute && !session) {
    return (
      <EditorLogin
        onLogin={(token) => {
          storeSession(token);
          setSession(token);
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

  return (
    <main
      className={isEditing ? 'app app-editing' : 'app'}
      onClick={isEditing ? (event) => {
        const target = (event.target as HTMLElement).closest('[data-edit]');
        const address = target instanceof HTMLElement ? target.dataset.edit : undefined;

        if (address) {
          event.preventDefault();
          openBlockEditor(address);
        }
      } : undefined}
    >
      {isEditing ? (
        <EditorBar
          busy={publishing}
          dirtyCount={dirtyPaths.length}
          onLogout={() => {
            storeSession(null);
            setSession(null);
          }}
          onPublish={publishChanges}
          status={publishStatus}
        />
      ) : null}

      {draft ? (
        <BlockEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onConfirm={confirmBlockEdit}
          onNavigate={navigateDraft}
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
        <h2 id="selected-book-title">{selectedTitle.toUpperCase()}</h2>

        {isIntroductionSelected && data.introduction ? (
          <IntroductionPages introduction={data.introduction} />
        ) : selectedBook ? (
          <BookPages book={selectedBook} />
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Nu am putut încărca ${url}`);
  }

  return response.json() as Promise<T>;
}

/** Builds a draft, splitting a leading verse number out of editable text. */
function draftForText(options: {
  address: string;
  path: string;
  label: string;
  rawText: string;
  size?: number;
  isVerse: boolean;
  noteRefs?: number[];
}): BlockDraft {
  const match = options.isVerse ? options.rawText.match(/^(\d{1,3})(.*)$/u) : null;
  const addresses = editableAddresses();
  const position = addresses.indexOf(options.address);

  return {
    address: options.address,
    path: options.path,
    label: match ? `${options.label} ${match[1]}` : options.label,
    size: options.size ?? 100,
    text: match ? match[2] : options.rawText,
    verseNumber: match ? match[1] : '',
    noteRefs: options.noteRefs ?? [],
    hasPrevious: position > 0,
    hasNext: position >= 0 && position < addresses.length - 1,
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
    if (element.dataset.edit) {
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
          {pageIndex === 0 && introduction.subtitle ? <h3>{introduction.subtitle}</h3> : null}

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

function BookPages({ book }: { book: Book }) {
  const [pages, setPages] = useState<VisualBookPage[]>(() => buildEstimatedVisualPages(book));

  useLayoutEffect(() => {
    function updatePages() {
      setPages(buildMeasuredVisualPages(book) ?? buildEstimatedVisualPages(book));
    }

    updatePages();
    window.addEventListener('resize', updatePages);

    return () => {
      window.removeEventListener('resize', updatePages);
    };
  }, [book]);

  return (
    <div className="page-stack">
      {pages.map((page) => (
        <section className="document-page" key={`${book.id}-${page.number}`} aria-label={`Pagina ${page.number}`}>
          <div className="page-content">
            {page.columns.map((column, columnIndex) => (
              <div className="page-column" key={`${book.id}-${page.number}-${columnIndex}`}>
                {column.map((passage) => (
                  <PagePassageView passage={passage} key={passage.id} />
                ))}
              </div>
            ))}
          </div>

          {page.notes.length > 0 ? <PassageNotes notes={page.notes} /> : null}
        </section>
      ))}
    </div>
  );
}

function buildEstimatedVisualPages(book: Book): VisualBookPage[] {
  const columnLimit = 3600;
  const pages: VisualBookPage[] = [];
  let page = createVisualPage(1);
  let columnIndex: 0 | 1 = 0;
  let columnWeight = [0, 0];

  for (const passage of book.passages) {
    let remainingBlocks = passage.blocks;
    let isFirstSegment = true;

    while (remainingBlocks.length > 0) {
      const availableWeight = Math.max(columnLimit - columnWeight[columnIndex], 0);
      const segment = takePassageSegment(passage, remainingBlocks, availableWeight, isFirstSegment);

      if (segment.blocks.length === 0) {
        const nextLayout = advanceColumnOrPage(page, pages, columnIndex, columnWeight);
        page = nextLayout.page;
        columnIndex = nextLayout.columnIndex;
        columnWeight = nextLayout.columnWeight;
        continue;
      }

      page.columns[columnIndex].push({
        id: `${passage.id}-${isFirstSegment ? 'start' : 'continue'}-${remainingBlocks.length}`,
        passageId: passage.id,
        bookId: book.id,
        number: passage.number,
        reference: passage.reference,
        title: passage.title,
        titleSize: passage.titleSize,
        isContinuation: !isFirstSegment,
        blocks: segment.blocks,
        allBlocks: passage.blocks,
        notes: passage.notes,
      });

      addNotesForBlocks(page, passage, segment.blocks);
      columnWeight[columnIndex] += segment.weight;
      remainingBlocks = remainingBlocks.slice(segment.blocks.length);
      isFirstSegment = false;

      if (remainingBlocks.length > 0) {
        const nextLayout = advanceColumnOrPage(page, pages, columnIndex, columnWeight);
        page = nextLayout.page;
        columnIndex = nextLayout.columnIndex;
        columnWeight = nextLayout.columnWeight;
      }
    }
  }

  if (page.columns[0].length > 0 || page.columns[1].length > 0 || page.notes.length > 0) {
    pages.push(page);
  }

  return pages;
}

function buildMeasuredVisualPages(book: Book): VisualBookPage[] | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const readerShell = document.querySelector<HTMLElement>('.reader-shell');

  if (!readerShell) {
    return null;
  }

  const isMobile = window.matchMedia('(max-width: 560px)').matches;
  const columnGap = isMobile ? 0 : 52;
  const columnWidth = isMobile
    ? readerShell.clientWidth
    : Math.max(260, Math.floor((readerShell.clientWidth - columnGap) / 2));
  const columnLimit = isMobile
    ? Number.POSITIVE_INFINITY
    : Math.max(760, Math.min(980, Math.round(columnWidth * 1.65)));
  const measurer = createMeasurementRoot(columnWidth);
  const pages: VisualBookPage[] = [];
  let page = createVisualPage(1);
  let columnIndex: 0 | 1 = 0;
  let columnHeight = [0, 0];

  try {
    for (const passage of book.passages) {
      let remainingBlocks = passage.blocks;
      let isFirstSegment = true;

      while (remainingBlocks.length > 0) {
        const availableHeight = columnLimit - columnHeight[columnIndex];
        const segment = takeMeasuredPassageSegment(
          passage,
          remainingBlocks,
          measurer,
          availableHeight,
          isFirstSegment,
        );

        if (segment.blocks.length === 0) {
          const nextLayout = advanceColumnOrPage(page, pages, columnIndex, columnHeight);
          page = nextLayout.page;
          columnIndex = nextLayout.columnIndex;
          columnHeight = nextLayout.columnWeight;
          continue;
        }

        page.columns[columnIndex].push({
          id: `${passage.id}-${isFirstSegment ? 'start' : 'continue'}-${remainingBlocks.length}`,
          passageId: passage.id,
          bookId: book.id,
          number: passage.number,
          reference: passage.reference,
          title: passage.title,
          titleSize: passage.titleSize,
          isContinuation: !isFirstSegment,
          blocks: segment.blocks,
          allBlocks: passage.blocks,
          notes: passage.notes,
        });

        addNotesForBlocks(page, passage, segment.blocks);
        columnHeight[columnIndex] += segment.height;
        remainingBlocks = remainingBlocks.slice(segment.blocks.length);
        isFirstSegment = false;

        if (remainingBlocks.length > 0) {
          const nextLayout = advanceColumnOrPage(page, pages, columnIndex, columnHeight);
          page = nextLayout.page;
          columnIndex = nextLayout.columnIndex;
          columnHeight = nextLayout.columnWeight;
        }
      }
    }

    if (page.columns[0].length > 0 || page.columns[1].length > 0 || page.notes.length > 0) {
      pages.push(page);
    }

    return pages;
  } finally {
    measurer.remove();
  }
}

function takeMeasuredPassageSegment(
  passage: Passage,
  blocks: ContentBlock[],
  measurer: HTMLElement,
  availableHeight: number,
  includeHeader: boolean,
) {
  const minimumUsefulHeight = 120;

  if (availableHeight < minimumUsefulHeight && blocks.length > 1) {
    return {
      blocks: [],
      height: 0,
    };
  }

  let selectedBlocks: ContentBlock[] = [];
  let selectedHeight = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const candidateBlocks = blocks.slice(0, index + 1);
    const candidateHeight = measurePassageSegment(
      passage,
      candidateBlocks,
      measurer,
      !includeHeader,
    );

    if (selectedBlocks.length > 0 && candidateHeight > availableHeight) {
      break;
    }

    selectedBlocks = candidateBlocks;
    selectedHeight = candidateHeight;

    if (candidateHeight >= availableHeight) {
      break;
    }
  }

  if (
    selectedBlocks.length > 0
    && selectedBlocks[selectedBlocks.length - 1]?.type === 'heading'
    && blocks.length > selectedBlocks.length
  ) {
    selectedBlocks = selectedBlocks.slice(0, -1);
    selectedHeight = selectedBlocks.length > 0
      ? measurePassageSegment(passage, selectedBlocks, measurer, !includeHeader)
      : 0;
  }

  if (selectedBlocks.length === 0 && blocks.length > 0) {
    selectedBlocks = [blocks[0]];
    selectedHeight = measurePassageSegment(passage, selectedBlocks, measurer, !includeHeader);
  }

  return {
    blocks: selectedBlocks,
    height: selectedHeight,
  };
}

function createMeasurementRoot(columnWidth: number) {
  const root = document.createElement('div');
  root.style.position = 'absolute';
  root.style.left = '-10000px';
  root.style.top = '0';
  root.style.visibility = 'hidden';
  root.style.pointerEvents = 'none';
  root.style.width = `${columnWidth}px`;
  root.style.fontFamily = 'Georgia, "Times New Roman", Times, serif';
  document.body.appendChild(root);

  return root;
}

function measurePassageSegment(
  passage: Passage,
  blocks: ContentBlock[],
  measurer: HTMLElement,
  isContinuation: boolean,
) {
  measurer.replaceChildren(createMeasuredPassageElement(passage, blocks, isContinuation));

  return measurer.scrollHeight;
}

function createMeasuredPassageElement(
  passage: Passage,
  blocks: ContentBlock[],
  isContinuation: boolean,
) {
  const article = document.createElement('article');
  article.className = isContinuation ? 'passage passage-continuation' : 'passage';

  if (!isContinuation) {
    const header = document.createElement('header');
    header.className = 'passage-header';

    if (passage.reference) {
      const reference = document.createElement('p');
      reference.className = 'passage-reference';
      const number = document.createElement('span');
      number.textContent = String(passage.number);
      const traditionalReference = document.createElement('span');
      traditionalReference.textContent = `(${passage.reference})`;
      reference.append(number, traditionalReference);
      header.append(reference);
    }

    const title = document.createElement('h3');
    title.className = 'passage-title';
    title.textContent = stripInlineMarkup(passage.title);
    header.append(title);
    article.append(header);
  }

  const body = document.createElement('div');
  body.className = 'passage-body';

  if (passage.id === 'matei-1') {
    appendMeasuredGenealogyBlocks(body, blocks);
  } else {
    appendMeasuredPassageBlocks(body, blocks);
  }

  article.append(body);

  return article;
}

function appendMeasuredPassageBlocks(container: HTMLElement, blocks: ContentBlock[]) {
  const groupedBlocks: Array<ContentBlock | ContentBlock[]> = [];
  let textGroup: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (textGroup.length > 0) {
        groupedBlocks.push(textGroup);
        textGroup = [];
      }

      groupedBlocks.push(block);
      continue;
    }

    textGroup.push(block);
  }

  if (textGroup.length > 0) {
    groupedBlocks.push(textGroup);
  }

  for (const group of groupedBlocks) {
    if (Array.isArray(group)) {
      const paragraph = document.createElement('p');
      paragraph.className = 'passage-paragraph';

      for (const block of group) {
        appendMeasuredInlineBlock(paragraph, block);
      }

      container.append(paragraph);
      continue;
    }

    const heading = document.createElement('h4');
    heading.className = 'inline-heading';
    heading.textContent = group.text;
    container.append(heading);
  }
}

function appendMeasuredInlineBlock(container: HTMLElement, block: ContentBlock) {
  const span = document.createElement('span');
  const match = block.type === 'verse' ? block.text.match(/^(\d{1,3})(.*)$/u) : null;
  span.className = block.type === 'verse' ? 'verse-fragment' : 'text-fragment';

  if (match) {
    const sup = document.createElement('sup');
    sup.textContent = match[1];
    span.append(sup, document.createTextNode(match[2].trimStart()));
  } else {
    span.textContent = block.text;
  }

  container.append(span);
}

function appendMeasuredGenealogyBlocks(container: HTMLElement, blocks: ContentBlock[]) {
  const wrapper = document.createElement('div');
  wrapper.className = 'genealogy-lines';

  for (const block of blocks) {
    if (block.type === 'heading') {
      const heading = document.createElement('h4');
      heading.className = 'inline-heading';
      heading.textContent = block.text;
      wrapper.append(heading);
      continue;
    }

    for (const line of splitGenealogyText(block.text)) {
      const paragraph = document.createElement('p');
      paragraph.className = 'genealogy-line';
      const match = line.match(/^(\d{1,3})(.*)$/u);

      if (match) {
        const sup = document.createElement('sup');
        sup.textContent = match[1];
        paragraph.append(sup, document.createTextNode(match[2].trimStart()));
      } else {
        paragraph.textContent = line;
      }

      wrapper.append(paragraph);
    }
  }

  container.append(wrapper);
}

function advanceColumnOrPage(
  page: VisualBookPage,
  pages: VisualBookPage[],
  columnIndex: 0 | 1,
  columnWeight: number[],
) {
  if (columnIndex === 0) {
    return {
      page,
      columnIndex: 1 as const,
      columnWeight,
    };
  }

  pages.push(page);

  return {
    page: createVisualPage(pages.length + 1),
    columnIndex: 0 as const,
    columnWeight: [0, 0],
  };
}

function createVisualPage(number: number): VisualBookPage {
  return {
    number,
    columns: [[], []],
    notes: [],
  };
}

function takePassageSegment(
  passage: Passage,
  blocks: ContentBlock[],
  availableWeight: number,
  includeHeader: boolean,
) {
  const headerWeight = includeHeader ? passage.title.length + 150 : 60;
  const minimumUsefulSpace = 360;

  if (availableWeight < minimumUsefulSpace && blocks.length > 1) {
    return {
      blocks: [],
      weight: 0,
    };
  }

  const selectedBlocks: ContentBlock[] = [];
  let weight = headerWeight;

  for (const block of blocks) {
    const blockWeight = estimateBlockWeight(block, passage);

    if (
      selectedBlocks.length > 0
      && weight + blockWeight > availableWeight
    ) {
      break;
    }

    selectedBlocks.push(block);
    weight += blockWeight;

    if (weight >= availableWeight) {
      break;
    }
  }

  if (selectedBlocks.length === 0 && blocks.length > 0) {
    selectedBlocks.push(blocks[0]);
    weight += estimateBlockWeight(blocks[0], passage);
  }

  if (
    selectedBlocks.length > 0
    && selectedBlocks[selectedBlocks.length - 1]?.type === 'heading'
    && blocks.length > selectedBlocks.length
  ) {
    const orphanHeading = selectedBlocks.pop();
    weight -= orphanHeading ? estimateBlockWeight(orphanHeading, passage) : 0;
  }

  return {
    blocks: selectedBlocks,
    weight,
  };
}

function estimateBlockWeight(block: ContentBlock, passage: Passage) {
  const headingWeight = block.type === 'heading' ? 180 : 0;
  const noteWeight = Math.max(block.noteRefs?.length ?? 0, countFootnoteMarkers(block.text)) * 90;

  if (passage.id === 'matei-1' && block.type !== 'heading') {
    return splitGenealogyText(block.text).length * 115 + noteWeight + 16;
  }

  return block.text.length + headingWeight + noteWeight + 24;
}

function addNotesForBlocks(page: VisualBookPage, passage: Passage, blocks: ContentBlock[]) {
  if (!passage.notes?.length) {
    return;
  }

  const noteNumbers = new Set(
    blocks.flatMap((block) => getResolvedNoteRefsForBlock(block, passage.blocks, passage.notes)),
  );
  const existingNoteNumbers = new Set(page.notes.map((note) => note.number));

  for (const [noteIndex, note] of passage.notes.entries()) {
    if (noteNumbers.has(note.number) && !existingNoteNumbers.has(note.number)) {
      page.notes.push({ ...note, passageId: passage.id, noteIndex });
      existingNoteNumbers.add(note.number);
    }
  }
}

/**
 * Addresses an editable element so a click in the rendered page maps back to
 * the field it came from. Shapes: `block:<passageId>:<i>`, `title:<passageId>`,
 * `note:<passageId>:<i>`, `intro:<i>`.
 */
function blockAddress(passageId: string, allBlocks: ContentBlock[], block: ContentBlock) {
  const index = allBlocks.indexOf(block);

  return index >= 0 ? `block:${passageId}:${index}` : undefined;
}

/** Inline style carrying a per-element font scale, or nothing when unset. */
function sizeStyle(size?: number) {
  return size && size !== 100
    ? ({ '--size-scale': String(size / 100) } as React.CSSProperties)
    : undefined;
}

function getResolvedNoteRefsForBlock(
  block: ContentBlock,
  allBlocks: ContentBlock[],
  notes: Footnote[] = [],
) {
  const markerCount = countFootnoteMarkers(block.text);

  if (markerCount === 0) {
    return [];
  }

  if (notes.length > 0) {
    const blockIndex = allBlocks.indexOf(block);
    const previousBlocks = blockIndex >= 0 ? allBlocks.slice(0, blockIndex) : [];
    const previousMarkerCount = previousBlocks.reduce(
      (total, currentBlock) => total + countFootnoteMarkers(currentBlock.text),
      0,
    );

    return notes
      .slice(previousMarkerCount, previousMarkerCount + markerCount)
      .map((note) => note.number);
  }

  return (block.noteRefs ?? []).slice(0, markerCount);
}

function PagePassageView({ passage }: { passage: PagePassage }) {
  return (
    <article className={passage.isContinuation ? 'passage passage-continuation' : 'passage'}>
      {!passage.isContinuation ? (
        <header className="passage-header">
          {passage.reference ? (
            <p className="passage-reference">
              <span>{passage.number}</span>
              <span>({passage.reference})</span>
            </p>
          ) : null}

          <h3
            className="passage-title"
            data-edit={`title:${passage.passageId}`}
            style={sizeStyle(passage.titleSize)}
          >
            {renderInlineMarkup(passage.title, `${passage.id}-title`)}
          </h3>
        </header>
      ) : null}

      <div className="passage-body">
        <PassageBlocks
          blocks={passage.blocks}
          passageId={passage.passageId}
          allBlocks={passage.allBlocks}
          notes={passage.notes}
        />
      </div>
    </article>
  );
}

function PassageBlocks({
  blocks,
  passageId,
  allBlocks = blocks,
  notes = [],
}: {
  blocks: ContentBlock[];
  passageId: string;
  allBlocks?: ContentBlock[];
  notes?: Footnote[];
}) {
  if (passageId === 'matei-1') {
    return <GenealogyBlocks blocks={blocks} passageId={passageId} allBlocks={allBlocks} notes={notes} />;
  }

  const groupedBlocks: Array<ContentBlock | ContentBlock[]> = [];
  let textGroup: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (textGroup.length > 0) {
        groupedBlocks.push(textGroup);
        textGroup = [];
      }

      groupedBlocks.push(block);
      continue;
    }

    textGroup.push(block);
  }

  if (textGroup.length > 0) {
    groupedBlocks.push(textGroup);
  }

  return groupedBlocks.map((group, index) => {
    if (Array.isArray(group)) {
      return (
        <p className="passage-paragraph" key={`${passageId}-paragraph-${index}`}>
          {group.map((block, blockIndex) => (
            <InlineBlock
              address={blockAddress(passageId, allBlocks, block)}
              block={block}
              noteRefs={getResolvedNoteRefsForBlock(block, allBlocks, notes)}
              key={`${passageId}-${index}-${blockIndex}`}
            />
          ))}
        </p>
      );
    }

    return (
      <h4
        className="inline-heading"
        data-edit={blockAddress(passageId, allBlocks, group)}
        key={`${passageId}-heading-${index}`}
        style={sizeStyle(group.size)}
      >
        {renderTextWithNotes(group.text, getResolvedNoteRefsForBlock(group, allBlocks, notes))}
      </h4>
    );
  });
}

function InlineBlock({ block, noteRefs, address }: { block: ContentBlock; noteRefs?: number[]; address?: string }) {
  if (block.type === 'verse') {
    const match = block.text.match(/^(\d{1,3})(.*)$/u);

    if (match) {
      return (
        <span className="verse-fragment" data-edit={address} style={sizeStyle(block.size)}>
          <sup>{match[1]}</sup>
          {renderTextWithNotes(match[2].trimStart(), noteRefs)}
        </span>
      );
    }
  }

  return (
    <span className="text-fragment" data-edit={address} style={sizeStyle(block.size)}>
      {renderTextWithNotes(block.text, noteRefs)}
    </span>
  );
}

function GenealogyBlocks({
  blocks,
  passageId,
  allBlocks = blocks,
  notes = [],
}: {
  blocks: ContentBlock[];
  passageId: string;
  allBlocks?: ContentBlock[];
  notes?: Footnote[];
}) {
  return (
    <div className="genealogy-lines">
      {blocks.flatMap((block, blockIndex) => {
        if (block.type === 'heading') {
          return [
            <h4
              className="inline-heading"
              data-edit={blockAddress(passageId, allBlocks, block)}
              key={`${passageId}-${blockIndex}`}
              style={sizeStyle(block.size)}
            >
              {renderTextWithNotes(block.text, getResolvedNoteRefsForBlock(block, allBlocks, notes))}
            </h4>,
          ];
        }

        const lines = splitGenealogyText(block.text);

        return lines.map((line, lineIndex) => (
          <p
            className="genealogy-line"
            data-edit={blockAddress(passageId, allBlocks, block)}
            key={`${passageId}-${blockIndex}-${lineIndex}`}
            style={sizeStyle(block.size)}
          >
            {lineIndex === 0 ? (
              <GenealogyLine text={line} noteRefs={getResolvedNoteRefsForBlock(block, allBlocks, notes)} />
            ) : (
              <GenealogyLine text={line} />
            )}
          </p>
        ));
      })}
    </div>
  );
}

function GenealogyLine({ noteRefs = [], text }: { noteRefs?: number[]; text: string }) {
  const match = text.match(/^(\d{1,3})(.*)$/u);

  if (!match) {
    return renderTextWithNotes(text, noteRefs);
  }

  return (
    <>
      <sup>{match[1]}</sup>
      {renderTextWithNotes(match[2].trimStart(), noteRefs)}
    </>
  );
}

function splitGenealogyText(text: string) {
  const normalizedText = text.trim();
  const verseMatch = normalizedText.match(/^(\d{1,3})(.*)$/u);

  if (!verseMatch) {
    return normalizedText
      .split(/;\s*/u)
      .map((line, index, lines) => (index < lines.length - 1 ? `${line};` : line))
      .filter(Boolean);
  }

  const [, verseNumber, verseText] = verseMatch;
  const parts = verseText.trim()
    .split(/;\s*/u)
    .map((line, index, lines) => (index < lines.length - 1 ? `${line};` : line))
    .filter(Boolean);

  if (parts.length === 0) {
    return [normalizedText];
  }

  return parts.map((part, index) => (index === 0 ? `${verseNumber}${part}` : part));
}

function PassageNotes({ notes }: { notes: PageFootnote[] }) {
  return (
    <footer className="passage-notes" aria-label="Note de subsol">
      <ol>
        {notes.map((note) => (
          <li
            data-edit={`note:${note.passageId}:${note.noteIndex}`}
            key={note.number}
            style={sizeStyle(note.size)}
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
  const style = sizeStyle(block.size);

  if (block.type === 'heading') {
    return (
      <h4 className="inline-heading" data-edit={address} style={style}>
        {renderTextWithNotes(block.text, block.noteRefs)}
      </h4>
    );
  }

  if (block.type === 'verse') {
    const match = block.text.match(/^(\d{1,3})(.*)$/u);

    if (match) {
      return (
        <p className="verse-line" data-edit={address} style={style}>
          <sup>{match[1]}</sup>
          {renderTextWithNotes(match[2].trimStart(), block.noteRefs)}
        </p>
      );
    }
  }

  return (
    <p className="text-line" data-edit={address} style={style}>
      {renderTextWithNotes(block.text, block.noteRefs)}
    </p>
  );
}

function stripInlineMarkup(text: string) {
  return text.replace(
    /\*\*([^*]+)\*\*|\*([^*\n]+)\*|__([^_]+)__|_([^_]+)_/gu,
    (_, boldStar, italicStar, boldUnderscore, italicUnderscore) => (
      boldStar ?? italicStar ?? boldUnderscore ?? italicUnderscore ?? ''
    ),
  );
}

export default App;
