import { LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react"
import type { FormEvent, RefObject } from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { VoiceAsset } from "@/types"

type SpeechInputPanelProps = {
  canGenerate: boolean
  characterCount: number
  isGenerating: boolean
  onCancelGeneration: () => void
  onGenerate: (event?: FormEvent<HTMLFormElement>) => void
  onTextChange: (text: string) => void
  selectedVoice: VoiceAsset | null
  text: string
  textRef: RefObject<HTMLTextAreaElement | null>
}

export function SpeechInputPanel({
  canGenerate,
  characterCount,
  isGenerating,
  onCancelGeneration,
  onGenerate,
  onTextChange,
  selectedVoice,
  text,
  textRef,
}: SpeechInputPanelProps) {
  return (
    <form
      aria-busy={isGenerating}
      className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5"
      onSubmit={onGenerate}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="text-sm font-medium" htmlFor="speech-text">
          Text to Speak
        </label>
        <span className="font-mono text-xs text-muted-foreground">{characterCount}/5000</span>
      </div>
      <Textarea
        className="max-h-none overflow-hidden"
        disabled={isGenerating}
        id="speech-text"
        maxLength={5000}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Enter the text you want to synthesize."
        ref={textRef}
        rows={1}
        value={text}
      />
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Source: <span className="text-foreground">{selectedVoice?.name || "No voice selected"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canGenerate} type="submit">
            {isGenerating ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" className="size-4" />
            )}
            {isGenerating ? "Generating..." : "Generate"}
          </Button>
          <Button disabled={!canGenerate} onClick={() => onGenerate()} variant="secondary">
            <RefreshCw aria-hidden="true" className="size-4" />
            Retry
          </Button>
          {isGenerating ? (
            <Button
              className="border-destructive/60 text-foreground hover:bg-destructive/15"
              onClick={onCancelGeneration}
              variant="secondary"
            >
              <X aria-hidden="true" className="size-4" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}
