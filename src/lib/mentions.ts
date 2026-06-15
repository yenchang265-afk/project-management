/* @mention autocomplete — pure helpers shared by the comment inputs.
   The server's extractMentions needs an exact full-name match, so the UI must
   rewrite "@maya c" → "@Maya Chen". These functions are pure and unit-tested;
   the React glue lives in MentionTextarea. */

// A mention query may span first+last name, so spaces are allowed; it never
// crosses a newline or a second '@'.
const QUERY_CHAR = /[\p{L}\p{N} ]/u;

/** Detect an active "@query" ending at the caret. Returns the index of the '@'
 *  and the partial query after it, or null when the caret isn't in a mention.
 *  The '@' must start a token (line start or preceded by whitespace). */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0 && QUERY_CHAR.test(text[i])) i--;
  if (i < 0 || text[i] !== "@") return null;
  if (i > 0 && !/\s/.test(text[i - 1])) return null; // glued to a word (e.g. email)
  return { start: i, query: text.slice(i + 1, caret) };
}

/** Names whose full name prefix-matches the query (case-insensitive). An empty
 *  query returns all names. */
export function matchNames(query: string, names: string[]): string[] {
  const q = query.toLowerCase();
  return names.filter((n) => n.toLowerCase().startsWith(q));
}

/** Replace the "@query" span [start, caret) with "@<name> " and return the new
 *  value + caret position (just past the inserted name and trailing space). */
export function applyMention(
  text: string, start: number, caret: number, name: string,
): { value: string; caret: number } {
  const value = text.slice(0, start) + "@" + name + " " + text.slice(caret);
  return { value, caret: start + 1 + name.length + 1 };
}
