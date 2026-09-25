/**
 * Structural edits to a passage: removing a block along with its footnotes.
 *
 * Footnotes are matched to text by position — a block owns the notes that fall
 * after every marker preceding it — so any change to block order or membership
 * has to carry the notes along with it, or every footnote after the change
 * points at the wrong explanation. These helpers keep the two in lockstep.
 *
 * All functions are pure and return a new passage.
 */

import { countFootnoteMarkers } from './footnote-markers.js';
import { noteIndexAt } from './footnote-numbering.js';

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
 * Joins a block into the one above it — how a fragment that was split off its
 * verse during the original conversion is put back where it belongs. Both
 * blocks' footnotes travel with the merged text, in the order they were
 * already in, so every callout keeps pointing at its own explanation.
 */
export function mergeBlockIntoPrevious(passage, index) {
  const blocks = [...(passage.blocks ?? [])];

  if (index <= 0 || index >= blocks.length) {
    return passage;
  }

  const groups = notesByBlock(blocks, passage.notes ?? []);
  const previous = blocks[index - 1];
  const current = blocks[index];

  blocks[index - 1] = {
    ...previous,
    text: `${(previous.text ?? '').replace(/\s+$/u, '')} ${(current.text ?? '').replace(/^\s+/u, '')}`,
    noteRefs: [...(previous.noteRefs ?? []), ...(current.noteRefs ?? [])],
  };
  groups[index - 1] = [...groups[index - 1], ...groups[index]];

  blocks.splice(index, 1);
  groups.splice(index, 1);

  return withNotes(passage, blocks, groups);
}

/**
 * Adds a footnote marker inside a block and its explanation to the passage, at
 * the position the marker falls in. The note's *number* is not set here: it is
 * a property of the whole New Testament's reading order, so the caller runs
 * the global renumber afterwards.
 */
export function insertNote(passage, index, offset, text) {
  const blocks = [...(passage.blocks ?? [])];
  const block = blocks[index];

  if (!block) {
    return passage;
  }

  const body = block.text ?? '';
  const at = Math.max(0, Math.min(offset, body.length));

  blocks[index] = { ...block, text: `${body.slice(0, at)}*${body.slice(at)}` };

  const notes = [...(passage.notes ?? [])];
  const noteIndex = noteIndexAt(blocks, index, at + 1) - 1;

  notes.splice(Math.max(0, noteIndex), 0, { number: 0, text });

  return { ...passage, blocks, notes };
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
