import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { TooltipProvider } from "@/components/ui/tooltip"
import { PlaybackControllerProvider } from "@/hooks/use-playback-controller"
import App from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <PlaybackControllerProvider>
        <App />
      </PlaybackControllerProvider>
    </TooltipProvider>
  </StrictMode>
)
