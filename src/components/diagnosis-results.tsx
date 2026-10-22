"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasFeedbackConsent, setFeedbackConsent, submitDiagnosisFeedback, type UrgencyRating } from "@/lib/feedback";
import type { DiagnosisMode } from "@/lib/types";
import {
  BrainCircuit,
  Check,
  ClipboardList,
  Copy,
  Dumbbell,
  ExternalLink,
  Heart,
  Leaf,
  Phone,
  ShieldAlert,
  Stethoscope,
  Utensils,
} from "lucide-react";
import {
  diagnosisToText,
  isSafeUrl,
  list,
  specialtySlug,
  type DiagnosisData,
  type Urgency,
} from "@/lib/diagnosis-ui";

const URGENCY: Record<Urgency, { label: string; severe: boolean }> = {
  emergency: { label: "Emergency: seek care now", severe: true },
  urgent: { label: "Urgent: see a doctor within 24 hours", severe: true },
  soon: { label: "See a doctor within a few days", severe: false },
  routine: { label: "Routine check-up is enough", severe: false },
  "self-care": { label: "Self-care is reasonable; monitor", severe: false },
};

const strength = (c?: number) =>
  typeof c !== "number" || Number.isNaN(c)
    ? null
    : c < 0.4
      ? "Low"
      : c < 0.7
        ? "Moderate"
        : "High";

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
      {items.map((t, i) => (
        <li key={`${i}-${t.slice(0, 12)}`}>{t}</li>
      ))}
    </ul>
  );
}
function FeedbackWidget({ mode, urgency }: { mode: DiagnosisMode; urgency: Urgency }) {
  const [consent, setConsent] = useState(hasFeedbackConsent);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (sent) return <p className="text-xs text-muted-foreground">Thanks — this helps us improve urgency accuracy.</p>;

  if (!consent) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Help improve urgency accuracy? No symptom text is stored, only the urgency label and your rating.</span>
        <Button size="sm" variant="outline" onClick={() => { setFeedbackConsent(true); setConsent(true); }}>
          Share anonymous feedback
        </Button>
      </div>
    );
  }

  const send = async (urgencyRating: UrgencyRating) => {
    if (busy) return;
    setBusy(true);
    await submitDiagnosisFeedback({ mode, urgency, helpful: true, urgencyRating });
    setBusy(false);
    setSent(true);
  };

  return (
    <div className="space-y-1.5 text-xs">
      <p className="text-muted-foreground">Was the urgency level right?</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => send("too_low")}>Too low</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => send("correct")}>About right</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => send("too_high")}>Too high</Button>
      </div>
    </div>
  );
}

export default function DiagnosisResults({
  diagnosis,
  mode,
}: {
  diagnosis: DiagnosisData | null | undefined;
  mode: DiagnosisMode;
}) {
  const [copied, setCopied] = useState(false);

  if (!diagnosis) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough information yet. Tell me more about your symptoms.
      </p>
    );
  }

  const physical = list(diagnosis.relatedPhysicalIllnesses);
  const mental = list(diagnosis.mentalHealthConditions);
  const redFlags = list(diagnosis.redFlags);
  const notes = list(diagnosis.personalizedNotes);
  const questions = list(diagnosis.questionsForDoctor);
  const lifestyle = list(diagnosis.wellnessAdvice?.lifestyle);
  const mindfulness = list(diagnosis.wellnessAdvice?.mindfulness);
  const diet = list(diagnosis.wellnessAdvice?.diet);
  const possible = list(diagnosis.possibleConditions);
  const sources = (diagnosis.sources ?? []).filter(
    (s) => s && typeof s.title === "string" && isSafeUrl(s.url)
  );
  const urgency = diagnosis.urgency ? URGENCY[diagnosis.urgency] : null;
  const match = strength(diagnosis.confidenceLevel);
  const specialty = diagnosis.suggestedSpecialty?.trim();

  const wellness = [
    { key: "lifestyle", title: "Lifestyle", Icon: Dumbbell, items: lifestyle },
    { key: "mindfulness", title: "Mindfulness", Icon: Leaf, items: mindfulness },
    { key: "diet", title: "Diet", Icon: Utensils, items: diet },
  ].filter((w) => w.items.length > 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosisToText(diagnosis));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: ignore */
    }
  };

  return (
    <div className="space-y-4 text-sm">
      
      {urgency && (
        <Alert variant={urgency.severe ? "destructive" : "default"}>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{urgency.label}</AlertTitle>
          <AlertDescription>
            {diagnosis.urgencyReason}
            {urgency.severe && (
              <a
                href="tel:112"
                className="mt-2 inline-flex items-center gap-1 font-semibold underline"
              >
                <Phone className="h-3.5 w-3.5" /> Call 112
              </a>
            )}
          </AlertDescription>
        </Alert>
      )}

      {redFlags.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Go to a hospital immediately if
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Bullets items={redFlags} />
          </CardContent>
        </Card>
      )}
      {possible.length > 0 && (
  <Card>
    <CardHeader className="p-4 pb-2">
      <CardTitle className="flex items-center gap-2 text-base">
        <Stethoscope className="h-5 w-5 text-primary" />
        Most likely explanations
      </CardTitle>
    </CardHeader>
    <CardContent className="flex flex-wrap gap-2 p-4 pt-0">
      {possible.map((c, i) => <Badge key={`pc-${i}`}>{c}</Badge>)}
    </CardContent>
  </Card>
)}

      {physical.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Heart className="h-5 w-5 text-destructive" />
              Possible physical causes
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 p-4 pt-0">
            {physical.map((c, i) => (
              <Badge key={`p-${i}`} variant="outline">
                {c}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {mental.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Emotional wellbeing patterns to discuss
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            <div className="flex flex-wrap gap-2">
              {mental.map((c, i) => (
                <Badge key={`m-${i}`} variant="secondary">
                  {c}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              These are patterns, not diagnoses. Only a qualified professional can diagnose.
            </p>
          </CardContent>
        </Card>
      )}

{physical.length === 0 && mental.length === 0 && possible.length === 0 && !urgency?.severe && (
        <p className="text-muted-foreground">
          Nothing specific stands out from what you shared. A doctor can examine you properly.
        </p>
      )}

{match && possible.length + physical.length + mental.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Match strength: <span className="font-medium text-foreground">{match}</span>. This is an
          AI estimate from limited information, not a clinical probability.
        </p>
      )}

      {notes.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Based on your profile</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Bullets items={notes} />
          </CardContent>
        </Card>
      )}

      {wellness.length > 0 && (
        <Accordion
          type="multiple"
          defaultValue={wellness.map((w) => w.key)}
          className="w-full"
        >
          {wellness.map(({ key, title, Icon, items }) => (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger className="font-semibold">
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-accent" />
                  {title}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <Bullets items={items} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {(diagnosis.whenToSeeDoctor || specialty || questions.length > 0) && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-5 w-5 text-primary" />
              Next step
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {diagnosis.whenToSeeDoctor && (
              <p className="text-muted-foreground">{diagnosis.whenToSeeDoctor}</p>
            )}
            {questions.length > 0 && (
              <div>
                <h4 className="mb-1 flex items-center gap-2 font-medium">
                  <ClipboardList className="h-4 w-4" /> Ask your doctor
                </h4>
                <Bullets items={questions} />
              </div>
            )}
            {specialty && (
              <Button asChild size="sm">
                <Link href={`/doctor?specialty=${encodeURIComponent(specialtySlug(specialty))}`}>
                  Find a {specialty}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {sources.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">Sources consulted</h4>
          <ul className="space-y-1">
            {sources.slice(0, 5).map((s, i) => (
              <li key={`${i}-${s.url}`}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                >
                  {s.title.slice(0, 90)} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-[11px] text-muted-foreground">
          Preliminary AI analysis. Not a medical diagnosis or prescription.
        </p>
        <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy summary for your doctor">
          {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <FeedbackWidget mode={mode} urgency={diagnosis.urgency} />
    </div>
  );
}