import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { TranscriptionSettingsController } from "@/hooks/use-transcription-settings"

const LANGUAGE_LABELS: Record<string, string> = {
  auto: "Detect Automatically", en: "English", ru: "Russian", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ja: "Japanese", zh: "Chinese", ko: "Korean",
}

export function TranscriptionControls({ settings, disabled }: { settings: TranscriptionSettingsController; disabled: boolean }) {
  return (
    <FieldGroup className="grid gap-4 sm:grid-cols-2">
      <Field data-disabled={disabled}>
        <FieldLabel htmlFor="transcription-engine">Transcription Engine</FieldLabel>
        <Select disabled={disabled || settings.status === "loading"} onValueChange={settings.selectEngine} value={settings.options.engineId}>
          <SelectTrigger id="transcription-engine"><SelectValue placeholder="Select Engine" /></SelectTrigger>
          <SelectContent><SelectGroup>
            {settings.engines.map((engine) => <SelectItem key={engine.id} value={engine.id}>{engine.label}{engine.ready ? "" : " · Not Ready"}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        <FieldDescription>{settings.selectedEngine?.model ?? "Loading available models."}</FieldDescription>
      </Field>
      <Field data-disabled={disabled}>
        <FieldLabel htmlFor="transcription-language">Language</FieldLabel>
        <Select disabled={disabled || !settings.selectedEngine} onValueChange={settings.selectLanguage} value={settings.options.language}>
          <SelectTrigger id="transcription-language"><SelectValue placeholder="Select Language" /></SelectTrigger>
          <SelectContent><SelectGroup>
            {settings.selectedEngine?.languages.map((language) => <SelectItem key={language} value={language}>{LANGUAGE_LABELS[language] ?? language}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
      </Field>
      <Field data-disabled={disabled}>
        <div className="flex items-center gap-3">
          <Switch checked={settings.options.detectSpeakers} disabled={disabled} id="transcription-speakers" onCheckedChange={settings.setDetectSpeakers} />
          <FieldLabel htmlFor="transcription-speakers">Detect Speakers</FieldLabel>
        </div>
        <FieldDescription>
          {!settings.options.detectSpeakers ? "Text-only transcription. Speaker detection is off."
            : settings.options.engineId !== "faster-whisper" && !settings.nativeDiarizationReady
            ? "Speaker detection is not prepared. Text will remain available if detection fails."
            : "Speaker detection uses CPU. Turn it off for text-only transcription."}
        </FieldDescription>
      </Field>
      <div className="flex items-start sm:justify-end">
        <Button disabled={disabled || settings.status === "loading"} onClick={settings.refresh} type="button" variant="secondary">Refresh Availability</Button>
      </div>
    </FieldGroup>
  )
}
