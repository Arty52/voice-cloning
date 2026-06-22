import { useCallback, useEffect, useState } from "react"

import {
  DEFAULT_WORKFLOW_SECTION_ID,
  workflowSectionHash,
  workflowSectionIdFromHash,
  type WorkflowSectionId,
} from "@/lib/workflow-sections"

function currentSectionFromLocation() {
  if (typeof window === "undefined") {
    return DEFAULT_WORKFLOW_SECTION_ID
  }
  return workflowSectionIdFromHash(window.location.hash)
}

export function useWorkflowNavigation() {
  const [activeSectionId, setActiveSectionId] = useState<WorkflowSectionId>(currentSectionFromLocation)

  useEffect(() => {
    const handleHashChange = () => setActiveSectionId(currentSectionFromLocation())
    window.addEventListener("hashchange", handleHashChange)
    handleHashChange()
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  const navigateToSection = useCallback((sectionId: WorkflowSectionId) => {
    const nextHash = workflowSectionHash(sectionId)
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash)
    }
    setActiveSectionId(sectionId)
  }, [])

  return {
    activeSectionId,
    navigateToSection,
  }
}
