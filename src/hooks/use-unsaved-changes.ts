import { useBlocker } from '@tanstack/react-router'

/**
 * Ask before leaving a page with unsaved edits: in-app navigation gets a
 * confirm, and closing or reloading the tab gets the browser's own prompt.
 * `message` is the confirm's text, for pages that aren't in English.
 */
export function useUnsavedChangesWarning(
  dirty: boolean,
  message = 'You have unsaved changes. Leave without saving them?',
) {
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm(message),
    enableBeforeUnload: () => dirty,
  })
}
