import type { SocialLang } from './social-i18n'

/**
 * How a 1:1 spot is named to attendees.
 *
 * A spot always has a number. The organizer can also give it a name, which is
 * what the sign at the venue says ("A1 · Jardín"). A named spot is shown by
 * its name everywhere; an unnamed one by its number ("Lugar 3").
 */
export type NamedSpot = { number: number; label: string | null }

function nameOf(spot: NamedSpot): string | null {
  const name = spot.label?.trim()
  return name ? name : null
}

/** The spot as a heading: "A1 · Jardín", or "Lugar 3" without a name. */
export function spotName(spot: NamedSpot, lang: SocialLang): string {
  return (
    nameOf(spot) ??
    (lang === 'es' ? `Lugar ${spot.number}` : `Spot ${spot.number}`)
  )
}

/**
 * The spot at the end of a sentence: "en A1 · Jardín", or "en el lugar 3"
 * without a name.
 */
export function atSpot(spot: NamedSpot, lang: SocialLang): string {
  const name = nameOf(spot)
  if (lang === 'es') return name ? `en ${name}` : `en el lugar ${spot.number}`
  return name ? `at ${name}` : `at spot ${spot.number}`
}

/**
 * The text inside the spot's pin on the floor plan: its number, or nothing
 * when the spot has a name (the name is too long for the pin and is shown
 * above the plan).
 */
export function spotPinText(spot: NamedSpot): string | null {
  return nameOf(spot) ? null : String(spot.number)
}
