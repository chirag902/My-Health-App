import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { PhoneCall } from "lucide-react";
import type { ReactNode } from "react";

export function SosDialog({ children }: { children: ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <PhoneCall className="w-6 h-6 text-destructive" />
            Emergency Support
          </AlertDialogTitle>
          <AlertDialogDescription>
            If this is a life-threatening emergency, please dial your local emergency number immediately. Below are some resources that can provide immediate help.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4 my-4">
          <div className="p-4 border rounded-lg">
            <h3 className="font-semibold">National Suicide Prevention Lifeline</h3>
            <p className="text-muted-foreground">Call or text 988 anytime in the US and Canada.</p>
            <a href="tel:988" className="text-primary font-medium hover:underline">Tap to Call 988</a>
          </div>
          <div className="p-4 border rounded-lg">
            <h3 className="font-semibold">Crisis Text Line</h3>
            <p className="text-muted-foreground">Text HOME to 741741 from anywhere in the US, anytime, about any type of crisis.</p>
          </div>
           <div className="p-4 border rounded-lg">
            <h3 className="font-semibold">Local Emergency Services</h3>
            <p className="text-muted-foreground">For immediate danger, always call your local emergency services.</p>
             <a href="tel:911" className="text-primary font-medium hover:underline">Tap to Call 911 (US)</a>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction>I understand</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
