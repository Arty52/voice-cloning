import { useState } from "react"

import type { ConfirmationState } from "@/types"

export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null)

  return {
    clearConfirmation: () => setConfirmation(null),
    confirmation,
    requestConfirmation: setConfirmation,
  }
}
