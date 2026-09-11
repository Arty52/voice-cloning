import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type Props = { conflict: boolean; error: string | null; disabled: boolean; onKeepCurrent: () => void; onUseSaved: () => void }
export function DialogueDraftNotice({ conflict, error, disabled, onKeepCurrent, onUseSaved }: Props) {
  if (!conflict && !error) return null
  return <Alert role="alert">
    <AlertTitle>{conflict ? "Draft Changed In Another Tab" : "Draft Not Saved"}</AlertTitle>
    <AlertDescription>{conflict ? "Local autosaving is paused. Choose which dialogue draft to keep." : error}</AlertDescription>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={onKeepCurrent} type="button" size="sm" variant="secondary">{conflict ? "Keep This Draft" : "Save Draft Again"}</Button>
      {conflict ? <Button disabled={disabled} onClick={onUseSaved} type="button" size="sm" variant="secondary">Use Saved Draft</Button> : null}
    </div>
  </Alert>
}
