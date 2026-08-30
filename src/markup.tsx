import { Fragment, type ReactNode } from 'react';

import { isFootnoteMarker } from './footnote-markers.js';

/**
 * Removes the ordinary separator after a protected verse number without
 * swallowing intentional line breaks placed at the start of the verse text.
 */
export function trimVerseTextStart(text: string) {
  return text.replace(/^[^\S\r\n]+/u, '');
}

/**
 * Renders block text the way the reader does: bold and italic markup resolved,
 * and each lone `*` turned into its numbered footnote callout. Shared with the
 * editor so its preview cannot drift from the page.
 */
export function renderTextWithNotes(text: string, noteRefs: number[] = []) {
  const nodes: ReactNode[] = [];
  let noteIndex = 0;
  let textStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (!isFootnoteMarker(text, index)) {
      continue;
    }

    nodes.push(...renderInlineMarkup(text.slice(textStart, index), `text-${index}`));

    const noteNumber = noteRefs[noteIndex];
    noteIndex += 1;
    nodes.push(
      <sup
        aria-label={noteNumber ? `Nota ${noteNumber}` : undefined}
        className="note-callout"
        key={`note-${index}-${noteIndex}`}
        title={noteNumber ? `Nota ${noteNumber}` : undefined}
      >
        {noteNumber ? `*${noteNumber}` : '*'}
      </sup>,
    );

    textStart = index + 1;
  }

  nodes.push(...renderInlineMarkup(text.slice(textStart), `text-end-${text.length}`));

  return nodes;
}

export function renderInlineMarkup(text: string, keyPrefix = 'inline'): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|__([^_]+)__|_([^_]+)_|\n)/gu;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (match[0] === '\n') {
      nodes.push(<br key={`${keyPrefix}-br-${matchIndex}`} />);
    } else if (match[2] || match[4]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${matchIndex}`}>
          {renderInlineMarkup(match[2] ?? match[4], `${keyPrefix}-strong-${matchIndex}`)}
        </strong>,
      );
    } else if (match[3] || match[5]) {
      nodes.push(
        <em key={`${keyPrefix}-em-${matchIndex}`}>
          {renderInlineMarkup(match[3] ?? match[5], `${keyPrefix}-em-${matchIndex}`)}
        </em>,
      );
    }

    lastIndex = index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.map((node, index) => (
    <Fragment key={`${keyPrefix}-${index}`}>{node}</Fragment>
  ));
}
