import { ArrowRight, HardDrive, KeyRound, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { WorkflowSection } from "@/lib/workflow-sections"

type StudioOverviewPanelProps = {
  sections: WorkflowSection[]
}

export function StudioOverviewPanel({ sections }: StudioOverviewPanelProps) {
  const workflowSections = sections.filter((section) => section.id !== "overview")

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Local Workspace</Badge>
          </div>
          <CardTitle>Clone A Voice, Then Try It With Your Own Text</CardTitle>
          <CardDescription>
            Voice Clone Lab helps you choose or create a voice sample, type a script, and generate speech to preview how
            it sounds. The workflow keeps setup, provider keys, and saved previews tied to this local workspace.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="#voices">
              Start With Voices
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href="#provider">
              <KeyRound aria-hidden="true" data-icon="inline-start" />
              Provider Setup
            </a>
          </Button>
        </CardFooter>
      </Card>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-medium">Workflow Map</h3>
          <p className="mt-1 text-sm text-muted-foreground">Pick a card to jump into that part of the studio.</p>
        </div>
        <ol aria-label="Voice Studio Workflow" className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {workflowSections.map((section, index) => {
            const SectionIcon = section.icon
            const isRequired = !section.optional

            return (
              <li className="min-w-0" key={section.id}>
                <Card
                  className={cn(
                    "h-full p-0 transition hover:bg-muted/40",
                    isRequired ? "border-primary/60 bg-primary/5" : "border-border bg-background/50"
                  )}
                >
                  <a
                    className="flex h-full min-h-44 flex-col gap-4 rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={section.hash}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Badge variant={isRequired ? "accent" : "secondary"}>{section.stepLabel}</Badge>
                      <SectionIcon
                        aria-hidden="true"
                        className={cn("size-5", isRequired ? "text-primary" : "text-muted-foreground")}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-2">
                      <h3 className="text-base font-medium">{section.label}</h3>
                      <p className="text-sm leading-6 text-muted-foreground">{section.description}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{isRequired ? "Required" : "Optional"}</span>
                      <span aria-hidden="true" className="inline-flex items-center gap-1">
                        {index < workflowSections.length - 1 ? "Next" : "Open"}
                        <ArrowRight className="size-3.5" />
                      </span>
                    </div>
                  </a>
                </Card>
              </li>
            )
          })}
        </ol>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>What Stays Local</CardTitle>
          <CardDescription>
            The studio is designed for local experimentation before you decide what to keep or share.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 text-primary" />
              <div className="min-w-0">
                <h3 className="text-sm font-medium">Provider Keys</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Browser-entered keys are used only for local provider calls and are managed from Provider & Usage.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <HardDrive aria-hidden="true" className="mt-0.5 size-5 text-primary" />
              <div className="min-w-0">
                <h3 className="text-sm font-medium">Generated Audio</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Saved previews live in this browser so you can replay, download, or clear them later.
                </p>
              </div>
            </div>
          </div>
          <Separator />
          <p className="text-sm leading-6 text-muted-foreground">
            A good first pass is simple: open Voices, pick or add a voice, then move to Generate Speech and try a short
            line of text.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
