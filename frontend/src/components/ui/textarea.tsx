import { forwardRef, type TextareaHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      className={cn(
        "min-h-36 w-full resize-y rounded-md border border-input bg-input/40 px-3 py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/35",
        className
      )}
      ref={ref}
      {...props}
    />
  )
  }
)
