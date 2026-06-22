import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type {
  WorkflowSection,
  WorkflowSectionId,
  WorkflowSectionStatus,
  WorkflowSectionStatusTone,
} from "@/lib/workflow-sections"

type VoiceStudioShellProps = {
  activeSectionId: WorkflowSectionId
  children: ReactNode
  header: ReactNode
  onSectionChange: (sectionId: WorkflowSectionId) => void
  sectionStatuses: Record<WorkflowSectionId, WorkflowSectionStatus>
  sections: WorkflowSection[]
}

type WorkflowSectionPanelProps = {
  activeSectionId: WorkflowSectionId
  children: ReactNode
  className?: string
  id: WorkflowSectionId
}

export function VoiceStudioShell({
  activeSectionId,
  children,
  header,
  onSectionChange,
  sectionStatuses,
  sections,
}: VoiceStudioShellProps) {
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0]
  const activeStatus = sectionStatuses[activeSection.id]

  return (
    <SidebarProvider>
      <WorkflowSidebar
        activeSectionId={activeSectionId}
        onSectionChange={onSectionChange}
        sectionStatuses={sectionStatuses}
        sections={sections}
      />
      <SidebarInset>
        <div className="min-h-svh px-4 py-4 text-foreground sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <MobileWorkflowBar activeSection={activeSection} activeStatus={activeStatus} />
            {header}
            <ActiveSectionHeader section={activeSection} status={activeStatus} />
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function WorkflowSectionPanel({ activeSectionId, children, className, id }: WorkflowSectionPanelProps) {
  return (
    <section className={cn("flex flex-col gap-4", activeSectionId !== id && "hidden", className)} data-section-id={id}>
      {children}
    </section>
  )
}

function WorkflowSidebar({
  activeSectionId,
  onSectionChange,
  sectionStatuses,
  sections,
}: Omit<VoiceStudioShellProps, "children" | "header">) {
  return (
    <Sidebar aria-label="Workflow Sidebar">
      <SidebarHeader>
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-sidebar-foreground/70">Voice Clone Lab</div>
          <div className="text-lg font-semibold">Voice Studio</div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workflow</SidebarGroupLabel>
          <SidebarGroupContent>
            <WorkflowSidebarNav
              activeSectionId={activeSectionId}
              onSectionChange={onSectionChange}
              sectionStatuses={sectionStatuses}
              sections={sections}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-wrap gap-2 px-2">
          <Badge>Frontend 4340</Badge>
          <Badge>API 6420</Badge>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function WorkflowSidebarNav({
  activeSectionId,
  onSectionChange,
  sectionStatuses,
  sections,
}: Omit<VoiceStudioShellProps, "children" | "header">) {
  const { isMobile, setOpenMobile } = useSidebar()

  function handleSelect(sectionId: WorkflowSectionId) {
    onSectionChange(sectionId)
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <nav aria-label="Workflow Sections">
      <SidebarMenu>
        {sections.map((section) => {
          const status = sectionStatuses[section.id]
          const SectionIcon = section.icon
          const StatusIcon = status.icon
          const isActive = activeSectionId === section.id

          return (
            <SidebarMenuItem key={section.id}>
              <SidebarMenuButton
                className="pr-24"
                isActive={isActive}
                onClick={() => handleSelect(section.id)}
                type="button"
              >
                <SectionIcon aria-hidden="true" />
                <span>{section.label}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className={cn("gap-1", statusToneClass(status.tone))}>
                <StatusIcon aria-hidden="true" className={cn("size-3", status.tone === "busy" && "animate-spin")} />
                <span>{status.label}</span>
              </SidebarMenuBadge>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
}

function MobileWorkflowBar({
  activeSection,
  activeStatus,
}: {
  activeSection: WorkflowSection
  activeStatus: WorkflowSectionStatus
}) {
  const StatusIcon = activeStatus.icon

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/90 p-2 shadow-sm md:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{activeSection.label}</div>
          <div className={cn("flex items-center gap-1 text-xs", statusToneClass(activeStatus.tone))}>
            <StatusIcon aria-hidden="true" className={cn("size-3", activeStatus.tone === "busy" && "animate-spin")} />
            <span>{activeStatus.label}</span>
          </div>
        </div>
      </div>
      <Badge>{activeSection.stepLabel}</Badge>
    </div>
  )
}

function ActiveSectionHeader({
  section,
  status,
}: {
  section: WorkflowSection
  status: WorkflowSectionStatus
}) {
  const StatusIcon = status.icon

  return (
    <section className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant={section.optional ? "secondary" : "accent"}>{section.stepLabel}</Badge>
          {section.optional ? <Badge>Optional</Badge> : null}
        </div>
        <h2 className="text-2xl font-semibold tracking-normal">{section.label}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{section.description}</p>
      </div>
      <Badge className={cn("gap-1.5", statusToneClass(status.tone))}>
        <StatusIcon aria-hidden="true" className={cn("size-3.5", status.tone === "busy" && "animate-spin")} />
        {status.label}
      </Badge>
    </section>
  )
}

function statusToneClass(tone: WorkflowSectionStatusTone) {
  if (tone === "error") {
    return "text-destructive"
  }
  if (tone === "attention" || tone === "success") {
    return "text-primary"
  }
  if (tone === "busy") {
    return "text-foreground"
  }
  return "text-muted-foreground"
}
