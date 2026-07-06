import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { TuningInfo } from "@/components/tuning-info"
import { cn } from "@/lib/utils"
import {
  isTuningControlValueOffNominal,
  resolveNominalTuningValue,
} from "@/lib/voice-tuning"
import type {
  ProviderTuningControl,
  ProviderTuningValue,
  VoiceTuningValues,
} from "@/types"

type VoiceTuningControlsProps = {
  className?: string
  controls: ProviderTuningControl[]
  disabled: boolean
  idPrefix: string
  nominalValues?: VoiceTuningValues
  onTuningValueChange: (control: ProviderTuningControl, value: ProviderTuningValue) => void
  tuning: VoiceTuningValues
}

export function VoiceTuningControls({
  className,
  controls,
  disabled,
  idPrefix,
  nominalValues = {},
  onTuningValueChange,
  tuning,
}: VoiceTuningControlsProps) {
  return (
    <FieldGroup className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {controls.map((control) => {
        const nominalValue = resolveNominalTuningValue(control, nominalValues)
        return (
          <VoiceTuningControl
            control={control}
            disabled={disabled}
            idPrefix={idPrefix}
            key={control.id}
            nominalValue={nominalValue}
            onChange={onTuningValueChange}
            value={tuning[control.id] ?? nominalValue}
          />
        )
      })}
    </FieldGroup>
  )
}

function VoiceTuningControl({
  control,
  disabled,
  idPrefix,
  nominalValue,
  onChange,
  value,
}: {
  control: ProviderTuningControl
  disabled: boolean
  idPrefix: string
  nominalValue: ProviderTuningValue
  onChange: (control: ProviderTuningControl, value: ProviderTuningValue) => void
  value: ProviderTuningValue
}) {
  const controlId = `${safeId(idPrefix)}-${safeId(control.id)}`

  if (control.type === "toggle") {
    return (
      <Field className="flex-row items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={controlId} id={`${controlId}-label`}>
            {control.label}
          </FieldLabel>
          <TuningInfo description={control.description} id={controlId} label={control.label} />
        </div>
        <input
          aria-labelledby={`${controlId}-label`}
          checked={value === true}
          className="size-5 accent-primary"
          disabled={disabled}
          id={controlId}
          onChange={(event) => onChange(control, event.target.checked)}
          type="checkbox"
        />
      </Field>
    )
  }

  if (control.type === "select") {
    return (
      <Field>
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={controlId} id={`${controlId}-label`}>
            {control.label}
          </FieldLabel>
          <TuningInfo description={control.description} id={controlId} label={control.label} />
        </div>
        <select
          aria-labelledby={`${controlId}-label`}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          id={controlId}
          onChange={(event) => onChange(control, selectedOptionValue(control, event.target.value))}
          value={String(value)}
        >
          {(control.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    )
  }

  const numericValue = typeof value === "number" ? value : Number(value)
  const sliderValue = Number.isNaN(numericValue) ? Number(control.defaultValue) || 0 : numericValue
  const isOffNominal = isTuningControlValueOffNominal(control, value, { [control.id]: nominalValue })
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={controlId} id={`${controlId}-label`}>
            {control.label}
          </FieldLabel>
          <TuningInfo description={control.description} id={controlId} label={control.label} />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{sliderValue.toFixed(2)}</span>
          <Button
            aria-label={`Reset ${control.label} To Nominal`}
            className="size-8 shrink-0"
            disabled={disabled || !isOffNominal}
            onClick={() => onChange(control, nominalValue)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
          </Button>
        </div>
      </div>
      <input
        aria-labelledby={`${controlId}-label`}
        className={cn("h-2 w-full", isOffNominal ? "accent-modified" : "accent-primary")}
        disabled={disabled}
        id={controlId}
        max={control.max}
        min={control.min}
        onChange={(event) => onChange(control, Number(event.target.value))}
        step={control.step}
        type="range"
        value={sliderValue}
      />
      {control.capability ? <FieldDescription>{control.capability}</FieldDescription> : null}
    </Field>
  )
}

function selectedOptionValue(control: ProviderTuningControl, selectedValue: string): ProviderTuningValue {
  const option = (control.options ?? []).find((candidate) => String(candidate.value) === selectedValue)
  return option ? option.value : selectedValue
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-")
}
