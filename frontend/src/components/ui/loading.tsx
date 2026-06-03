import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type LoadingSize = "sm" | "md"
type LoadingVariant = "default" | "secondary" | "destructive"

type LoadingProps = HTMLAttributes<HTMLDivElement> & {
  size?: LoadingSize
  text?: string
  variant?: LoadingVariant
}

const dotSizeClasses: Record<LoadingSize, string> = {
  sm: "size-1",
  md: "size-1.5",
}

const gapClasses: Record<LoadingSize, string> = {
  sm: "gap-1",
  md: "gap-1.5",
}

const textClasses: Record<LoadingSize, string> = {
  sm: "text-xs",
  md: "text-sm",
}

const variantClasses: Record<LoadingVariant, string> = {
  default: "",
  secondary: "text-muted-foreground",
  destructive: "text-destructive",
}

export function Loading({
  "aria-label": ariaLabel,
  className,
  role,
  size = "md",
  text,
  variant = "default",
  ...props
}: LoadingProps) {
  return (
    <div
      aria-label={text ? ariaLabel : ariaLabel || "Loading"}
      aria-live="polite"
      className={cn("inline-flex items-center", gapClasses[size], textClasses[size], variantClasses[variant], className)}
      role={role ?? "status"}
      {...props}
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        <span className={cn("rounded-full bg-current animate-pulse", dotSizeClasses[size])} />
        <span className={cn("rounded-full bg-current animate-pulse [animation-delay:150ms]", dotSizeClasses[size])} />
        <span className={cn("rounded-full bg-current animate-pulse [animation-delay:300ms]", dotSizeClasses[size])} />
      </span>
      {text ? <span>{text}</span> : null}
    </div>
  )
}
