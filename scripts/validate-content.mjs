import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBookProblems, findIntroductionProblems } from '../src/content-validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const contentRoot = resolve(projectRoot, 'public/content');
const booksRoot = resolve(contentRoot, 'books');

const problems = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    problems.push(`${path.replace(`${projectRoot}/`, '')}: fișierul nu este JSON valid (${error.message}).`);
    return null;
  }
}

const index = readJson(resolve(contentRoot, 'books-index.json'));
const introduction = readJson(resolve(contentRoot, 'introduction.json'));

if (introduction) {
  problems.push(...findIntroductionProblems(introduction, 'introduction.json'));
}

const indexIds = new Set(Array.isArray(index) ? index.map((entry) => entry.id) : []);
const bookFiles = readdirSync(booksRoot).filter((file) => file.endsWith('.json'));

for (const file of bookFiles) {
  const book = readJson(resolve(booksRoot, file));

  if (!book) {
    continue;
  }

  if (!indexIds.has(book.id)) {
    problems.push(`books/${file}: ID-ul cărții ("${book.id}") nu se potrivește cu books-index.json.`);
  }

  problems.push(...findBookProblems(book, `books/${file}`));
}

if (problems.length > 0) {
  console.error(`\n✖ Textul are ${problems.length} problem${problems.length === 1 ? 'ă' : 'e'}:\n`);

  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }

  console.error('\nSite-ul NU a fost actualizat. Corectează problemele de mai sus și salvează din nou.\n');
  process.exit(1);
}

console.log(`✓ Textul este valid (${bookFiles.length} cărți verificate).`);
