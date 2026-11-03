import { marked } from 'marked'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * Where replies to an org's emails go. Emails leave from
 * notifications@safetytalent.org, which nobody reads, so a reply would be
 * lost without this: the org's reply-to address, else its contact email.
 */
export async function replyToFor(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Array<string> | undefined> {
  const org = await ctx.db.get('organizations', orgId)
  const address = org?.replyToEmail?.trim() || org?.contactEmail?.trim()
  return address ? [address] : undefined
}

/** Where renderAdminBroadcast leaves room for the org's footer. */
export const ORG_FOOTER_MARKER = '<!--org-footer-->'

/**
 * Put the org's email footer (Canonicals → Emails) into a rendered email:
 * at the marker, or before </body> for an email rendered without one. The
 * footer is markdown written by the org's admins, like the templates.
 */
export async function withOrgFooter(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  html: string,
): Promise<string> {
  const org = await ctx.db.get('organizations', orgId)
  const footer = org?.emailFooter?.trim()
  const block = footer
    ? `<div style="margin-top:24px;font-size:13px;line-height:1.5;color:#6b7280">${marked.parse(
        footer,
        { async: false, breaks: true, gfm: true },
      )}</div>`
    : ''
  if (html.includes(ORG_FOOTER_MARKER)) {
    return html.replace(ORG_FOOTER_MARKER, block)
  }
  const end = html.lastIndexOf('</body>')
  return end === -1
    ? html + block
    : html.slice(0, end) + block + html.slice(end)
}
