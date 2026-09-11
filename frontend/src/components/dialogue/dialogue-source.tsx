import { ChevronDown, Sparkles } from "lucide-react"
import { useLayoutEffect, useRef, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { MAX_SPEECH_TEXT_LENGTH } from "@/constants"

type Props = {
  expanded: boolean
  hasRows: boolean
  disabled: boolean
  text: string
  textRef: RefObject<HTMLTextAreaElement | null>
  onExpandedChange: (expanded: boolean) => void
  onTextChange: (text: string) => void
  onImport: () => void
}

export function DialogueSource({ expanded, hasRows, disabled, text, textRef, onExpandedChange, onTextChange, onImport }: Props) {
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!expanded && content.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true })
  }, [expanded])
  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange} className="rounded-md border border-border bg-background/50">
      <CollapsibleTrigger asChild>
        <Button ref={trigger} id="dialogue-source-toggle" type="button" variant="ghost" disabled={disabled} className="h-auto w-full justify-between gap-3 rounded-md px-3 py-3" aria-label={expanded ? "Hide Script Source" : "Show Script Source"}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Script Source</span>
            <span className="text-xs font-normal text-muted-foreground">{text.length.toLocaleString()} Source Characters{hasRows ? " · Imported" : ""}</span>
          </span>
          <ChevronDown aria-hidden="true" className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent ref={content} className="dialogue-source-content overflow-hidden" inert={!expanded}>
        <div className="px-3 pb-3">
          <Field>
            <div className="flex justify-between gap-3">
              <FieldLabel htmlFor="speech-text">Script Source</FieldLabel>
              <span className="font-mono text-xs text-muted-foreground">{text.length}/{MAX_SPEECH_TEXT_LENGTH}</span>
            </div>
            <Textarea disabled={disabled} id="speech-text" className="max-h-none overflow-hidden" maxLength={MAX_SPEECH_TEXT_LENGTH} onChange={event => onTextChange(event.target.value)} placeholder="Paste speaker-labeled dialogue here." ref={textRef} rows={4} value={text} />
            <FieldDescription>Import speaker-labeled text into editable rows. Row edits do not change this source.</FieldDescription>
          </Field>
          <Button className="mt-3" disabled={disabled || !text.trim()} onClick={onImport} type="button" variant="secondary" size="sm">
            <Sparkles aria-hidden="true" />{hasRows ? "Reimport Dialogue" : "Import Dialogue"}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
