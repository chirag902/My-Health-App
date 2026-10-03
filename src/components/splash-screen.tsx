
import { HeartPulse } from "lucide-react"
import { cn } from "@/lib/utils"

export default function SplashScreen({ finishing }: { finishing: boolean }) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-500 ease-in-out",
        finishing && "opacity-0 pointer-events-none"
      )}
    >
      <div className="flex items-center gap-3 animate-pulse">
        <HeartPulse className="w-10 h-10 text-primary" />
        <span className="text-3xl font-bold text-foreground">MyHealthApp</span>
      </div>
    </div>
  )
}
