/**
 * After sending a Luma email blast fails on our side (e.g. the connection
 * dropped), Luma may still have created it. This finds that blast in the
 * list read back from Luma, so the admin isn't invited to send it twice.
 */

export type ListedBlast = {
  id: string
  subject: string | null
  contentMd: string
  sentAt: number | null
  scheduledFor: number | null
}

// A blast sent longer ago than this is an earlier one that happens to match.
const RECENT_MS = 5 * 60 * 1000

/** Text as compared between what was typed and what Luma returns. */
function comparable(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The blast in `blasts` that is the one just attempted: same message (and
 * subject, when one was typed), not among `knownIds` (the blasts listed
 * before sending; null when that list hadn't loaded), and not sent before
 * the attempt began.
 */
export function findJustSentBlast<Blast extends ListedBlast>(args: {
  blasts: Array<Blast>
  knownIds: ReadonlySet<string> | null
  subject: string
  content: string
  startedAt: number
}): Blast | null {
  const subject = comparable(args.subject)
  const content = comparable(args.content)
  return (
    args.blasts.find((blast) => {
      if (args.knownIds?.has(blast.id)) return false
      if (comparable(blast.contentMd) !== content) return false
      if (subject && comparable(blast.subject) !== subject) return false
      // Scheduled or held by Luma (not sent yet): an identical one is waiting
      // either way, so sending again would duplicate it.
      if (blast.sentAt === null) return true
      return blast.sentAt >= args.startedAt - RECENT_MS
    }) ?? null
  )
}
