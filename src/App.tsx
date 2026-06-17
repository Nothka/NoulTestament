import { Fragment, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import './App.css';

const TESTAMENT_DATA_URL = '/testament.json';
const CONTENT_BOOKS_INDEX_URL = '/content/books-index.json';
const CONTENT_INTRODUCTION_URL = '/content/introduction.json';
const defaultSectionId = 'introduction';
const fallbackBookId = 'matei';

type ContentBlock = {
  type: 'heading' | 'paragraph' | 'verse';
  text: string;
  noteRefs?: number[];
};

type Footnote = {
  number: number;
  text: string;
};

type Passage = {
  id: string;
  number: number;
  reference: string;
  title: string;
  pageNumber?: number;
  blocks: ContentBlock[];
  notes?: Footnote[];
};

type PagePassage = {
  id: string;
  passageId: string;
  bookId: string;
  number: number;
  reference: string;
  title: string;
  isContinuation: boolean;
  blocks: ContentBlock[];
};

type BookPage = {
  number: number;
  passages: PagePassage[];
  notes: Footnote[];
};

type VisualBookPage = {
  number: number;
  columns: [PagePassage[], PagePassage[]];
  notes: Footnote[];
};

type Book = {
  id: string;
  navTitle: string;
  title: string;
  pages?: BookPage[];
  passages: Passage[];
};

type IntroductionPage = {
  number: number;
  blocks: ContentBlock[];
};

type Introduction = {
  id: string;
  title: string;
  subtitle: string;
  pages?: IntroductionPage[];
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

  function selectBook(bookId: string) {
    setSelectedSectionId(bookId);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  function selectIntroduction() {
    setSelectedSectionId(data?.introduction ? defaultSectionId : data?.books[0]?.id ?? fallbackBookId);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
    <main className="app">
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

async function loadTestamentData() {
  try {
    return await loadEditableContentData();
  } catch {
    return loadLegacyTestamentData();
  }
}

async function loadEditableContentData(): Promise<TestamentData> {
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

async function loadLegacyTestamentData() {
  return fetchJson<TestamentData>(TESTAMENT_DATA_URL);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Nu am putut încărca ${url}`);
  }

  return response.json() as Promise<T>;
}

function IntroductionPages({ introduction }: { introduction: Introduction }) {
  const pages = introduction.pages?.length
    ? introduction.pages
    : [{ number: 1, blocks: introduction.blocks }];

  return (
    <div className="introduction-stack">
      {pages.map((page, pageIndex) => (
        <article className="document-page introduction-page" key={`introduction-${page.number}`}>
          {pageIndex === 0 ? <h3>{introduction.subtitle}</h3> : null}
          <div className="introduction-body">
            {page.blocks.map((block, index) => (
              <ContentBlockView block={block} key={`introduction-${page.number}-${index}`} />
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
        isContinuation: !isFirstSegment,
        blocks: segment.blocks,
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
          isContinuation: !isFirstSegment,
          blocks: segment.blocks,
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
    title.textContent = passage.title;
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
  const noteWeight = (block.noteRefs?.length ?? 0) * 90;

  if (passage.id === 'matei-1' && block.type !== 'heading') {
    return splitGenealogyText(block.text).length * 115 + noteWeight + 16;
  }

  return block.text.length + headingWeight + noteWeight + 24;
}

function addNotesForBlocks(page: VisualBookPage, passage: Passage, blocks: ContentBlock[]) {
  if (!passage.notes?.length) {
    return;
  }

  const noteNumbers = new Set(blocks.flatMap((block) => block.noteRefs ?? []));
  const existingNoteNumbers = new Set(page.notes.map((note) => note.number));

  for (const note of passage.notes) {
    if (noteNumbers.has(note.number) && !existingNoteNumbers.has(note.number)) {
      page.notes.push(note);
      existingNoteNumbers.add(note.number);
    }
  }
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
          <h3>{passage.title}</h3>
        </header>
      ) : null}

      <div className="passage-body">
        <PassageBlocks blocks={passage.blocks} passageId={passage.passageId} />
      </div>
    </article>
  );
}

function PassageBlocks({ blocks, passageId }: { blocks: ContentBlock[]; passageId: string }) {
  if (passageId === 'matei-1') {
    return <GenealogyBlocks blocks={blocks} passageId={passageId} />;
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
            <InlineBlock block={block} key={`${passageId}-${index}-${blockIndex}`} />
          ))}
        </p>
      );
    }

    return (
      <h4 className="inline-heading" key={`${passageId}-heading-${index}`}>
        {renderTextWithNotes(group.text, group.noteRefs)}
      </h4>
    );
  });
}

function InlineBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'verse') {
    const match = block.text.match(/^(\d{1,3})(.*)$/u);

    if (match) {
      return (
        <span className="verse-fragment">
          <sup>{match[1]}</sup>
          {renderTextWithNotes(match[2].trimStart(), block.noteRefs)}
        </span>
      );
    }
  }

  return (
    <span className="text-fragment">
      {renderTextWithNotes(block.text, block.noteRefs)}
    </span>
  );
}

function GenealogyBlocks({ blocks, passageId }: { blocks: ContentBlock[]; passageId: string }) {
  return (
    <div className="genealogy-lines">
      {blocks.flatMap((block, blockIndex) => {
        if (block.type === 'heading') {
          return [
            <h4 className="inline-heading" key={`${passageId}-${blockIndex}`}>
              {renderTextWithNotes(block.text, block.noteRefs)}
            </h4>,
          ];
        }

        const lines = splitGenealogyText(block.text);

        return lines.map((line, lineIndex) => (
          <p className="genealogy-line" key={`${passageId}-${blockIndex}-${lineIndex}`}>
            {lineIndex === 0 ? (
              <GenealogyLine text={line} noteRefs={block.noteRefs} />
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

function PassageNotes({ notes }: { notes: Footnote[] }) {
  return (
    <footer className="passage-notes" aria-label="Note de subsol">
      <ol>
        {notes.map((note) => (
          <li key={note.number} value={note.number}>
            {renderInlineMarkup(note.text)}
          </li>
        ))}
      </ol>
    </footer>
  );
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === 'heading') {
    return <h4 className="inline-heading">{renderTextWithNotes(block.text, block.noteRefs)}</h4>;
  }

  if (block.type === 'verse') {
    const match = block.text.match(/^(\d{1,3})(.*)$/u);

    if (match) {
      return (
        <p className="verse-line">
          <sup>{match[1]}</sup>
          {renderTextWithNotes(match[2].trimStart(), block.noteRefs)}
        </p>
      );
    }
  }

  return <p className="text-line">{renderTextWithNotes(block.text, block.noteRefs)}</p>;
}

function renderTextWithNotes(text: string, noteRefs: number[] = []) {
  const nodes: ReactNode[] = [];
  let noteIndex = 0;
  let textStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (!isFootnoteMarker(text, index)) {
      continue;
    }

    nodes.push(...renderInlineMarkup(text.slice(textStart, index), `text-${index}`));

    const noteNumber = noteRefs[noteIndex];
    noteIndex += 1;
    nodes.push(
      <sup
        aria-label={noteNumber ? `Nota ${noteNumber}` : undefined}
        className="note-callout"
        key={`note-${index}-${noteIndex}`}
        title={noteNumber ? `Nota ${noteNumber}` : undefined}
      >
        *
      </sup>,
    );
    textStart = index + 1;
  }

  nodes.push(...renderInlineMarkup(text.slice(textStart), `text-end-${text.length}`));

  return nodes;
}

function isFootnoteMarker(text: string, index: number) {
  return text[index] === '*' && text[index - 1] !== '*' && text[index + 1] !== '*';
}

function renderInlineMarkup(text: string, keyPrefix = 'inline'): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|_([^_]+)_|\n)/gu;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (match[0] === '\n') {
      nodes.push(<br key={`${keyPrefix}-br-${matchIndex}`} />);
    } else if (match[2] || match[3]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${matchIndex}`}>{match[2] ?? match[3]}</strong>);
    } else if (match[4]) {
      nodes.push(<em key={`${keyPrefix}-em-${matchIndex}`}>{match[4]}</em>);
    }

    lastIndex = index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.map((node, index) => (
    <Fragment key={`${keyPrefix}-${index}`}>{node}</Fragment>
  ));
}

export default App;
