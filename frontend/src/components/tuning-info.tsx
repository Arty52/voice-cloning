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
        className="pointer-events-none fixed inset-x-4 bottom-4 z-20 hidden rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground shadow-lg group-focus-within:block group-hover:block sm:absolute sm:bottom-auto sm:left-0 sm:right-auto sm:top-6 sm:w-72 sm:max-w-[min(18rem,calc(100vw-3rem))]"
        id={tooltipId}
        role="tooltip"
      >
        {description}
      </span>
    </span>
  )
}
