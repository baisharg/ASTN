import { useState } from 'react'
import { TabsContent } from '~/components/ui/tabs'
import { cn } from '~/lib/utils'

/**
 * State for tabs whose panels stay mounted once opened, so unsaved work in
 * one tab survives a visit to another. A panel mounts the first time its tab
 * is opened (not before: some load data or call Luma when they mount).
 *
 * Pass `tab` and `openTab` to `<Tabs value onValueChange>` and `visited` to
 * each `<KeptTabsContent>`.
 */
export function useKeptTabs<Tab extends string>(initial: Tab) {
  const [tab, setTab] = useState<Tab>(initial)
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    () => new Set([initial]),
  )
  const openTab = (next: string) => {
    setTab(next as Tab)
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
  }
  return { tab, openTab, visited }
}

/** A tab panel that is hidden, not unmounted, while another tab is open. */
export function KeptTabsContent({
  value,
  visited,
  className,
  children,
}: {
  value: string
  visited: ReadonlySet<string>
  className?: string
  children: React.ReactNode
}) {
  if (!visited.has(value)) return null
  return (
    <TabsContent
      value={value}
      forceMount
      className={cn('data-[state=inactive]:hidden', className)}
    >
      {children}
    </TabsContent>
  )
}
