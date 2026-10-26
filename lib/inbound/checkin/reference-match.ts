const key = (value: unknown) => String(value ?? "").trim().toUpperCase();
const isSeparator = (value: string) => /[\s/-]/.test(value);

/** Slash-adjacent whitespace is presentation only. Keep all other punctuation,
 * internal whitespace, token order, and leading zeroes significant. Callers keep
 * the original stored/input value for display and persistence. */
export function normalizeReference(value: unknown): string {
  return key(value).replace(/\s*\/\s*/g, "/");
}

/** Match the entire entered reference, never fragments of the entered input.
 * References may share a field when separated by whitespace, slash, or hyphen.
 * A slash compound must occur together in order in this same field; matching
 * either component alone cannot discard a contradictory supplied component. */
export function referenceMatchesInput(value: unknown, input: unknown): boolean {
  const reference = normalizeReference(value);
  const entered = normalizeReference(input);
  if (!reference || !entered) return false;
  if (reference === entered) return true;
  // Two-component numeric agricultural references are sometimes entered
  // with their components reversed. Require the entire two-part field to
  // match; never reverse arbitrary text, fragments, or multi-part references.
  const numericPair = /^(\\d+)-(\\d+)$/;
  const storedPair = reference.match(numericPair);
  const enteredPair = entered.match(numericPair);
  if (storedPair && enteredPair && storedPair[1] === enteredPair[2] &&
      storedPair[2] === enteredPair[1]) return true;

  for (let index = reference.indexOf(entered); index !== -1; index = reference.indexOf(entered, index + 1)) {
    const end = index + entered.length;
    if ((index === 0 || isSeparator(reference[index - 1])) &&
        (end === reference.length || isSeparator(reference[end]))) return true;
  }
  return false;
}
