import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const defaultInputPath = '/Users/angelolucaci/Downloads/Noul Testament_biblie_final_revizuit3_final.docx';
const inputPath = process.argv[2] ?? defaultInputPath;
const outputPath = resolve(projectRoot, 'public/testament.json');
const PAGE_BREAK_TOKEN = '[[PAGE_BREAK]]';

const books = [
  ['matei', 'Matei', 'Evanghelia după Matei', 'EVANGHELIA DUPĂ MATEI'],
  ['marcu', 'Marcu', 'Evanghelia după Marcu', 'EVANGHELIA DUPĂ MARCU'],
  ['luca', 'Luca', 'Evanghelia după Luca', 'EVANGHELIA DUPĂ LUCA'],
  ['ioan', 'Ioan', 'Evanghelia după Ioan', 'EVANGHELIA DUPĂ IOAN'],
  ['fapte', 'Fapte', 'Faptele Apostolilor', 'FAPTELE APOSTOLILOR'],
  ['romani', 'Romani', 'Epistola către Romani', 'EPISTOLA CĂTRE ROMANI'],
  ['1-corinteni', '1 Corinteni', 'Epistola 1 Corinteni', 'EPISTOLA 1 CORINTENI'],
  ['2-corinteni', '2 Corinteni', 'Epistola 2 Corinteni', 'EPISTOLA 2 CORINTENI'],
  ['galateni', 'Galateni', 'Epistola către Galateni', 'EPISTOLA CĂTRE GALATENI'],
  ['efeseni', 'Efeseni', 'Epistola către Efeseni', 'EPISTOLA CĂTRE EFESENI'],
  ['filipeni', 'Filipeni', 'Epistola către Filipeni', 'EPISTOLA CĂTRE FILIPENI'],
  ['coloseni', 'Coloseni', 'Epistola către Coloseni', 'EPISTOLA CĂTRE COLOSENI'],
  ['1-tesaloniceni', '1 Tesaloniceni', 'Epistola 1 Tesaloniceni', '1 TESALONICENI'],
  ['2-tesaloniceni', '2 Tesaloniceni', 'Epistola 2 Tesaloniceni', '2 TESALONICENI'],
  ['1-timotei', '1 Timotei', 'Epistola 1 Timotei', 'EPISTOLA 1 TIMOTEI'],
  ['2-timotei', '2 Timotei', 'Epistola 2 Timotei', 'EPISTOLA 2 TIMOTEI'],
  ['tit', 'Tit', 'Epistola către Tit', 'EPISTOLA CĂTRE TIT'],
  ['filimon', 'Filimon', 'Epistola către Filimon', 'EPISTOLA CĂTRE FILIMON'],
  ['evrei', 'Evrei', 'Epistola către Evrei', 'EPISTOLA CĂTRE EVREI'],
  ['iacov', 'Iacov', 'Epistola lui Iacov', 'EPISTOLA LUI IACOV'],
  ['1-petru', '1 Petru', 'Epistola 1 Petru', 'EPISTOLA 1 PETRU'],
  ['2-petru', '2 Petru', 'Epistola 2 Petru', 'EPISTOLA 2 PETRU'],
  ['1-ioan', '1 Ioan', 'Epistola 1 Ioan', 'EPISTOLA 1 IOAN'],
  ['2-ioan', '2 Ioan', 'Epistola 2 Ioan', 'EPISTOLA 2 IOAN'],
  ['3-ioan', '3 Ioan', 'Epistola 3 Ioan', 'EPISTOLA 3 IOAN'],
  ['iuda', 'Iuda', 'Epistola lui Iuda', 'EPISTOLA LUI IUDA'],
  ['apocalipsa', 'Apocalipsa', 'Apocalipsa lui Ioan', 'APOCALIPSA LUI IOAN'],
].map(([id, navTitle, title, marker]) => ({ id, navTitle, title, marker }));

if (!existsSync(inputPath)) {
  throw new Error(`Documentul sursă nu există: ${inputPath}`);
}

const rawText = extractDocumentText(inputPath);
const text = normalizeText(rawText);
const footnotes = extractFootnotes(inputPath);
let footnoteCursor = 0;
const ranges = findBookRanges(text);

const data = {
  source: inputPath,
  generatedAt: new Date().toISOString(),
  introduction: parseIntroduction(text.slice(0, ranges[0].markerStart)),
  books: ranges.map(({ book, start, end, startPage }) => parseBook(book, text.slice(start, end), startPage)),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Generated ${outputPath}`);
console.log(`Books: ${data.books.length}`);
console.log(`Passages: ${data.books.reduce((total, book) => total + book.passages.length, 0)}`);
console.log(`Footnotes: ${footnoteCursor}/${footnotes.length}`);

function normalizeText(value) {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function findBookRanges(documentText) {
  const matches = books.map((book) => {
    const marker = escapeRegExp(book.marker);
    const match = documentText.match(new RegExp(`(^|\\n)\\s*${marker}\\s*(?=\\n|$)`, 'u'));

    if (!match || match.index === undefined) {
      throw new Error(`Nu am găsit cartea: ${book.marker}`);
    }

    return {
      book,
      markerStart: match.index,
      start: match.index + match[0].length,
      startPage: pageNumberAt(documentText, match.index),
    };
  });

  return matches.map((match, index) => ({
    ...match,
    end: matches[index + 1]?.markerStart ?? documentText.length,
  }));
}

function parseIntroduction(sectionText) {
  const introMatch = sectionText.match(/(^|\n)\s*INTRODUCERE\s*(?=\n|$)/u);

  if (!introMatch || introMatch.index === undefined) {
    return null;
  }

  const cuprinsMatch = sectionText.match(/(^|\n)\s*CUPRINS\s*(?=\n|$)/u);
  const introStart = introMatch.index + introMatch[0].length;
  const introEnd = cuprinsMatch?.index ?? sectionText.length;
  const titleInfo = readTitle(sectionText, introStart, introEnd);
  const contentStart = titleInfo.end;
  const pages = splitPageSegments(sectionText.slice(contentStart, introEnd), pageNumberAt(sectionText, contentStart))
    .map((page) => ({
      number: page.number,
      blocks: parseIntroductionBlocks(page.text),
    }))
    .filter((page) => page.blocks.length > 0);

  return {
    id: 'introduction',
    title: 'Introducere',
    subtitle: titleInfo.title,
    blocks: pages.flatMap((page) => page.blocks),
    pages,
  };
}

function parseIntroductionBlocks(content) {
  return content
    .split('\n')
    .map(cleanLine)
    .filter((line) => line && line !== PAGE_BREAK_TOKEN)
    .map((line) => ({
      type: 'paragraph',
      text: line,
      noteRefs: [],
    }));
}

function parseBook(book, sectionText, startPage) {
  const headers = [...sectionText.matchAll(/^(\d{1,3})\s+\(([^)\n]+)\)?\s*$/gmu)];

  if (headers.length === 0) {
    const titleInfo = readTitle(sectionText, 0, sectionText.length);
    const contentStart = titleInfo.end;
    const pageSegments = splitPageSegments(sectionText.slice(contentStart), pageNumberAt(sectionText, contentStart, startPage));
    const pages = pageSegments
      .map((page) => {
        const content = parseBlocks(page.text);

        return {
          number: page.number,
          passages: [{
            id: `${book.id}-1-${page.number}`,
            passageId: `${book.id}-1`,
            number: 1,
            reference: '',
            title: titleInfo.title || book.title,
            isContinuation: page.index > 0,
            blocks: content.blocks,
          }],
          notes: content.notes,
        };
      })
      .filter((page) => page.passages.some((passage) => passage.blocks.length > 0) || page.notes.length > 0);
    const passageBlocks = pages.flatMap((page) => page.passages.flatMap((passage) => passage.blocks));
    const passageNotes = pages.flatMap((page) => page.notes);

    return {
      id: book.id,
      navTitle: book.navTitle,
      title: book.title,
      pages,
      passages: [
        {
          id: `${book.id}-1`,
          number: 1,
          reference: '',
          title: titleInfo.title || book.title,
          pageNumber: pages[0]?.number ?? startPage,
          blocks: passageBlocks,
          notes: passageNotes,
        },
      ],
    };
  }

  const pagesByNumber = new Map();
  const passages = headers.map((header, index) => {
    const nextHeader = headers[index + 1];
    const number = Number(header[1]);
    const reference = header[2].trim();
    const titleStart = header.index + header[0].length;
    const titleInfo = readTitle(sectionText, titleStart, nextHeader?.index ?? sectionText.length);
    const contentStart = titleInfo.end;
    const content = sectionText.slice(contentStart, nextHeader?.index ?? sectionText.length);
    const pageSegments = splitPageSegments(content, pageNumberAt(sectionText, contentStart, startPage));
    const passageBlocks = [];
    const passageNotes = [];

    for (const page of pageSegments) {
      const parsedContent = parseBlocks(page.text);

      if (parsedContent.blocks.length === 0 && parsedContent.notes.length === 0) {
        continue;
      }

      passageBlocks.push(...parsedContent.blocks);
      passageNotes.push(...parsedContent.notes);

      const pageData = getOrCreatePage(pagesByNumber, page.number);
      pageData.passages.push({
        id: `${book.id}-${number}-${page.number}-${page.index}`,
        passageId: `${book.id}-${number}`,
        number,
        reference,
        title: titleInfo.title || `Pasajul ${number}`,
        isContinuation: page.index > 0,
        blocks: parsedContent.blocks,
      });
      pageData.notes.push(...parsedContent.notes);
    }

    return {
      id: `${book.id}-${number}`,
      number,
      reference,
      title: titleInfo.title || `Pasajul ${number}`,
      pageNumber: pageSegments[0]?.number ?? pageNumberAt(sectionText, header.index, startPage),
      blocks: passageBlocks,
      notes: passageNotes,
    };
  });

  return {
    id: book.id,
    navTitle: book.navTitle,
    title: book.title,
    pages: [...pagesByNumber.values()].sort((first, second) => first.number - second.number),
    passages,
  };
}

function getOrCreatePage(pagesByNumber, pageNumber) {
  const existingPage = pagesByNumber.get(pageNumber);

  if (existingPage) {
    return existingPage;
  }

  const nextPage = {
    number: pageNumber,
    passages: [],
    notes: [],
  };

  pagesByNumber.set(pageNumber, nextPage);

  return nextPage;
}

function splitPageSegments(content, startPage) {
  return content.split(PAGE_BREAK_TOKEN).map((text, index) => ({
    index,
    number: startPage + index,
    text,
  }));
}

function pageNumberAt(documentText, index, basePage = 1) {
  return basePage + countPageBreaks(documentText.slice(0, index));
}

function countPageBreaks(value) {
  return value.split(PAGE_BREAK_TOKEN).length - 1;
}

function readTitle(sectionText, start, end) {
  const slice = sectionText.slice(start, end);
  const lines = slice.split('\n');
  let offset = start;

  for (const line of lines) {
    const cleaned = cleanLine(line);
    offset += line.length + 1;

    if (cleaned) {
      return {
        title: cleaned,
        end: offset,
      };
    }
  }

  return {
    title: '',
    end: start,
  };
}

function parseBlocks(content) {
  const blocks = [];
  const notes = [];
  const lines = content
    .split('\n')
    .map(cleanLine)
    .filter((line) => line && line !== PAGE_BREAK_TOKEN);

  for (const line of lines) {
    const lineWithNotes = attachFootnotes(line, notes);

    if (isInlineHeading(line)) {
      blocks.push({
        type: 'heading',
        text: lineWithNotes.text,
        noteRefs: lineWithNotes.noteRefs,
      });
      continue;
    }

    if (/^\d{1,3}\s*\S/u.test(line)) {
      blocks.push({
        type: 'verse',
        text: lineWithNotes.text,
        noteRefs: lineWithNotes.noteRefs,
      });
      continue;
    }

    const previous = blocks.at(-1);

    if (previous && previous.type !== 'heading') {
      previous.text = cleanLine(`${previous.text} ${lineWithNotes.text}`);
      previous.noteRefs.push(...lineWithNotes.noteRefs);
    } else {
      blocks.push({
        type: 'paragraph',
        text: lineWithNotes.text,
        noteRefs: lineWithNotes.noteRefs,
      });
    }
  }

  return { blocks, notes };
}

function attachFootnotes(line, notes) {
  const noteRefs = [];
  const text = line.replace(/\*/g, () => {
    const footnote = footnotes[footnoteCursor];

    if (!footnote) {
      return '*';
    }

    const number = footnoteCursor + 1;
    footnoteCursor += 1;
    noteRefs.push(number);
    notes.push({
      number,
      text: footnote.text,
    });

    return '*';
  });

  return { text, noteRefs };
}

function extractDocumentText(documentPath) {
  const documentXml = execFileSync('unzip', ['-p', documentPath, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 120 * 1024 * 1024,
  });

  return [...documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((paragraphMatch) => xmlParagraphToText(paragraphMatch[1]))
    .join('\n');
}

function xmlParagraphToText(paragraph) {
  let text = '';
  const tokenPattern = /(<w:lastRenderedPageBreak\b[^>]*\/?>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>)/g;

  for (const match of paragraph.matchAll(tokenPattern)) {
    const token = match[1];

    if (token.startsWith('<w:lastRenderedPageBreak')) {
      text += `\n${PAGE_BREAK_TOKEN}\n`;
      continue;
    }

    if (token.startsWith('<w:tab')) {
      text += '\t';
      continue;
    }

    if (token.startsWith('<w:br')) {
      text += token.includes('w:type="page"') ? `\n${PAGE_BREAK_TOKEN}\n` : '\n';
      continue;
    }

    if (match[2] !== undefined) {
      text += decodeXml(match[2]);
    }
  }

  return text;
}

function extractFootnotes(documentPath) {
  const documentXml = execFileSync('unzip', ['-p', documentPath, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
  });
  const footnotesXml = execFileSync('unzip', ['-p', documentPath, 'word/footnotes.xml'], {
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
  });
  const footnotesById = new Map();

  for (const match of footnotesXml.matchAll(/<w:footnote\b(?=[^>]*w:id="(-?\d+)")[^>]*>([\s\S]*?)<\/w:footnote>/g)) {
    const id = Number(match[1]);

    if (id < 2) {
      continue;
    }

    footnotesById.set(id, {
      id,
      text: cleanLine(xmlFragmentToText(match[2])),
    });
  }

  return [...documentXml.matchAll(/<w:footnoteReference\b[^>]*w:id="(-?\d+)"/g)]
    .map((match) => Number(match[1]))
    .map((id) => footnotesById.get(id))
    .filter(Boolean);
}

function xmlFragmentToText(fragment) {
  const paragraphs = [...fragment.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((paragraphMatch) => {
      const paragraph = paragraphMatch[1]
        .replace(/<w:tab\/>/g, ' ')
        .replace(/<w:br\/>/g, '\n');

      return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((textMatch) => decodeXml(textMatch[1]))
        .join('');
    })
    .map(cleanLine)
    .filter(Boolean);

  return paragraphs.join(' ');
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function isInlineHeading(line) {
  return (
    line.length <= 86
    && !/^\d/u.test(line)
    && !/^[a-zăâîșț]/u.test(line)
    && !/[.,;:!?„”"')\]]$/u.test(line)
  );
}

function cleanLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
