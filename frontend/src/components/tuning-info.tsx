import { Info } from "lucide-react"

export function TuningInfo({ description, id, label }: { description: string; id: string; label: string }) {
  const tooltipId = `${id}-help`

  return (
    <span className="group relative inline-flex">
      <button
        aria-describedby={tooltipId}
        aria-label={`${label} help`}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </button>
      <span
        className="pointer-events-none absolute left-0 top-6 z-20 w-72 max-w-[min(18rem,calc(100vw-3rem))] rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {description}
      </span>
    </span>
  )
}
