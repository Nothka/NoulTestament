import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const sourcePath = resolve(projectRoot, 'public/testament.json');
const contentRoot = resolve(projectRoot, 'public/content');
const booksRoot = resolve(contentRoot, 'books');

if (!existsSync(sourcePath)) {
  throw new Error(`Nu există fișierul sursă: ${sourcePath}`);
}

const data = JSON.parse(await BunFileOrNodeFile(sourcePath));

if (!Array.isArray(data.books)) {
  throw new Error('public/testament.json nu conține lista de cărți.');
}

rmSync(contentRoot, { force: true, recursive: true });
mkdirSync(booksRoot, { recursive: true });

writeJson(resolve(contentRoot, 'introduction.json'), sanitizeIntroduction(data.introduction));
writeJson(resolve(contentRoot, 'books-index.json'), data.books.map((book) => ({
  id: book.id,
  navTitle: book.navTitle,
  title: book.title,
  file: `${book.id}.json`,
})));

for (const book of data.books) {
  writeJson(resolve(booksRoot, `${book.id}.json`), sanitizeBook(book));
}

console.log(`Generated editable content in ${contentRoot}`);
console.log(`Books: ${data.books.length}`);

async function BunFileOrNodeFile(filePath) {
  if (globalThis.Bun) {
    return Bun.file(filePath).text();
  }

  const { readFile } = await import('node:fs/promises');

  return readFile(filePath, 'utf8');
}

function sanitizeIntroduction(introduction) {
  if (!introduction) {
    return null;
  }

  return {
    id: introduction.id,
    title: introduction.title,
    subtitle: introduction.subtitle,
    blocks: introduction.blocks ?? [],
  };
}

function sanitizeBook(book) {
  return {
    id: book.id,
    navTitle: book.navTitle,
    title: book.title,
    passages: (book.passages ?? []).map((passage) => ({
      id: passage.id,
      number: passage.number,
      reference: passage.reference ?? '',
      title: passage.title,
      ...(passage.titleStyle ? { titleStyle: passage.titleStyle } : {}),
      ...(passage.titleSize ? { titleSize: passage.titleSize } : {}),
      ...(passage.pageNumber ? { pageNumber: passage.pageNumber } : {}),
      blocks: passage.blocks ?? [],
      ...(passage.notes?.length ? { notes: passage.notes } : {}),
    })),
  };
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
