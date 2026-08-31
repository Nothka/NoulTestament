/**
 * The CMS at /admin commits public/content/*.json straight to GitHub, without
 * passing through netlify/functions/save.mjs, so the invariants in
 * src/content-validation.js never see those saves. Worse, Sveltia writes back
 * only the fields config.yml declares: a field the config forgets is silently
 * dropped from the JSON the next time an editor opens and saves that file.
 *
 * This check compares the fields declared in public/admin/config.yml against the
 * keys actually present in the content, and fails the build before an editor can
 * lose text that way. It only catches drift in that direction - a field the CMS
 * declares but the app never reads is not detectable from the content alone.
 *
 * Messages are in Romanian to match the rest of the validator output.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Field names declared anywhere under a `fields:` / `field:` key. Collection
 * names and the backend name sit outside that context and are not fields.
 *
 * @param {string} configText
 * @returns {Set<string>}
 */
export function declaredFields(configText) {
  const names = new Set();
  const openFieldLists = [];

  for (const line of configText.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.match(/^\s*/u)[0].length;

    while (openFieldLists.length > 0 && indent <= openFieldLists.at(-1)) {
      openFieldLists.pop();
    }

    if (openFieldLists.length > 0) {
      for (const match of line.matchAll(/\bname:\s*([A-Za-z0-9_]+)/gu)) {
        names.add(match[1]);
      }
    }

    if (/^\s*-?\s*(fields|field):/u.test(line)) {
      openFieldLists.push(indent);
    }
  }

  return names;
}

/**
 * Every object key in a content file, mapped to where it was first seen.
 *
 * @param {unknown} value
 * @param {string} path
 * @param {Map<string, string>} into
 * @returns {Map<string, string>}
 */
export function collectKeys(value, path, into = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, path, into);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (!into.has(key)) {
        into.set(key, path);
      }

      collectKeys(nested, `${path} → ${key}`, into);
    }
  }

  return into;
}

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function findCmsSchemaProblems(projectRoot) {
  const configPath = resolve(projectRoot, 'public/admin/config.yml');

  if (!existsSync(configPath)) {
    return ['public/admin/config.yml: fișierul lipsește, deci nu se poate verifica dacă CMS-ul păstrează toate câmpurile.'];
  }

  const configText = readFileSync(configPath, 'utf-8');
  const problems = [];

  // The CMS must still point at the content this validator checks.
  for (const [label, expected] of [['file', 'public/content/introduction.json'], ['folder', 'public/content/books']]) {
    if (!new RegExp(`^\\s*${label}:\\s*${expected}\\s*$`, 'mu').test(configText)) {
      problems.push(`public/admin/config.yml: nu mai trimite spre "${expected}", deci CMS-ul scrie în altă parte decât verifică build-ul.`);
    }
  }

  const declared = declaredFields(configText);
  const contentRoot = resolve(projectRoot, 'public/content');
  const booksRoot = resolve(contentRoot, 'books');
  const keys = new Map();

  // Unparseable files are skipped: validate-content.mjs already reports those,
  // and this check must not crash ahead of that message.
  const collectFile = (path, location) => {
    try {
      collectKeys(JSON.parse(readFileSync(path, 'utf-8')), location, keys);
    } catch {
      // reported by the caller
    }
  };

  collectFile(resolve(contentRoot, 'introduction.json'), 'introduction.json');

  for (const file of readdirSync(booksRoot).filter((name) => name.endsWith('.json'))) {
    collectFile(resolve(booksRoot, file), `books/${file}`);
  }

  for (const [key, where] of keys) {
    if (!declared.has(key)) {
      problems.push(
        `public/admin/config.yml: câmpul "${key}" (${where}) nu este declarat în CMS. `
        + 'Sveltia îl șterge din text la prima salvare din /admin - adaugă-l în config.yml.',
      );
    }
  }

  return problems;
}
