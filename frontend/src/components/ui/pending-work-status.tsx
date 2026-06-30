import type { HTMLAttributes, ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Loading } from "@/components/ui/loading"
import { cn } from "@/lib/utils"

type PendingWorkStatusProps = Omit<HTMLAttributes<HTMLElement>, "role"> & {
  description?: ReactNode
  meta?: ReactNode
  statusLabel?: ReactNode
  title: ReactNode
}

export function PendingWorkStatus({
  children,
  className,
  description,
  meta,
  statusLabel,
  title,
  ...props
}: PendingWorkStatusProps) {
  return (
    <section
      {...props}
      className={cn("pending-work-status relative overflow-hidden rounded-md border border-border bg-background/60 p-3", className)}
      aria-live="polite"
      role="status"
    >
      <span aria-hidden="true" className="pending-work-status__shine" />
      <div className="relative flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Loading aria-hidden="true" role="presentation" size="sm" />
              <h3 className="min-w-0 text-sm font-medium">{title}</h3>
            </div>
            {description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div> : null}
          </div>
          {statusLabel || meta ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
              {meta}
            </div>
          ) : null}
        </div>
        {children !== null && children !== undefined ? <div className="flex flex-col gap-2">{children}</div> : null}
      </div>
    </section>
  )
}
