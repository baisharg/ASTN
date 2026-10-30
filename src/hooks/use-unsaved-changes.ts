import { useBlocker } from '@tanstack/react-router'

/**
 * Ask before leaving a page with unsaved edits: in-app navigation gets a
 * confirm, and closing or reloading the tab gets the browser's own prompt.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !window.confirm('You have unsaved changes. Leave without saving them?'),
    enableBeforeUnload: () => dirty,
  })
}
