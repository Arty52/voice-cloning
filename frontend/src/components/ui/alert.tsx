import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md border border-border bg-background/60 p-3 text-sm text-muted-foreground", className)}
      role="status"
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("font-medium text-foreground", className)} {...props} />
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 leading-6", className)} {...props} />
}
