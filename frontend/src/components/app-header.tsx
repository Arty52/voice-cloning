import { Volume2 } from "lucide-react"
import type { SVGProps } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const GITHUB_REPOSITORY_URL = "https://github.com/Arty52/voice-cloning"
const GITHUB_REPOSITORY_LABEL = "View Source On GitHub"

function GitHubLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="currentColor" viewBox="0 0 16 16" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.77c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild aria-label={GITHUB_REPOSITORY_LABEL} size="icon" variant="ghost">
              <a href={GITHUB_REPOSITORY_URL} rel="noreferrer" target="_blank">
                <GitHubLogo aria-hidden="true" data-icon="inline-start" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {GITHUB_REPOSITORY_LABEL}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
