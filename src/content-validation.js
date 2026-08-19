/**
 * Content invariants, shared by the build-time validator
 * (scripts/validate-content.mjs) and the save endpoint
 * (netlify/functions/save.mjs) so an editor gets the same answer either way.
 *
 * Messages are in Romanian because they are shown directly to the editor.
 */

import { countFootnoteMarkers } from './footnote-markers.js';

/**
 * @param {{ id?: string, number?: number, blocks?: Array<{ type: string, text: string }>, notes?: Array<unknown> }} passage
 * @param {string} location
 * @returns {string[]}
 */
export function findPassageProblems(passage, location) {
  const problems = [];
  const blocks = Array.isArray(passage.blocks) ? passage.blocks : [];
  const notes = Array.isArray(passage.notes) ? passage.notes : [];

  if (!passage.id) {
    problems.push(`${location}: pasajul nu are ID. Câmpul ID nu trebuie șters.`);
  }

  for (const block of blocks) {
    if (block.type === 'verse' && !/^\d/u.test(block.text ?? '')) {
      problems.push(
        `${location}: un verset nu începe cu numărul lui: "${(block.text ?? '').slice(0, 45)}...". `
        + 'Numărul versetului este prima cifră din text și nu trebuie șters.',
      );
    }
  }

  const markerCount = blocks.reduce((total, block) => total + countFootnoteMarkers(block.text ?? ''), 0);

  if (markerCount !== notes.length) {
    problems.push(
      `${location}: sunt ${markerCount} semne * în text, dar ${notes.length} note de subsol. `
      + 'Fiecare notă trebuie să aibă exact un semn * în text.',
    );
  }

  return problems;
}

/**
 * @param {{ id?: string, passages?: Array<any> }} book
 * @param {string} location
 * @returns {string[]}
 */
export function findBookProblems(book, location) {
  const problems = [];
  const seen = new Set();

  for (const passage of book.passages ?? []) {
    if (seen.has(passage.id)) {
      problems.push(`${location}: ID de pasaj duplicat: "${passage.id}".`);
    }

    seen.add(passage.id);
    problems.push(...findPassageProblems(passage, `${location} → pasajul ${passage.number ?? '?'} (${passage.id})`));
  }

  return problems;
}

/**
 * @param {{ id?: string, blocks?: Array<any> }} introduction
 * @param {string} location
 * @returns {string[]}
 */
export function findIntroductionProblems(introduction, location) {
  return findPassageProblems({ id: introduction.id, blocks: introduction.blocks, notes: [] }, location);
}
