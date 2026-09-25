/**
 * Footnote numbering for the whole New Testament.
 *
 * The callouts run 1..N straight through the text in reading order: books in
 * the order books-index.json lists them, then passages, then blocks, then the
 * markers inside one block. That ordinal is never stored as a fact anywhere —
 * it is recomputed from the text itself. So inserting a note in Matei
 * renumbers every note after it, in every later book, with no bookkeeping that
 * could quietly drift out of step with the markers.
 *
 * Kept as its own module, in plain JavaScript, so the reader, the editor and
 * the content validator all number notes the same way.
 */

import { countFootnoteMarkers, isFootnoteMarker } from './footnote-markers.js';

/**
 * How many footnote markers stand before a point in a passage — which is also
 * the position a note inserted at that point takes in `passage.notes`, since
 * notes are matched to markers by position and nothing else.
 *
 * @param {Array<{ text?: string }>} blocks
 * @param {number} blockIndex
 * @param {number} offset character offset inside that block's text
 */
export function noteIndexAt(blocks, blockIndex, offset) {
  let count = 0;

  for (let index = 0; index < blockIndex && index < blocks.length; index += 1) {
    count += countFootnoteMarkers(blocks[index].text ?? '');
  }

  const text = blocks[blockIndex]?.text ?? '';

  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    if (isFootnoteMarker(text, index)) {
      count += 1;
    }
  }

  return count;
}

/**
 * Restates each block's `noteRefs` from the passage's notes, so the numbers
 * cached on a block can never disagree with the notes they point at. The
 * reader prefers `notes` when a passage has them; this keeps the editor's
 * preview, which reads `noteRefs`, showing the same thing.
 *
 * @template {{ blocks?: Array<any>, notes?: Array<{ number: number }> }} P
 * @param {P} passage
 * @returns {P}
 */
export function rebuildNoteRefs(passage) {
  const notes = passage.notes ?? [];
  let cursor = 0;

  return {
    ...passage,
    blocks: (passage.blocks ?? []).map((block) => {
      const count = countFootnoteMarkers(block.text ?? '');
      const refs = notes.slice(cursor, cursor + count).map((note) => note.number);

      cursor += count;

      return { ...block, noteRefs: refs };
    }),
  };
}

/**
 * Renumbers every note of every book from 1, in reading order.
 *
 * Returns the books plus the ids of the ones that actually changed, because
 * only those files need to be written back — inserting a note near the end of
 * Apocalipsa should not mark all 27 books as edited.
 *
 * @template {{ id: string, passages?: Array<any> }} B
 * @param {B[]} books
 * @returns {{ books: B[], changedIds: string[] }}
 */
export function renumberAllNotes(books) {
  let next = 1;
  const changedIds = [];

  const renumbered = books.map((book) => {
    let bookChanged = false;

    const passages = (book.passages ?? []).map((passage) => {
      const notes = passage.notes;

      if (!notes || notes.length === 0) {
        return passage;
      }

      let passageChanged = false;

      const nextNotes = notes.map((note) => {
        const number = next;

        next += 1;

        if (note.number === number) {
          return note;
        }

        passageChanged = true;

        return { ...note, number };
      });

      if (!passageChanged) {
        return passage;
      }

      bookChanged = true;

      return rebuildNoteRefs({ ...passage, notes: nextNotes });
    });

    if (!bookChanged) {
      return book;
    }

    changedIds.push(book.id);

    return { ...book, passages };
  });

  return { books: renumbered, changedIds };
}

/**
 * The number a note inserted at a point would be given, for telling the editor
 * what is about to happen before it happens.
 *
 * @param {Array<{ id: string, passages?: Array<any> }>} books
 * @param {string} passageId
 * @param {number} noteIndex position the new note takes within its passage
 */
export function numberForInsertion(books, passageId, noteIndex) {
  let count = 0;

  for (const book of books) {
    for (const passage of book.passages ?? []) {
      if (passage.id === passageId) {
        return count + noteIndex + 1;
      }

      count += (passage.notes ?? []).length;
    }
  }

  return count + 1;
}
