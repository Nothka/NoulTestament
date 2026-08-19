/**
 * Normalises quotation marks in the content files.
 *
 * The text was extracted with two commas standing in for the Romanian opening
 * quote, and a handful of straight double quotes for the closing one. The
 * convention the text already follows for the majority of cases is `„` opening,
 * `”` closing, preceded by a space unless it follows a verse number.
 *
 * Only unambiguous cases are rewritten: `,,` counts as an opening quote when a
 * word follows it immediately. Anything else is reported for a human to decide.
 *
 * Run with --write to apply; without it, prints what it would change.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentRoot = resolve(__dirname, '..', 'public/content');
const write = process.argv.includes('--write');

let opened = 0;
let closed = 0;
const ambiguous = [];

function fixText(text, where) {
  let out = '';
  let index = 0;

  while (index < text.length) {
    if (text[index] !== ',' || text[index + 1] !== ',') {
      out += text[index];
      index += 1;
      continue;
    }

    // Three commas is a real comma followed by an opening quote, so emit the
    // comma and let the remaining pair be judged on its own.
    if (text[index + 2] === ',') {
      out += ',';
      index += 1;
      continue;
    }

    // Look past any stray spaces to decide whether this is an opening quote.
    let after = index + 2;
    let spaces = 0;

    while (text[after] === ' ') {
      after += 1;
      spaces += 1;
    }

    const next = text[after];
    const isOpening = Boolean(next) && (
      spaces === 0 ? /[\p{L}\p{N}]/u.test(next) : /\p{Lu}/u.test(next)
    );

    if (!isOpening) {
      ambiguous.push(`${where}: ...${text.slice(Math.max(0, index - 30), index + 24)}...`);
      out += ',,';
      index += 2;
      continue;
    }

    // A space belongs before the quote, unless it follows the verse number that
    // starts the block or an opening bracket.
    const previous = out[out.length - 1];
    const needsSpace = previous !== undefined && !/[\s\p{N}([]/u.test(previous);

    out += needsSpace ? ' „' : '„';
    opened += 1;
    index = after;
  }

  return out.replace(/"/gu, () => {
    closed += 1;
    return '”';
  });
}

function fixPassageLike(node, where) {
  for (const block of node.blocks ?? []) {
    block.text = fixText(block.text, where);
  }

  for (const note of node.notes ?? []) {
    note.text = fixText(note.text, where);
  }

  if (typeof node.title === 'string') {
    node.title = fixText(node.title, where);
  }
}

const files = [
  resolve(contentRoot, 'introduction.json'),
  ...readdirSync(resolve(contentRoot, 'books')).filter((f) => f.endsWith('.json'))
    .map((f) => resolve(contentRoot, 'books', f)),
];

for (const file of files) {
  const name = file.split('/').slice(-1)[0];
  const data = JSON.parse(readFileSync(file, 'utf-8'));

  if (data.passages) {
    for (const passage of data.passages) {
      fixPassageLike(passage, `${name} → ${passage.id}`);
    }
  } else {
    fixPassageLike(data, name);
  }

  if (write) {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }
}

console.log(`${write ? 'Applied' : 'Would apply'}: ${opened} opening quotes (,, → „), ${closed} closing quotes (" → ”)`);

if (ambiguous.length > 0) {
  console.log(`\n${ambiguous.length} left for manual review (a double comma not followed by a word):`);
  for (const item of ambiguous) {
    console.log(`  - ${item}`);
  }
}
