/**
 * Markdown turns a pasted https://… or www.… address into a link, but not one
 * pasted without either, like safetytalent.org/org/baish/apply/tais. Give
 * those an https:// so they arrive as links too. Addresses already inside a
 * markdown link, or after a letter, slash or @, are left alone.
 */
export function linkBareUrls(markdown: string): string {
  return markdown.replace(
    /(^|[\s(])((?!www\.)(?:[a-z0-9-]+\.)+(?:org|com|ar|io|net|dev|ai)\/[^\s)<>]*)/gi,
    (_match, before: string, url: string) => `${before}https://${url}`,
  )
}
