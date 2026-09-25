import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { cn } from '~/lib/utils'
import { useCopy } from '~/lib/social-i18n'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import type { SocialLang } from '~/lib/social-i18n'

/** Shared building blocks for the in-person event pages (BAISH theme). */

export function Avatar({
  initials,
  size = 44,
}: {
  initials: string
  size?: 40 | 44 | 72
}) {
  const sizeClass =
    size === 72
      ? 'size-[72px] text-2xl'
      : size === 40
        ? 'size-10 text-sm'
        : 'size-11 text-[15px]'
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[var(--baish-brand-text)]',
        sizeClass,
      )}
    >
      {initials}
    </span>
  )
}

export type AttendeeState = FunctionReturnType<
  typeof api.social.meetings.listAttendees
>[number]['state']

const stateCopy = {
  es: {
    available: 'Disponible',
    in_meeting: 'En reunión',
    busy: 'No disponible',
  },
  en: {
    available: 'Available',
    in_meeting: 'In a meeting',
    busy: 'Not available',
  },
} satisfies Record<SocialLang, Record<AttendeeState, string>>

const stateStyle: Record<AttendeeState, { text: string; dot: string }> = {
  available: {
    text: 'text-[var(--baish-ok)]',
    dot: 'bg-[var(--baish-ok-dot)]',
  },
  in_meeting: {
    text: 'text-[var(--baish-warn)]',
    dot: 'bg-[var(--baish-warn-dot)]',
  },
  busy: {
    text: 'text-muted-foreground',
    dot: 'border-[1.5px] border-muted-foreground',
  },
}

export function StateLabel({
  state,
  compact = false,
}: {
  state: AttendeeState
  compact?: boolean
}) {
  const t = useCopy(stateCopy)
  const style = stateStyle[state]
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 font-medium',
        compact ? 'text-xs' : 'text-[13px]',
        style.text,
      )}
    >
      <span className={cn('size-2 rounded-full', style.dot)} />
      {t[state]}
    </span>
  )
}

export function Panel({
  children,
  className,
  raised = false,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { raised?: boolean }) {
  return (
    <section
      {...rest}
      className={cn(
        'flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-5',
        raised &&
          'shadow-[0_1px_2px_rgba(17,12,46,0.06),0_8px_24px_rgba(17,12,46,0.06)]',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="baish-serif text-[30px] font-semibold leading-tight text-[var(--baish-strong)]">
      {children}
    </h1>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--baish-brand-text)]">
      {children}
    </span>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[13px]">
      {children}
    </span>
  )
}

/** Back arrow link used at the top of sub-pages. */
export function BackLink({
  to,
  params,
  label,
}: {
  to: string
  params: Record<string, string>
  label: string
}) {
  return (
    <Link
      to={to}
      params={params}
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-muted"
    >
      <ArrowLeft className="size-[22px]" aria-hidden="true" />
    </Link>
  )
}

export const primaryButtonClass =
  'flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60'

export const secondaryButtonClass =
  'flex h-12 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-[15px] font-semibold text-[var(--baish-brand-text)] hover:bg-muted disabled:opacity-60'
