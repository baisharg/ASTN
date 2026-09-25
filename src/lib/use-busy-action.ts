import { useCallback, useState } from 'react'

/**
 * Run an async action while tracking which one is in flight, so buttons can
 * show a spinner and stay disabled. Errors go to `onError` instead of being
 * thrown; the action's result (or undefined on error) is returned.
 */
export function useBusyAction<Key extends string = string>() {
  const [busy, setBusy] = useState<Key | null>(null)
  const run = useCallback(
    async <T>(
      key: Key,
      action: () => Promise<T>,
      onError: (error: unknown) => void,
    ): Promise<T | undefined> => {
      setBusy(key)
      try {
        return await action()
      } catch (error) {
        console.error(error)
        onError(error)
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [],
  )
  return { busy, run }
}
