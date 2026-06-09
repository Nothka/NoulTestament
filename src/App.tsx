import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

type Passage = {
  id: string;
  number: number;
  reference: string;
  title: string;
  paragraphs: string[];
  notes?: Footnote[];
};

type Footnote = {
  id: string;
  number: number;
  text: string;
};

type Book = {
  id: string;
  title: string;
  passages: Passage[];
};

type Testament = {
  title: string;
  subtitle: string;
  edition: string;
  intro: {
    title: string;
    heading: string;
    paragraphs: string[];
  };
  books: Book[];
  stats: {
    books: number;
    passages: number;
    paragraphs: number;
    notes?: number;
  };
};

type ReaderLocation = {
  bookId: string;
  passageId: string;
};

type SearchResult = {
  book: Book;
  passage: Passage;
  excerpt: string;
};

type ChapterTarget = {
  book: Book;
  chapter: string;
  passage: Passage;
};

type VerseSegment = {
  number: string;
  text: string;
};

type PassageBlock =
  | {
      type: 'heading';
      text: string;
    }
  | {
      type: 'text';
      text: string;
    };

type NoteCursor = {
  index: number;
};

const DATA_URL = '/noul-testament.json';

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ro-RO');
}

function getInitialLocation(data: Testament): ReaderLocation {
  const [bookId, passageId] = decodeURIComponent(window.location.hash.replace(/^#/, '')).split('/');
  const book = data.books.find((item) => item.id === bookId) ?? data.books[0];
  const passage = book.passages.find((item) => item.id === passageId) ?? book.passages[0];

  return {
    bookId: book.id,
    passageId: passage.id,
  };
}

function getExcerpt(text: string, query: string) {
  const compactText = text.replace(/\s+/g, ' ').trim();
  const normalizedText = normalizeSearch(compactText);
  const normalizedQuery = normalizeSearch(query);
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  const start = matchIndex > 80 ? matchIndex - 80 : 0;
  const excerpt = compactText.slice(start, start + 220);

  return `${start > 0 ? '...' : ''}${excerpt}${compactText.length > start + 220 ? '...' : ''}`;
}

function getNormalizedTextMapping(text: string) {
  const mapping: number[] = [];
  const normalized: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const base = char
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('ro-RO');

    if (!base) {
      continue;
    }

    for (let i = 0; i < base.length; i += 1) {
      normalized.push(base[i]);
      mapping.push(index);
    }
  }

  return { normalized: normalized.join(''), mapping };
}

function highlightQuery(text: string, query: string) {
  const normalizedQuery = normalizeSearch(query.trim());

  if (normalizedQuery.length < 2) {
    return [text];
  }

  const { normalized, mapping } = getNormalizedTextMapping(text);
  const parts: ReactNode[] = [];
  let currentPosition = 0;
  let searchIndex = normalized.indexOf(normalizedQuery);
  let matchIndex = 0;

  while (searchIndex !== -1) {
    const startIndex = mapping[searchIndex];
    const endIndex = mapping[searchIndex + normalizedQuery.length - 1] + 1;

    if (currentPosition < startIndex) {
      parts.push(text.slice(currentPosition, startIndex));
    }

    parts.push(
      <mark className="search-result-highlight" key={`highlight-${matchIndex}`}>
        {text.slice(startIndex, endIndex)}
      </mark>,
    );

    currentPosition = endIndex;
    matchIndex += 1;
    searchIndex = normalized.indexOf(normalizedQuery, searchIndex + normalizedQuery.length);
  }

  if (currentPosition < text.length) {
    parts.push(text.slice(currentPosition));
  }

  return parts;
}

function getReferenceChapter(reference: string) {
  return reference.match(/^\d+/)?.[0] ?? '1';
}

function getReferenceVerse(reference: string) {
  return Number(reference.split(':')[1] ?? '1');
}

function getBookChapters(book: Book) {
  return book.passages.reduce<Array<{ chapter: string; passages: Passage[] }>>((chapters, passage) => {
    const chapter = getReferenceChapter(passage.reference);
    const existingChapter = chapters.find((item) => item.chapter === chapter);

    if (existingChapter) {
      existingChapter.passages.push(passage);
    } else {
      chapters.push({ chapter, passages: [passage] });
    }

    return chapters;
  }, []);
}

function scrollPageToTop() {
  window.scrollTo({ top: 0, left: 0 });
}

function isSectionHeading(paragraph: string) {
  const text = paragraph.replace(/\n/g, ' ').trim();

  return text.length > 0 && text.length <= 90 && !/^\d/.test(text) && !/[.!?;,]$/.test(text);
}

function getTextLines(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderIntroLead(heading: string) {
  const [title, ...paragraphs] = getTextLines(heading);

  return (
    <>
      {title ? <h2>{title}</h2> : null}
      {paragraphs.map((paragraph, index) => (
        <p className="intro-paragraph" key={`${paragraph}-${index}`}>
          {paragraph}
        </p>
      ))}
    </>
  );
}

function renderIntroSection(section: string, sectionIndex: number) {
  const [title, ...paragraphs] = getTextLines(section);

  return (
    <section className="intro-section" key={`${title}-${sectionIndex}`}>
      {title ? <h3>{title}</h3> : null}
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p className="intro-paragraph" key={`${paragraph}-${paragraphIndex}`}>
          {paragraph}
        </p>
      ))}
    </section>
  );
}

function splitVerses(paragraph: string) {
  const versePattern =
    /(^|[\n.!?;:,„”"'’`‘´)\]])\s*(\d{1,3})\s*\.?\s*(?=[A-Za-zĂÂÎȘȚŞŢăâîșțşţ„"',(])/gu;
  const verses: VerseSegment[] = [];
  let leadingText = '';
  let currentNumber = '';
  let currentTextStart = 0;
  let match: RegExpExecArray | null;

  while ((match = versePattern.exec(paragraph)) !== null) {
    const [fullMatch, prefix, verseNumber] = match;
    const prefixIndex = match.index;
    const numberIndex = prefixIndex + prefix.length;

    if (currentNumber) {
      verses.push({
        number: currentNumber,
        text: paragraph.slice(currentTextStart, numberIndex).trim(),
      });
    } else {
      leadingText = paragraph.slice(0, numberIndex).trim();
    }

    currentNumber = verseNumber;
    currentTextStart = prefixIndex + fullMatch.length;
  }

  if (currentNumber) {
    verses.push({
      number: currentNumber,
      text: paragraph.slice(currentTextStart).trim(),
    });
  }

  return {
    leadingText,
    verses,
  };
}

function getFirstVerseNumber(paragraphs: string[]) {
  for (const paragraph of paragraphs) {
    const blocks = getPassageBlocks(paragraph);
    const textBlock = blocks.find((block) => block.type === 'text');

    if (!textBlock) {
      continue;
    }

    const firstVerse = splitVerses(textBlock.text).verses[0];
    const firstVerseNumber = Number(firstVerse?.number);

    if (Number.isFinite(firstVerseNumber)) {
      return firstVerseNumber;
    }
  }

  return 1;
}

function getPassageVerseShift(passage: Passage) {
  const referenceVerse = getReferenceVerse(passage.reference);
  const firstVerseNumber = getFirstVerseNumber(passage.paragraphs);

  return referenceVerse > 1 && firstVerseNumber > 0 && firstVerseNumber < referenceVerse
    ? referenceVerse - firstVerseNumber
    : 0;
}

function getPassageBlocks(paragraph: string): PassageBlock[] {
  const lines = paragraph
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [{ type: 'text', text: paragraph }];
  }

  const blocks: PassageBlock[] = [];
  const textLines: string[] = [];

  function flushText() {
    if (textLines.length > 0) {
      blocks.push({ type: 'text', text: textLines.join(' ') });
      textLines.length = 0;
    }
  }

  lines.forEach((line) => {
    if (isSectionHeading(line)) {
      flushText();
      blocks.push({ type: 'heading', text: line });
    } else {
      textLines.push(line);
    }
  });

  flushText();

  return blocks;
}

function renderTextWithNotes(text: string, notes: Footnote[], noteCursor?: NoteCursor): ReactNode {
  if (!noteCursor || notes.length === 0 || !text.includes('*')) {
    return text;
  }

  const parts: ReactNode[] = [];
  let start = 0;
  let markerIndex = 0;

  for (const match of text.matchAll(/\*/g)) {
    const index = match.index ?? 0;
    const note = notes[noteCursor.index];

    if (start < index) {
      parts.push(text.slice(start, index));
    }

    if (note) {
      const noteNumber = noteCursor.index + 1;

      parts.push(
        <button
          type="button"
          className="note-callout"
          key={`note-callout-${note.id}-${markerIndex}`}
          onClick={() => scrollToFootnote(note.id)}
          aria-label={`Mergi la nota explicativă ${noteNumber}`}
        >
          {noteNumber}
        </button>,
      );
    } else {
      parts.push('*');
    }

    noteCursor.index += 1;
    markerIndex += 1;
    start = index + 1;
  }

  if (start < text.length) {
    parts.push(text.slice(start));
  }

  return parts;
}

function getFootnoteElementId(noteId: string) {
  return `chapter-note-${noteId}`;
}

function scrollToFootnote(noteId: string) {
  const noteElement = document.getElementById(getFootnoteElementId(noteId));

  if (!noteElement) {
    return;
  }

  noteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  noteElement.focus({ preventScroll: true });
}

function getFootnoteExplanation(text: string) {
  return text
    .replace(/^\s*(?:versetul\s+\d+\s*|[1-9]\d{0,2}:\d{1,3}\s*)/iu, '')
    .trim();
}

function renderChapterNotes(notes: Footnote[]) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <aside className="chapter-notes" aria-label="Note explicative">
      <h3 className="chapter-notes-title">Note explicative</h3>
      <ol>
        {notes.map((note) => (
          <li id={getFootnoteElementId(note.id)} key={note.id} tabIndex={-1}>
            <p>{getFootnoteExplanation(note.text)}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function renderVerseBlock(paragraph: string, verseShift = 0, notes: Footnote[] = [], noteCursor?: NoteCursor): ReactNode {
  const { leadingText, verses } = splitVerses(paragraph);

  if (verses.length === 0) {
    return <p className="passage-paragraph">{renderTextWithNotes(paragraph, notes, noteCursor)}</p>;
  }

  const displayedVerses =
    verseShift > 0
      ? verses.map((verse) => ({
          ...verse,
          number: String(Number(verse.number) + verseShift),
        }))
      : verses;

  return (
    <div className="verse-group">
      {leadingText ? <p className="inline-section-heading">{leadingText}</p> : null}
      {displayedVerses.map((verse, index) => (
        <p className="verse-line" key={`${verse.number}-${index}`}>
          <span className="verse-number" aria-label={`versetul ${verse.number}`}>
            {verse.number}
          </span>
          <span className="verse-text">{renderTextWithNotes(verse.text, notes, noteCursor)}</span>
        </p>
      ))}
    </div>
  );
}

function renderPassageParagraph(paragraph: string, verseShift = 0, notes: Footnote[] = [], noteCursor?: NoteCursor): ReactNode {
  const blocks = getPassageBlocks(paragraph);

  if (blocks.length === 1 && blocks[0].type === 'text') {
    return renderVerseBlock(blocks[0].text, verseShift, notes, noteCursor);
  }

  return (
    <div className="passage-blocks">
      {blocks.map((block, index) =>
        block.type === 'heading' ? (
          <p className="inline-section-heading" key={`${block.text}-${index}`}>
            {block.text}
          </p>
        ) : (
          <div className="passage-text-block" key={`${block.text}-${index}`}>
            {renderVerseBlock(block.text, verseShift, notes, noteCursor)}
          </div>
        ),
      )}
    </div>
  );
}

function App() {
  const [data, setData] = useState<Testament | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'intro' | 'reader'>('intro');
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [query, setQuery] = useState('');
  const [readerScale, setReaderScale] = useState(1);
  const [openChapterBookId, setOpenChapterBookId] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const previousViewRef = useRef(view);

  useEffect(() => {
    let isMounted = true;

    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Datele nu au putut fi încărcate.');
        }

        return response.json() as Promise<Testament>;
      })
      .then((testament) => {
        if (!isMounted) {
          return;
        }

        setData(testament);
        setLocation(getInitialLocation(testament));
        setView(window.location.hash && window.location.hash !== '#intro' ? 'reader' : 'intro');
      })
      .catch(() => {
        if (isMounted) {
          setError('Nu am putut încărca textul. Verifică fișierul public/noul-testament.json.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const activeBook = useMemo(() => {
    if (!data || !location) {
      return null;
    }

    return data.books.find((book) => book.id === location.bookId) ?? data.books[0];
  }, [data, location]);

  const activePassage = useMemo(() => {
    if (!activeBook || !location) {
      return null;
    }

    return activeBook.passages.find((passage) => passage.id === location.passageId) ?? activeBook.passages[0];
  }, [activeBook, location]);

  const allPassages = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.books.flatMap((book) => book.passages.map((passage) => ({ book, passage })));
  }, [data]);

  const allChapters = useMemo<ChapterTarget[]>(() => {
    if (!data) {
      return [];
    }

    return data.books.flatMap((book) =>
      getBookChapters(book).flatMap((chapter) => {
        const firstPassage = chapter.passages[0];

        return firstPassage ? [{ book, chapter: chapter.chapter, passage: firstPassage }] : [];
      }),
    );
  }, [data]);

  const currentIndex = useMemo(() => {
    if (!activePassage) {
      return -1;
    }

    return allPassages.findIndex(({ passage }) => passage.id === activePassage.id);
  }, [activePassage, allPassages]);

  const activeChapter = activePassage ? getReferenceChapter(activePassage.reference) : '';

  const activeChapterIndex = useMemo(() => {
    if (!activeBook || !activeChapter) {
      return -1;
    }

    return allChapters.findIndex(
      (chapter) => chapter.book.id === activeBook.id && chapter.chapter === activeChapter,
    );
  }, [activeBook, activeChapter, allChapters]);

  const bookChapters = useMemo(() => {
    if (!activeBook) {
      return [];
    }

    return getBookChapters(activeBook);
  }, [activeBook]);

  const activeChapterPassages = useMemo(() => {
    return bookChapters.find((chapter) => chapter.chapter === activeChapter)?.passages ?? activeBook?.passages ?? [];
  }, [activeBook, activeChapter, bookChapters]);

  const activeChapterNotes = useMemo(() => {
    return activeChapterPassages.flatMap((passage) => passage.notes ?? []);
  }, [activeChapterPassages]);

  const searchResults = useMemo<SearchResult[]>(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return [];
    }

    const normalizedQuery = normalizeSearch(trimmedQuery);

    return allPassages
      .filter(({ book, passage }) => {
        const searchableText = normalizeSearch(
          `${book.title} ${passage.title} ${passage.reference} ${passage.paragraphs.join(' ')}`,
        );

        return searchableText.includes(normalizedQuery);
      })
      .slice(0, 24)
      .map(({ book, passage }) => ({
        book,
        passage,
        excerpt: getExcerpt(`${passage.title} ${passage.paragraphs.join(' ')}`, trimmedQuery),
      }));
  }, [allPassages, query]);

  useEffect(() => {
    if (!data || !location) {
      return;
    }

    const hash = view === 'intro' ? '#intro' : `#${location.bookId}/${location.passageId}`;

    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, [data, location, view]);

  useEffect(() => {
    if (previousViewRef.current !== view) {
      previousViewRef.current = view;
      scrollPageToTop();
      return;
    }

    scrollPageToTop();
    articleRef.current?.scrollIntoView({ block: 'start' });
  }, [location, view]);

  function selectBook(book: Book) {
    setView('reader');
    setOpenChapterBookId((currentBookId) => (currentBookId === book.id ? null : book.id));
    setLocation((currentLocation) =>
      currentLocation?.bookId === book.id
        ? currentLocation
        : {
            bookId: book.id,
            passageId: book.passages[0].id,
          },
    );
  }

  function selectPassage(book: Book, passage: Passage) {
    setView('reader');
    setOpenChapterBookId(null);
    setLocation({
      bookId: book.id,
      passageId: passage.id,
    });
  }

  function selectChapter(book: Book, chapter: string) {
    const targetChapter = getBookChapters(book).find((item) => item.chapter === chapter);
    const firstPassage = targetChapter?.passages[0];

    if (firstPassage) {
      selectPassage(book, firstPassage);
    }
  }

  function goToOffset(offset: number) {
    const target = allPassages[currentIndex + offset];

    if (target) {
      selectPassage(target.book, target.passage);
    }
  }

  function goToChapterOffset(offset: number) {
    const target = allChapters[activeChapterIndex + offset];

    if (target) {
      selectPassage(target.book, target.passage);
    }
  }

  if (error) {
    return (
      <main className="app app-state">
        <p>{error}</p>
      </main>
    );
  }

  if (!data || !location || !activeBook || !activePassage) {
    return (
      <main className="app app-state">
        <p>Se încarcă textul...</p>
      </main>
    );
  }

  const chapterNoteCursor = { index: 0 };

  return (
    <main className="app" style={{ '--reader-scale': readerScale } as CSSProperties}>
      <header className="site-header">
        <div>
          <p className="kicker">{data.edition}</p>
          <h1>{data.title}</h1>
          <p>{data.subtitle}</p>
        </div>
        <div className="header-actions" aria-label="Navigare principală">
          <button
            className={view === 'intro' ? 'solid-button' : 'ghost-button'}
            onClick={() => {
              setOpenChapterBookId(null);
              setView('intro');
              scrollPageToTop();
            }}
          >
            Introducere
          </button>
          <button
            className={view === 'reader' ? 'solid-button' : 'ghost-button'}
            onClick={() => {
              setView('reader');
              scrollPageToTop();
            }}
          >
            Text
          </button>
        </div>
      </header>

      <button
        className="back-to-top-button"
        onClick={scrollPageToTop}
        title="Înapoi sus"
        aria-label="Înapoi sus"
      >
        ↑
      </button>

      <div className="workspace">
        <aside className="sidebar" aria-label="Navigare pe cărți și pasaje">
          <label className="search-field">
            <span>Caută</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setOpenChapterBookId(null);
                setQuery(event.target.value);
              }}
              placeholder="cuvânt, titlu sau referință"
            />
          </label>

          {query.trim().length >= 2 ? (
            <div className="search-results">
              <p className="panel-label">{searchResults.length} rezultate</p>
              {searchResults.map((result) => (
                <button
                  className="result-button"
                  key={`${result.book.id}-${result.passage.id}`}
                  onClick={() => selectPassage(result.book, result.passage)}
                >
                  <strong>{result.passage.title}</strong>
                  <span>
                    {result.book.title} · {result.passage.reference}
                  </span>
                  <small>{highlightQuery(result.excerpt, query)}</small>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="book-list">
                <p className="panel-label">{data.stats.books} cărți</p>

                <div
                  className={openChapterBookId ? 'book-scroll has-open-chapter' : 'book-scroll'}
                  aria-label="Cărți"
                >
                  {data.books.map((book) => {
                    const isActiveBook = book.id === activeBook.id && view === 'reader';
                    const bookChapterGroups = getBookChapters(book);
                    const isBookChapterOpen = openChapterBookId === book.id && view === 'reader';
                    const bookActiveChapter = isActiveBook
                      ? activeChapter
                      : getReferenceChapter(book.passages[0]?.reference ?? '1');

                    return (
                      <div
                        className={[
                          'book-row',
                          isActiveBook ? 'active' : '',
                          isBookChapterOpen ? 'open' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={book.id}
                      >
                        <button
                          className="book-button"
                          aria-expanded={isBookChapterOpen}
                          onClick={() => selectBook(book)}
                        >
                          <span>{book.title}</span>
                          <small>{book.passages.length} pasaje · {bookChapterGroups.length} capitole</small>
                        </button>

                        {isBookChapterOpen ? (
                          <div className="chapter-popover book-chapter-popover">
                            <div className="chapter-list">
                              {bookChapterGroups.map((chapter) => (
                                <button
                                  className={
                                    chapter.chapter === bookActiveChapter ? 'chapter-option active' : 'chapter-option'
                                  }
                                  aria-current={chapter.chapter === bookActiveChapter ? 'true' : undefined}
                                  key={chapter.chapter}
                                  onClick={() => selectChapter(book, chapter.chapter)}
                                >
                                  {chapter.chapter}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

            </>
          )}
        </aside>

        <section className="reader-shell">
          {view === 'reader' ? (
            <>
              <button
                className="page-turn-zone previous"
                disabled={activeChapterIndex <= 0}
                onClick={() => goToChapterOffset(-1)}
                aria-label="Capitolul anterior"
                title="Capitolul anterior"
              >
                <span>‹</span>
              </button>
              <button
                className="page-turn-zone next"
                disabled={activeChapterIndex === -1 || activeChapterIndex >= allChapters.length - 1}
                onClick={() => goToChapterOffset(1)}
                aria-label="Capitolul următor"
                title="Capitolul următor"
              >
                <span>›</span>
              </button>
            </>
          ) : null}

          <div className="reader-tools" aria-label="Controale de citire">
            <div>
              <span>{data.stats.passages} pasaje</span>
              <span>{data.stats.paragraphs} paragrafe</span>
            </div>
            <div className="scale-controls">
              <button onClick={() => setReaderScale((value) => Math.max(0.9, value - 0.05))}>A-</button>
              <button onClick={() => setReaderScale(1)}>A</button>
              <button onClick={() => setReaderScale((value) => Math.min(1.18, value + 0.05))}>A+</button>
            </div>
          </div>

          {view === 'intro' ? (
            <article className="intro-page" ref={articleRef}>
              <div className="intro-layout">
                <aside className="intro-aside" aria-label="Detalii introducere">
                  <strong>{data.edition}</strong>
                  <span>{data.stats.books} cărți</span>
                  <span>{data.stats.passages} pasaje</span>
                  <span>{data.stats.paragraphs} paragrafe</span>
                </aside>

                <div className="intro-content">
                  {renderIntroLead(data.intro.heading)}
                  {data.intro.paragraphs.map((paragraph, index) => renderIntroSection(paragraph, index))}
                </div>
              </div>
            </article>
          ) : (
            <article className="reader" ref={articleRef}>
              <div className="reader-heading">
                <p className="kicker">{activeBook.title}</p>
                <h2>Capitolul {activeChapter}</h2>
              </div>

              <div className="reader-chapter-passages">
                {activeChapterPassages.map((passage) => {
                  return (
                    <section
                      key={passage.id}
                      className={
                        passage.id === activePassage.id ? 'chapter-passage active' : 'chapter-passage'
                      }
                    >
                      <h3 className="passage-subtitle">{passage.title}</h3>
                      <div className="passage-text">
                        {passage.paragraphs.map((paragraph, index) =>
                          isSectionHeading(paragraph) ? (
                            <h4 key={`${passage.id}-${paragraph}-${index}`}>
                              {renderTextWithNotes(paragraph, activeChapterNotes, chapterNoteCursor)}
                            </h4>
                          ) : (
                            <div key={`${passage.id}-${paragraph}-${index}`}>
                              {renderPassageParagraph(
                                paragraph,
                                getPassageVerseShift(passage),
                                activeChapterNotes,
                                chapterNoteCursor,
                              )}
                            </div>
                          ),
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>

              {renderChapterNotes(activeChapterNotes)}

              <nav className="reader-nav" aria-label="Navigare între pasaje">
                <button className="ghost-button" disabled={currentIndex <= 0} onClick={() => goToOffset(-1)}>
                  Anterior
                </button>
                <button
                  className="ghost-button"
                  disabled={currentIndex === -1 || currentIndex >= allPassages.length - 1}
                  onClick={() => goToOffset(1)}
                >
                  Următor
                </button>
              </nav>
            </article>
          )}
        </section>
      </div>

    </main>
  );
}

export default App;
