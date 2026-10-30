import * as React from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { useIsMobile } from '~/hooks/use-media-query'
import { cn } from '~/lib/utils'

interface ResponsiveSheetProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function ResponsiveSheet({ children, ...props }: ResponsiveSheetProps) {
  return <Dialog {...props}>{children}</Dialog>
}

interface ResponsiveSheetContentProps extends React.ComponentProps<
  typeof DialogContent
> {
  children: React.ReactNode
}

function ResponsiveSheetContent({
  children,
  className,
  ...props
}: ResponsiveSheetContentProps) {
  const isMobile = useIsMobile()

  return (
    <DialogContent
      className={cn(
        isMobile && [
          // Bottom sheet positioning
          'fixed bottom-0 top-auto left-0 right-0',
          'translate-x-0 translate-y-0',
          'max-w-full w-full',
          'rounded-t-xl rounded-b-none',
          'max-h-[85dvh]',
          // Slide up animation
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
          'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
        ],
        className,
      )}
      {...props}
    >
      {/* Drag handle indicator for mobile */}
      {isMobile && (
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted-foreground/20" />
      )}
      {children}
    </DialogContent>
  )
}

const ResponsiveSheetTrigger = DialogTrigger
const ResponsiveSheetClose = DialogClose
const ResponsiveSheetHeader = DialogHeader
const ResponsiveSheetTitle = DialogTitle
const ResponsiveSheetDescription = DialogDescription

export {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetTrigger,
  ResponsiveSheetClose,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
}
