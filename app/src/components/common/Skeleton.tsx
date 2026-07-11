import { cn } from '@app/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-canvas-subtle', className)}
      aria-hidden
    />
  )
}
