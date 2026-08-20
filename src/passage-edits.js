/**
 * Structural edits to a passage: moving, adding and removing blocks.
 *
 * Footnotes are matched to text by position — a block owns the notes that fall
 * after every marker preceding it — so any change to block order or membership
 * has to carry the notes along with it, or every footnote after the change
 * points at the wrong explanation. These helpers keep the two in lockstep.
 *
 * All functions are pure and return a new passage.
 */

import { countFootnoteMarkers } from './footnote-markers.js';

/**
 * Splits the passage's notes into one group per block, using the same
 * positional rule the reader uses.
 *
 * @param {Array<{ text?: string }>} blocks
 * @param {Array<{ number: number, text: string }>} notes
 */
export function notesByBlock(blocks, notes) {
  const groups = [];
  let cursor = 0;

  for (const block of blocks) {
    const count = countFootnoteMarkers(block.text ?? '');
    groups.push(notes.slice(cursor, cursor + count));
    cursor += count;
  }

  return groups;
}

/**
 * Reassigns the passage's existing note numbers in the new reading order, so
 * the callouts stay in ascending order and keep the range they already had.
 */
function renumber(nextNotes, originalNotes) {
  const numbers = originalNotes
    .map((note) => note.number)
    .sort((a, b) => a - b)
    .slice(0, nextNotes.length);

  return nextNotes.map((note, index) => ({ ...note, number: numbers[index] }));
}

function withNotes(passage, blocks, groups) {
  const notes = passage.notes ?? [];

  if (notes.length === 0) {
    return { ...passage, blocks };
  }

  return { ...passage, blocks, notes: renumber(groups.flat(), notes) };
}

/**
 * Moves a block one place earlier or later, taking its footnotes with it.
 *
 * @param {number} direction -1 to move earlier, 1 to move later
 */
export function moveBlock(passage, index, direction) {
  const blocks = [...(passage.blocks ?? [])];
  const target = index + direction;

  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return passage;
  }

  const groups = notesByBlock(blocks, passage.notes ?? []);

  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  [groups[index], groups[target]] = [groups[target], groups[index]];

  return withNotes(passage, blocks, groups);
}

/**
 * Inserts an empty block after the given one. Only headings and paragraphs can
 * be added: a verse has to start with its number, which is not something an
 * editor should have to invent.
 *
 * @param {'heading' | 'paragraph'} type
 */
export function insertBlock(passage, index, type) {
  const blocks = [...(passage.blocks ?? [])];
  blocks.splice(index + 1, 0, { type, text: '', noteRefs: [] });

  // A new block has no markers, so the notes are untouched.
  return { ...passage, blocks };
}

/** Removes a block along with any footnotes belonging to it. */
export function removeBlock(passage, index) {
  const blocks = [...(passage.blocks ?? [])];

  if (index < 0 || index >= blocks.length || blocks.length <= 1) {
    return passage;
  }

  const groups = notesByBlock(blocks, passage.notes ?? []);
  blocks.splice(index, 1);
  groups.splice(index, 1);

  return withNotes(passage, blocks, groups);
}
