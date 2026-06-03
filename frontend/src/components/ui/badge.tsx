import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type BadgeVariant = "accent" | "secondary"

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
}

const badgeVariants: Record<BadgeVariant, string> = {
  accent: "border-primary/30 bg-primary/10 text-primary",
  secondary: "border-border bg-secondary text-secondary-foreground",
}

export function Badge({ className, variant = "secondary", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  )
}
