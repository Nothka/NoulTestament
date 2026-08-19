/**
 * Footnote marker detection, shared by the reader (src/App.tsx) and the content
 * validator (scripts/validate-content.mjs) so the two can never disagree about
 * how many notes a passage references.
 *
 * A footnote marker is a lone `*` that is not part of `*italic*` markup.
 */

/**
 * @param {string} text
 * @param {number} index
 */
export function isSingleAsterisk(text, index) {
  return text[index] === '*' && text[index - 1] !== '*' && text[index + 1] !== '*';
}

/**
 * @param {string | undefined} character
 */
function isOpeningMarkdownBoundary(character) {
  return character === undefined || /\s/u.test(character) || /[([{„"']/u.test(character);
}

/**
 * @param {string | undefined} character
 */
function isClosingMarkdownBoundary(character) {
  return character === undefined || /\s/u.test(character) || /[)\]}.,;:!?„”"']/u.test(character);
}

/**
 * @param {string} text
 * @param {number} startIndex
 */
function findClosingMarkdownStar(text, startIndex) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (
      isSingleAsterisk(text, index)
      && !/\s/u.test(text[index - 1] ?? '')
      && isClosingMarkdownBoundary(text[index + 1])
    ) {
      return index;
    }
  }

  return -1;
}

/**
 * @param {string} text
 * @param {number} startIndex
 */
function findOpeningMarkdownStar(text, startIndex) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (
      isSingleAsterisk(text, index)
      && isOpeningMarkdownBoundary(text[index - 1])
      && !/\s/u.test(text[index + 1] ?? '')
    ) {
      return index;
    }
  }

  return -1;
}

/**
 * @param {string} text
 * @param {number} index
 */
function isMarkdownItalicOpening(text, index) {
  const nextCharacter = text[index + 1];

  return isSingleAsterisk(text, index)
    && isOpeningMarkdownBoundary(text[index - 1])
    && Boolean(nextCharacter)
    && !/\s/u.test(nextCharacter)
    && findClosingMarkdownStar(text, index + 1) > index;
}

/**
 * @param {string} text
 * @param {number} index
 */
function isMarkdownItalicClosing(text, index) {
  const previousCharacter = text[index - 1];

  return isSingleAsterisk(text, index)
    && Boolean(previousCharacter)
    && !/\s/u.test(previousCharacter)
    && isClosingMarkdownBoundary(text[index + 1])
    && findOpeningMarkdownStar(text, index - 1) >= 0;
}

/**
 * @param {string} text
 * @param {number} index
 */
export function isFootnoteMarker(text, index) {
  return isSingleAsterisk(text, index)
    && !isMarkdownItalicOpening(text, index)
    && !isMarkdownItalicClosing(text, index);
}

/**
 * @param {string} text
 */
export function countFootnoteMarkers(text) {
  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (isFootnoteMarker(text, index)) {
      count += 1;
    }
  }

  return count;
}
