import { forwardRef, type HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type BadgeVariant = "accent" | "secondary"

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
}

const badgeVariants: Record<BadgeVariant, string> = {
  accent: "border-primary/30 bg-primary/10 text-primary",
  secondary: "border-border bg-secondary text-secondary-foreground",
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = "secondary", ...props },
  ref
) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        badgeVariants[variant],
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
