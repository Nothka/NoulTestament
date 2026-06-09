import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const inputPath = process.argv[2] ?? '/Users/angelolucaci/Downloads/Noul Testament.docx';
const outputPath = resolve(projectRoot, 'public/noul-testament.json');

const bookDefinitions = [
  ['matei', 'Evanghelia după Matei', ['EVANGHELIA DUPĂ MATEI']],
  ['marcu', 'Evanghelia după Marcu', ['EVANGHELIA DUPĂ MARCU']],
  ['luca', 'Evanghelia după Luca', ['EVANGHELIA DUPĂ LUCA']],
  ['ioan', 'Evanghelia după Ioan', ['EVANGHELIA DUPĂ IOAN']],
  ['faptele-apostolilor', 'Faptele Apostolilor', ['FAPTELE APOSTOLILOR']],
  ['romani', 'Epistola către Romani', ['EPISTOLA CĂTRE ROMANI']],
  ['1-corinteni', 'Epistola 1 Corinteni', ['EPISTOLA 1 CORINTENI']],
  ['2-corinteni', 'Epistola 2 Corinteni', ['EPISTOLA 2 CORINTENI']],
  ['galateni', 'Epistola către Galateni', ['EPISTOLA CĂTRE GALATENI']],
  ['efeseni', 'Epistola către Efeseni', ['EPISTOLA CĂTRE EFESENI']],
  ['filipeni', 'Epistola către Filipeni', ['EPISTOLA CĂTRE FILIPENI']],
  ['coloseni', 'Epistola către Coloseni', ['EPISTOLA CĂTRE COLOSENI']],
  ['1-tesaloniceni', 'Epistola 1 Tesaloniceni', ['1 TESALONICENI', 'EPISTOLA 1 TESALONICENI']],
  ['2-tesaloniceni', 'Epistola 2 Tesaloniceni', ['2 TESALONICENI', 'EPISTOLA 2 TESALONICENI']],
  ['1-timotei', 'Epistola 1 Timotei', ['EPISTOLA 1 TIMOTEI']],
  ['2-timotei', 'Epistola 2 Timotei', ['EPISTOLA 2 TIMOTEI']],
  ['tit', 'Epistola către Tit', ['EPISTOLA CĂTRE TIT']],
  ['filimon', 'Epistola către Filimon', ['EPISTOLA CĂTRE FILIMON']],
  ['evrei', 'Epistola către Evrei', ['EPISTOLA CĂTRE EVREI']],
  ['iacov', 'Epistola lui Iacov', ['EPISTOLA LUI IACOV']],
  ['1-petru', 'Epistola 1 Petru', ['EPISTOLA 1 PETRU']],
  ['2-petru', 'Epistola 2 Petru', ['EPISTOLA 2 PETRU']],
  ['1-ioan', 'Epistola 1 Ioan', ['EPISTOLA 1 IOAN']],
  ['2-ioan', 'Epistola 2 Ioan', ['EPISTOLA 2 IOAN']],
  ['3-ioan', 'Epistola 3 Ioan', ['EPISTOLA 3 IOAN']],
  ['iuda', 'Epistola lui Iuda', ['EPISTOLA LUI IUDA']],
  ['apocalipsa', 'Apocalipsa lui Ioan', ['APOCALIPSA LUI IOAN']],
].map(([id, title, markers]) => ({
  id,
  title,
  markers: markers.map(canonical),
}));

function canonical(value) {
  return value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function cleanLine(value) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function cleanParagraph(value) {
  return value
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function startsVerseText(line) {
  return /^\d{1,3}\s*\.?\s*(?=[A-Za-zĂÂÎȘȚŞŢăâîșțşţ„"',(])/.test(cleanLine(line));
}

function isVerseContinuationParagraph(paragraph) {
  return /^[a-zăâîșțşţ]/.test(cleanLine(paragraph));
}

function mergeVerseContinuations(paragraphs) {
  return paragraphs.reduce((merged, paragraph) => {
    if (merged.length > 0 && isVerseContinuationParagraph(paragraph)) {
      merged[merged.length - 1] = cleanParagraph(`${merged[merged.length - 1]} ${paragraph}`);
    } else {
      merged.push(paragraph);
    }

    return merged;
  }, []);
}

function splitParagraphs(lines, options = {}) {
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  const paragraphs = text
    .split(/\n{2,}/)
    .map(cleanParagraph)
    .filter(Boolean);

  return options.mergeVerseContinuations ? mergeVerseContinuations(paragraphs) : paragraphs;
}

function isLikelyTitleContinuation(line) {
  const text = cleanLine(line);
  return text.length > 0 && text.length <= 80 && /^[a-zăâîșțşţ]/.test(text);
}

function findBookMarkers(lines) {
  const markers = [];

  lines.forEach((line, index) => {
    const normalized = canonical(line);
    const definition = bookDefinitions.find((book) => book.markers.includes(normalized));

    if (definition) {
      markers.push({ ...definition, line: index });
    }
  });

  return markers;
}

function parsePassageHeader(lines, index) {
  const line = cleanLine(lines[index]);
  const oneLine = line.match(/^(\d{1,3})\s*\(([^)]+)\)\s*(.*)$/);

  if (oneLine) {
    return {
      number: Number(oneLine[1]),
      reference: oneLine[2],
      inlineTitle: cleanLine(oneLine[3]),
      start: index,
      end: index,
    };
  }

  const numberOnly = line.match(/^(\d{1,3})$/);
  const nextLine = cleanLine(lines[index + 1] ?? '');
  const referenceOnly = nextLine.match(/^\(([^)]+)\)$/);

  if (numberOnly && referenceOnly) {
    return {
      number: Number(numberOnly[1]),
      reference: referenceOnly[1],
      inlineTitle: '',
      start: index,
      end: index + 1,
    };
  }

  return null;
}

function findPassageHeaders(lines) {
  const headers = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = parsePassageHeader(lines, index);

    if (header) {
      headers.push(header);
      index = header.end;
    }
  }

  return headers;
}

function extractTitle(lines, start, limit, inlineTitle, fallback) {
  if (inlineTitle) {
    return {
      title: inlineTitle,
      contentStart: start,
    };
  }

  let index = start;

  while (index < limit && !cleanLine(lines[index])) {
    index += 1;
  }

  const first = cleanLine(lines[index] ?? '');

  if (!first || startsVerseText(first) || first.length > 160) {
    return {
      title: fallback,
      contentStart: index,
    };
  }

  const titleParts = [first];
  index += 1;

  while (index < limit && isLikelyTitleContinuation(lines[index])) {
    titleParts.push(cleanLine(lines[index]));
    index += 1;
  }

  return {
    title: titleParts.join(' '),
    contentStart: index,
  };
}

function parseBook(book, lines) {
  const headers = findPassageHeaders(lines);

  if (headers.length === 0) {
    const { title, contentStart } = extractTitle(lines, 0, lines.length, '', book.title);

    return {
      id: book.id,
      title: book.title,
      passages: [
        {
          id: `${book.id}-1`,
          number: 1,
          reference: '1:1',
          title,
          paragraphs: splitParagraphs(lines.slice(contentStart), { mergeVerseContinuations: true }),
        },
      ],
    };
  }

  const passages = headers.map((header, index) => {
    const next = headers[index + 1];
    const limit = next ? next.start : lines.length;
    const fallback = `Pasajul ${header.number}`;
    const { title, contentStart } = extractTitle(
      lines,
      header.end + 1,
      limit,
      header.inlineTitle,
      fallback,
    );
    const paragraphs = splitParagraphs(lines.slice(contentStart, limit), { mergeVerseContinuations: true });

    return {
      id: `${book.id}-${header.number}`,
      number: header.number,
      reference: header.reference,
      title,
      paragraphs,
    };
  });

  return {
    id: book.id,
    title: book.title,
    passages,
  };
}

function parseIntroduction(lines) {
  const introIndex = lines.findIndex((line) => canonical(line) === 'INTRODUCERE');
  const contentsIndex = lines.findIndex((line) => canonical(line) === 'CUPRINS');

  if (introIndex === -1 || contentsIndex === -1 || contentsIndex <= introIndex) {
    return {
      title: 'Introducere',
      paragraphs: [],
    };
  }

  const introLines = lines.slice(introIndex + 1, contentsIndex);
  const paragraphs = splitParagraphs(introLines);
  const [heading, ...body] = paragraphs;

  return {
    title: 'Introducere',
    heading: heading ?? '',
    paragraphs: body,
  };
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readDocxXml(entryName, maxBuffer = 20 * 1024 * 1024) {
  return execFileSync('unzip', ['-p', inputPath, entryName], {
    encoding: 'utf8',
    maxBuffer,
  });
}

function extractXmlText(fragment) {
  const parts = [];
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let match;

  while ((match = tokenPattern.exec(fragment)) !== null) {
    if (match[1] !== undefined) {
      parts.push(decodeXml(match[1]));
    } else if (match[0].includes(':br')) {
      parts.push('\n');
    } else {
      parts.push(' ');
    }
  }

  return parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function parseFootnoteDefinitions(xml) {
  const notes = new Map();
  const footnotePattern = /<w:footnote\b[^>]*w:id="([^"]+)"[^>]*>([\s\S]*?)<\/w:footnote>/g;
  let match;

  while ((match = footnotePattern.exec(xml)) !== null) {
    const [, id, content] = match;
    const text = extractXmlText(content);

    if (text) {
      notes.set(id, text);
    }
  }

  return notes;
}

function parseFootnoteReferenceIds(xml) {
  return [...xml.matchAll(/<w:footnoteReference\b[^>]*w:id="([^"]+)"/g)].map((match) => match[1]);
}

function extractFootnotes() {
  try {
    const footnotesXml = readDocxXml('word/footnotes.xml', 10 * 1024 * 1024);
    const documentXml = readDocxXml('word/document.xml', 50 * 1024 * 1024);
    const footnoteDefinitions = parseFootnoteDefinitions(footnotesXml);

    return parseFootnoteReferenceIds(documentXml).map((id, index) => ({
      id,
      number: index + 1,
      text: footnoteDefinitions.get(id) ?? '',
    }));
  } catch (error) {
    console.warn(`Nu am putut extrage notele de subsol: ${error.message}`);
    return [];
  }
}

function countFootnoteMarkers(value) {
  return (value.match(/\*/g) ?? []).length;
}

function attachPassageNotes(books, notes) {
  let noteIndex = 0;

  const booksWithNotes = books.map((book) => ({
    ...book,
    passages: book.passages.map((passage) => {
      const markerCount = passage.paragraphs.reduce(
        (count, paragraph) => count + countFootnoteMarkers(paragraph),
        0,
      );

      if (markerCount === 0) {
        return passage;
      }

      const passageNotes = notes.slice(noteIndex, noteIndex + markerCount).filter((note) => note.text);
      noteIndex += markerCount;

      return {
        ...passage,
        notes: passageNotes,
      };
    }),
  }));

  if (notes.length > 0 && noteIndex !== notes.length) {
    console.warn(`Note asignate: ${noteIndex}/${notes.length}. Verifica marcajele * din document.`);
  }

  return booksWithNotes;
}

const rawText = execFileSync('textutil', ['-convert', 'txt', '-stdout', inputPath], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

const lines = rawText
  .replace(/\r\n?/g, '\n')
  .replace(/\u2028/g, '\n')
  .replace(/\u00ad/g, '')
  .split('\n');

const bookMarkers = findBookMarkers(lines);

if (bookMarkers.length !== bookDefinitions.length) {
  const found = new Set(bookMarkers.map((marker) => marker.id));
  const missing = bookDefinitions
    .filter((book) => !found.has(book.id))
    .map((book) => book.title);

  throw new Error(`Nu am gasit toate cartile. Lipsesc: ${missing.join(', ')}`);
}

const booksWithoutNotes = bookMarkers.map((book, index) => {
  const nextBook = bookMarkers[index + 1];
  const bookLines = lines.slice(book.line + 1, nextBook ? nextBook.line : lines.length);
  return parseBook(book, bookLines);
});

const notes = extractFootnotes();
const books = attachPassageNotes(booksWithoutNotes, notes);

const passageCount = books.reduce((count, book) => count + book.passages.length, 0);
const paragraphCount = books.reduce(
  (bookTotal, book) =>
    bookTotal +
    book.passages.reduce((passageTotal, passage) => passageTotal + passage.paragraphs.length, 0),
  0,
);

const testament = {
  title: 'Noul Testament',
  subtitle: 'al Domnului și Mântuitorului nostru Isus Cristos',
  edition: 'O nouă divizare a textului',
  source: 'Noul Testament.docx',
  importedAt: new Date().toISOString(),
  intro: parseIntroduction(lines),
  books,
  stats: {
    books: books.length,
    passages: passageCount,
    paragraphs: paragraphCount,
    notes: notes.filter((note) => note.text).length,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(testament, null, 2)}\n`);

console.log(`Generated ${outputPath}`);
console.log(
  `${books.length} books, ${passageCount} passages, ${paragraphCount} paragraphs, ${testament.stats.notes} notes`,
);
