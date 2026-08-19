import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countFootnoteMarkers } from '../src/footnote-markers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const contentRoot = resolve(projectRoot, 'public/content');
const booksRoot = resolve(contentRoot, 'books');

const problems = [];

function report(location, message) {
  problems.push(`${location}: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    report(path.replace(`${projectRoot}/`, ''), `fișierul nu este JSON valid (${error.message}).`);
    return null;
  }
}

function validatePassage(location, passage) {
  if (!passage.id) {
    report(location, 'pasajul nu are ID. Câmpul ID nu trebuie șters.');
  }

  const blocks = Array.isArray(passage.blocks) ? passage.blocks : [];
  const notes = Array.isArray(passage.notes) ? passage.notes : [];

  for (const block of blocks) {
    if (block.type === 'verse' && !/^\d/u.test(block.text ?? '')) {
      report(
        location,
        `un verset nu începe cu numărul lui: "${(block.text ?? '').slice(0, 45)}...". `
        + 'Numărul versetului este prima cifră din text și nu trebuie șters.',
      );
    }
  }

  const markerCount = blocks.reduce((total, block) => total + countFootnoteMarkers(block.text ?? ''), 0);

  if (markerCount !== notes.length) {
    report(
      location,
      `sunt ${markerCount} semne * în text, dar ${notes.length} note de subsol. `
      + 'Fiecare notă trebuie să aibă exact un semn * în text.',
    );
  }
}

const index = readJson(resolve(contentRoot, 'books-index.json'));
const introduction = readJson(resolve(contentRoot, 'introduction.json'));

if (introduction) {
  validatePassage('introduction.json', { id: introduction.id, blocks: introduction.blocks, notes: [] });
}

const indexIds = new Set(Array.isArray(index) ? index.map((entry) => entry.id) : []);
const bookFiles = readdirSync(booksRoot).filter((file) => file.endsWith('.json'));

for (const file of bookFiles) {
  const book = readJson(resolve(booksRoot, file));

  if (!book) {
    continue;
  }

  if (!indexIds.has(book.id)) {
    report(`books/${file}`, `ID-ul cărții ("${book.id}") nu se potrivește cu books-index.json.`);
  }

  const seen = new Set();

  for (const passage of book.passages ?? []) {
    if (seen.has(passage.id)) {
      report(`books/${file}`, `ID de pasaj duplicat: "${passage.id}".`);
    }

    seen.add(passage.id);
    validatePassage(`books/${file} → pasajul ${passage.number ?? '?'} (${passage.id})`, passage);
  }
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
