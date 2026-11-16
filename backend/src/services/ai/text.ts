/**
 * Text normalisation shared by intent parsing, camera-name matching and (from
 * Phase 2) the evidence search index.
 *
 * Vietnamese needs diacritic folding: operators type "cổng chính", models may
 * return "cong chinh", and the database may hold either. Normalising both sides
 * to lowercase ASCII makes the comparison reliable without a full-text engine.
 */

/** Lowercase, strip Vietnamese diacritics, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a normalised string into searchable tokens (length >= 2). */
export function tokenize(input: string | null | undefined): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Vietnamese plate normalisation: uppercase, keep only A-Z0-9.
 * "59A-12345" / "59a 123.45" -> "59A12345".
 */
export function normalizePlate(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** Jaccard overlap of token sets, 0..1. Used to score camera-name matches. */
export function tokenOverlap(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return shared / Math.max(setA.size, setB.size);
}

/**
 * How much of `field` the query covers, 0..1.
 *
 * Jaccard is the wrong metric when matching a short database field against a
 * long question: "sự kiện ở khu vực kho" vs location "Khu vực kho" scores only
 * 3/5 with Jaccard but is a perfect match. Coverage divides by the field's own
 * token count instead.
 */
export function tokenCoverage(field: string, query: string): number {
  const fieldTokens = new Set(tokenize(field));
  if (fieldTokens.size === 0) return 0;
  const queryTokens = new Set(tokenize(query));
  let shared = 0;
  for (const t of fieldTokens) if (queryTokens.has(t)) shared += 1;
  return shared / fieldTokens.size;
}

/** True when `needle` appears in `haystack` after normalisation. */
export function containsNormalized(haystack: string, needle: string): boolean {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  if (!n) return false;
  return h.includes(n);
}

/** Clamp a number into [min, max]; returns undefined for non-finite input. */
export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}
