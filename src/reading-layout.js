// Widths in rem keep the reading column proportional to the reader's text size.
export const DEFAULT_READING_WIDTH = 44;
export const MIN_READING_WIDTH = 32;
export const MAX_READING_WIDTH = 44;

/** @param {unknown} width */
export function isValidReadingWidth(width) {
  return typeof width === 'number'
    && Number.isFinite(width)
    && width >= MIN_READING_WIDTH
    && width <= MAX_READING_WIDTH;
}

/** @param {unknown} width */
export function resolveReadingWidth(width) {
  return isValidReadingWidth(width) ? Number(width) : DEFAULT_READING_WIDTH;
}
