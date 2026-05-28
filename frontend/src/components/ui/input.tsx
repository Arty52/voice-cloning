import type { InputHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-input bg-input/40 px-3 text-sm text-foreground outline-none transition file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/35",
        className
      )}
      {...props}
    />
  )
}
