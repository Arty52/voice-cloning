import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type Props = { providerChange?: { saved: string; current: string; onAccept: () => void } | null; conflict: boolean; error: string | null; disabled: boolean; onKeepCurrent: () => void; onUseSaved: () => void }
export function DialogueDraftNotice({ providerChange, conflict, error, disabled, onKeepCurrent, onUseSaved }: Props) {
  if (!conflict && !error && !providerChange) return null
  return <>
    {providerChange ? <Alert role="alert">
      <AlertTitle>Provider Changed</AlertTitle>
      <AlertDescription>This draft uses {providerChange.saved}, but the current provider is {providerChange.current}. Choose the current provider, then review its model and tuning before generating.</AlertDescription>
      <Button className="mt-3" disabled={disabled} onClick={providerChange.onAccept} type="button" size="sm" variant="secondary">Use Current Provider</Button>
    </Alert> : null}
    {conflict || error ? <Alert role="alert">
    <AlertTitle>{conflict ? "Draft Changed In Another Tab" : "Draft Not Saved"}</AlertTitle>
    <AlertDescription>{conflict ? "Local autosaving is paused. Choose which dialogue draft to keep." : error}</AlertDescription>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={onKeepCurrent} type="button" size="sm" variant="secondary">{conflict ? "Keep This Draft" : "Save Draft Again"}</Button>
      {conflict ? <Button disabled={disabled} onClick={onUseSaved} type="button" size="sm" variant="secondary">Use Saved Draft</Button> : null}
    </div>
  </Alert> : null}
  </>
}
