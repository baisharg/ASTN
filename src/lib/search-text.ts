/** Text as compared in a search box: no accents, no case, trimmed. */
export function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Whether any of `fields` contains `query`, ignoring accents and case
 * ("jose" finds "José"). An empty query matches everything.
 */
export function matchesSearch(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const q = searchable(query)
  if (!q) return true
  return fields.some((field) => !!field && searchable(field).includes(q))
}
