import { Volume2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"

export function AppHeader() {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Volume2 aria-hidden="true" className="size-4 text-primary" />
          Local Workspace
        </div>
        <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">Voice Clone Lab</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Generate speech from saved voice samples while keeping provider keys local to this workspace.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Frontend 4340</Badge>
        <Badge>API 6420</Badge>
      </div>
    </header>
  )
}
