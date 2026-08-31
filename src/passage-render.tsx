import { countFootnoteMarkers } from './footnote-markers.js';
import { renderTextWithNotes, trimVerseTextStart } from './markup';

/**
 * The rendering logic in this file is the single source of truth for how a
 * passage's blocks turn into the page a reader sees — verses flowing
 * together into shared paragraphs, alignment applying to the whole flowed
 * run rather than one block at a time, and Matei 1's genealogy splitting its
 * own lines. Both the live reading page and the passage editor's preview
 * pane render through these exact functions, so the preview can never drift
 * from what actually gets published — a mismatch there previously made
 * "Margini egale" look nothing like the real page once several verses
 * flowed together.
 */

export type ContentBlock = {
  type: 'heading' | 'paragraph' | 'verse';
  text: string;
  noteRefs?: number[];
  /** Font size as a percentage of the normal size, set from edit mode. */
  size?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Extra space above and below, in rem. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** A reversible deletion used for empty introduction rows. */
  hidden?: boolean;
  /**
   * Free position, set by dragging in layout mode. X is a share of the
   * element's own width and Y is in rem, so a position chosen on a wide screen
   * still holds on a narrow one. The element keeps its place in the flow, so
   * moving one thing never shuffles everything below it.
   */
  offsetX?: number;
  offsetY?: number;
};

export type Footnote = {
  number: number;
  text: string;
  size?: number;
  offsetX?: number;
  offsetY?: number;
};

export function blockAddress(passageId: string, allBlocks: ContentBlock[], block: ContentBlock) {
  const index = allBlocks.indexOf(block);

  return index >= 0 ? `block:${passageId}:${index}` : undefined;
}

/** Inline style carrying a per-element font scale, or nothing when unset. */
function sizeStyle(size?: number) {
  return size && size !== 100
    ? ({ '--size-scale': String(size / 100) } as React.CSSProperties)
    : undefined;
}

/**
 * A free position, as set by dragging in layout mode.
 *
 * Relative positioning rather than a transform, because a transform does
 * nothing at all to an inline element, and verses and paragraphs in the reader
 * are inline fragments sharing a paragraph. Relative offsets move the element
 * visually while leaving its place in the flow alone, so a verse still wraps
 * across lines and nothing around it shifts.
 */
function offsetStyle(layout: { offsetX?: number; offsetY?: number }): React.CSSProperties {
  if (!layout.offsetX && !layout.offsetY) {
    return {};
  }

  return {
    position: 'relative',
    left: `${layout.offsetX ?? 0}%`,
    top: `${layout.offsetY ?? 0}rem`,
  };
}

/** Scale plus position, for the inline fragments that carry no other layout. */
export function fragmentStyle(layout: { size?: number; offsetX?: number; offsetY?: number }) {
  const style = { ...sizeStyle(layout.size), ...offsetStyle(layout) };

  return Object.keys(style).length > 0 ? style : undefined;
}

/** Font scale, alignment, spacing and free position for a block-level box. */
export function blockStyle(layout: {
  size?: number;
  align?: ContentBlock['align'];
  spaceBefore?: number;
  spaceAfter?: number;
  offsetX?: number;
  offsetY?: number;
}) {
  const style: React.CSSProperties = { ...sizeStyle(layout.size) };

  if (layout.align) {
    style.textAlign = layout.align;
  }

  if (layout.spaceBefore !== undefined) {
    style.marginTop = `${layout.spaceBefore}rem`;
  }

  if (layout.spaceAfter !== undefined) {
    style.marginBottom = `${layout.spaceAfter}rem`;
  }

  Object.assign(style, offsetStyle(layout));

  return Object.keys(style).length > 0 ? style : undefined;
}

export function getResolvedNoteRefsForBlock(
  block: ContentBlock,
  allBlocks: ContentBlock[],
  notes: Footnote[] = [],
) {
  const markerCount = countFootnoteMarkers(block.text);

  if (markerCount === 0) {
    return [];
  }

  if (notes.length > 0) {
    const blockIndex = allBlocks.indexOf(block);
    const previousBlocks = blockIndex >= 0 ? allBlocks.slice(0, blockIndex) : [];
    const previousMarkerCount = previousBlocks.reduce(
      (total, currentBlock) => total + countFootnoteMarkers(currentBlock.text),
      0,
    );

    return notes
      .slice(previousMarkerCount, previousMarkerCount + markerCount)
      .map((note) => note.number);
  }

  return (block.noteRefs ?? []).slice(0, markerCount);
}

export function PassageBlocks({
  blocks,
  passageId,
  allBlocks = blocks,
  notes = [],
  editable = true,
}: {
  blocks: ContentBlock[];
  passageId: string;
  allBlocks?: ContentBlock[];
  notes?: Footnote[];
  /**
   * Whether the rendered text is the page itself, and so carries the
   * `data-edit` addresses edit mode hangs its click targets and hover
   * highlight off. An editor's own preview passes `false`: it shows how the
   * text will look, and nothing in it is clickable, so lighting up under the
   * pointer would only promise an edit that cannot happen there.
   */
  editable?: boolean;
}) {
  if (passageId === 'matei-1') {
    return (
      <GenealogyBlocks
        blocks={blocks}
        passageId={passageId}
        allBlocks={allBlocks}
        notes={notes}
        editable={editable}
      />
    );
  }

  const addressFor = (block: ContentBlock) => (editable ? blockAddress(passageId, allBlocks, block) : undefined);

  const groupedBlocks = groupPassageBlocks(blocks);

  return groupedBlocks.map((group, index) => {
    if (Array.isArray(group)) {
      return (
        <p
          className="passage-paragraph"
          key={`${passageId}-paragraph-${index}`}
          style={blockStyle(paragraphLayoutForBlocks(
            group,
            allBlocks,
            textContinuesAfterGroup(group, index, groupedBlocks, allBlocks),
          ))}
        >
          {group.map((block, blockIndex) => (
            <InlineBlock
              address={addressFor(block)}
              block={block}
              noteRefs={getResolvedNoteRefsForBlock(block, allBlocks, notes)}
              key={`${passageId}-${index}-${blockIndex}`}
            />
          ))}
        </p>
      );
    }

    return (
      <h4
        className="inline-heading"
        data-edit={addressFor(group)}
        key={`${passageId}-heading-${index}`}
        style={blockStyle(group)}
      >
        {renderTextWithNotes(group.text, getResolvedNoteRefsForBlock(group, allBlocks, notes))}
      </h4>
    );
  });
}

/**
 * Normal verses flow together. Explicit spacing creates a paragraph boundary
 * so it has a real margin box; alignment is handled at the whole-run level.
 */
export function groupPassageBlocks(blocks: ContentBlock[]): Array<ContentBlock | ContentBlock[]> {
  const groups: Array<ContentBlock | ContentBlock[]> = [];
  let textGroup: ContentBlock[] = [];

  const flushText = () => {
    if (textGroup.length > 0) {
      groups.push(textGroup);
      textGroup = [];
    }
  };

  for (const block of blocks) {
    if (block.hidden) {
      continue;
    }

    if (block.type === 'heading') {
      flushText();
      groups.push(block);
      continue;
    }

    if (textGroup.length > 0 && block.spaceBefore !== undefined) {
      flushText();
    }

    textGroup.push(block);

    if (block.spaceAfter !== undefined) {
      flushText();
    }
  }

  flushText();

  return groups;
}

export function paragraphLayoutForBlocks(
  blocks: ContentBlock[],
  allBlocks: ContentBlock[],
  continues: boolean,
) {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];

  return {
    align: first ? effectiveParagraphAlign(allBlocks, allBlocks.indexOf(first)) : undefined,
    spaceBefore: first?.spaceBefore,
    // Synthetic groups should not inherit .7rem between them. Only a chosen
    // space-after, or the true end of the paragraph, gets a bottom gap.
    spaceAfter: last?.spaceAfter ?? (continues ? 0 : undefined),
  };
}

export function textContinuesAfterGroup(
  group: ContentBlock[],
  groupIndex: number,
  groups: Array<ContentBlock | ContentBlock[]>,
  allBlocks: ContentBlock[],
) {
  if (Array.isArray(groups[groupIndex + 1])) {
    return true;
  }

  const lastIndex = allBlocks.indexOf(group[group.length - 1]);

  for (let index = lastIndex + 1; index < allBlocks.length; index += 1) {
    const block = allBlocks[index];

    if (block.type === 'heading') {
      return false;
    }

    if (!block.hidden) {
      return true;
    }
  }

  return false;
}

export function textRunBounds(blocks: ContentBlock[], index: number): [number, number] {
  if (index < 0 || index >= blocks.length || blocks[index]?.type === 'heading') {
    return [index, index];
  }

  let start = index;
  let end = index;

  while (start > 0 && blocks[start - 1]?.type !== 'heading') {
    start -= 1;
  }

  while (end < blocks.length - 1 && blocks[end + 1]?.type !== 'heading') {
    end += 1;
  }

  return [start, end];
}

export function effectiveParagraphAlign(blocks: ContentBlock[], index: number): ContentBlock['align'] {
  const [start, end] = textRunBounds(blocks, index);

  for (let position = start; position <= end; position += 1) {
    if (blocks[position]?.align) {
      return blocks[position].align;
    }
  }

  return undefined;
}

function InlineBlock({ block, noteRefs, address }: { block: ContentBlock; noteRefs?: number[]; address?: string }) {
  if (block.type === 'verse') {
    const match = block.text.match(/^(\d{1,3})(.*)$/su);

    if (match) {
      return (
        <span className="verse-fragment" data-edit={address} style={fragmentStyle(block)}>
          <sup>{match[1]}</sup>
          {renderTextWithNotes(trimVerseTextStart(match[2]), noteRefs)}
        </span>
      );
    }
  }

  return (
    <span
      aria-label={block.text.trim() ? undefined : 'Rând gol — apasă pentru a-l modifica'}
      className={`text-fragment${block.text.trim() ? '' : ' empty-text-fragment'}${block.hidden ? ' hidden-text-fragment' : ''}`}
      data-edit={address}
      style={fragmentStyle(block)}
    >
      {renderTextWithNotes(block.text, noteRefs)}
    </span>
  );
}

export function GenealogyBlocks({
  blocks,
  passageId,
  allBlocks = blocks,
  notes = [],
  editable = true,
}: {
  blocks: ContentBlock[];
  passageId: string;
  allBlocks?: ContentBlock[];
  notes?: Footnote[];
  editable?: boolean;
}) {
  const addressFor = (block: ContentBlock) => (editable ? blockAddress(passageId, allBlocks, block) : undefined);

  return (
    <div className="genealogy-lines">
      {blocks.flatMap((block, blockIndex) => {
        if (block.hidden) {
          return [];
        }

        if (block.type === 'heading') {
          return [
            <h4
              className="inline-heading"
              data-edit={addressFor(block)}
              key={`${passageId}-${blockIndex}`}
              style={blockStyle(block)}
            >
              {renderTextWithNotes(block.text, getResolvedNoteRefsForBlock(block, allBlocks, notes))}
            </h4>,
          ];
        }

        const lines = splitGenealogyText(block.text);

        return lines.map((line, lineIndex) => (
          <p
            className="genealogy-line"
            data-edit={addressFor(block)}
            key={`${passageId}-${blockIndex}-${lineIndex}`}
            style={genealogyLineStyle(block, allBlocks, lineIndex, lines.length)}
          >
            {lineIndex === 0 ? (
              <GenealogyLine text={line} noteRefs={getResolvedNoteRefsForBlock(block, allBlocks, notes)} />
            ) : (
              <GenealogyLine text={line} />
            )}
          </p>
        ));
      })}
    </div>
  );
}

export function genealogyLineLayout(
  block: ContentBlock,
  allBlocks: ContentBlock[],
  lineIndex: number,
  lineCount: number,
) {
  return {
    ...block,
    align: effectiveParagraphAlign(allBlocks, allBlocks.indexOf(block)),
    // One stored verse can produce several genealogy lines. Its gap belongs
    // around the verse, not around every semicolon clause.
    spaceBefore: lineIndex === 0 ? block.spaceBefore : undefined,
    spaceAfter: lineIndex === lineCount - 1 ? block.spaceAfter : undefined,
  };
}

function genealogyLineStyle(
  block: ContentBlock,
  allBlocks: ContentBlock[],
  lineIndex: number,
  lineCount: number,
) {
  const layout = genealogyLineLayout(block, allBlocks, lineIndex, lineCount);
  const style = blockStyle(layout) ?? {};

  if (layout.align === 'justify') {
    style.textAlignLast = 'justify';
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function GenealogyLine({ noteRefs = [], text }: { noteRefs?: number[]; text: string }) {
  const match = text.match(/^(\d{1,3})(.*)$/su);

  if (!match) {
    return renderTextWithNotes(text, noteRefs);
  }

  return (
    <>
      <sup>{match[1]}</sup>
      {renderTextWithNotes(trimVerseTextStart(match[2]), noteRefs)}
    </>
  );
}

export function splitGenealogyText(text: string) {
  // Keep leading/interior newlines: the editor uses two of them for one blank
  // row. Splitting on `;\s*` used to consume the exact break the customer had
  // inserted between two genealogy clauses.
  const normalizedText = text.trimEnd();
  const verseMatch = normalizedText.match(/^(\d{1,3})(.*)$/su);

  if (!verseMatch) {
    return splitAtSemicolons(normalizedText);
  }

  const [, verseNumber, verseText] = verseMatch;
  const parts = splitAtSemicolons(verseText);

  if (parts.length === 0) {
    return [normalizedText];
  }

  return parts.map((part, index) => (index === 0 ? `${verseNumber}${part}` : part));
}

function splitAtSemicolons(text: string) {
  return text
    .split(';')
    .map((line, index, lines) => {
      const content = index === 0 ? line : genealogyContinuationStart(line);

      return index < lines.length - 1 ? `${content};` : content;
    })
    .filter((line) => line.replace(/;$/u, '').trim().length > 0);
}

/**
 * A semicolon already starts the next genealogy clause on a new rendered line.
 * Therefore the first typed newline represents that normal break; only further
 * newlines become visibly blank rows.
 */
function genealogyContinuationStart(text: string) {
  const leading = text.match(/^[\t ]*((?:\r?\n[\t ]*)+)/u);

  if (!leading) {
    return trimVerseTextStart(text);
  }

  const newlineCount = leading[1].match(/\r?\n/gu)?.length ?? 0;

  return `${'\n'.repeat(Math.max(0, newlineCount - 1))}${text.slice(leading[0].length)}`;
}
