import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BookText, FileScan, HeartPulse, ShieldCheck, Sparkles, Stethoscope, Users, type LucideIcon,
} from "lucide-react";

import Footer from "@/components/layout/footer";
import SymptomPreview from "@/components/marketing/symptom-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/* ============================================================
   CONTENT
   ============================================================ */

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  span: "wide" | "normal";
  /** "lab-preview" swaps the description text for a real mini lab-result
      table instead of icon+paragraph — the one card in this grid that
      shows actual content rather than describing it. */
  content?: "lab-preview";
}

const FEATURES: readonly Feature[] = [
  {
    icon: Stethoscope,
    title: "AI Symptom Check",
    description: "Describe how you feel and get possible explanations and general wellness guidance. Informational only, never a diagnosis.",
    span: "normal", // already demonstrated live above via SymptomPreview
  },
  {
    icon: BookText,
    title: "Journal & Habits",
    description: "Reflect on your thoughts, and build habits you can actually see yourself keeping.",
    span: "normal",
  },
  {
    icon: FileScan,
    title: "Lab Report Analysis",
    description: "Upload a blood report as a PDF or photo and see each value explained next to its reference range.",
    span: "wide",
    content: "lab-preview",
  },
  {
    icon: Sparkles,
    title: "Daily Motivation",
    description: "A short message that's actually different every day, not the same line on repeat.",
    span: "normal",
  },
  {
    icon: Users,
    title: "Doctor Directory",
    description: "Browse doctors by specialty to decide who to talk to next.",
    badge: "Demo data",
    span: "normal",
  },
  {
    icon: ShieldCheck,
    title: "Privacy First",
    description: "PDFs with selectable text are read on your own device. We don't store the documents you analyze.",
    span: "wide",
  },
] as const;

// Realistic mock values — not placeholder "X" text. Static, zero JS.
const LAB_PREVIEW_ROWS = [
  { name: "Hemoglobin", value: "13.8 g/dL", range: "13.0–17.0", status: "Normal" as const },
  { name: "LDL Cholesterol", value: "142 mg/dL", range: "< 100", status: "High" as const },
  { name: "Vitamin D", value: "18 ng/mL", range: "30–100", status: "Low" as const },
];

const STATUS_STYLES: Record<string, string> = {
  Normal: "text-muted-foreground",
  High: "text-destructive font-semibold",
  Low: "text-amber-600 dark:text-amber-400 font-semibold",
};

function LabPreviewTable() {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border bg-background/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Value</th>
            <th className="px-3 py-2 text-left font-medium">Result</th>
            <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Range</th>
            <th className="px-3 py-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {LAB_PREVIEW_ROWS.map((row) => (
            <tr key={row.name} className="border-b last:border-0">
              <td className="px-3 py-2 text-foreground">{row.name}</td>
              <td className="px-3 py-2 text-foreground">{row.value}</td>
              <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{row.range}</td>
              <td className={`px-3 py-2 text-right ${STATUS_STYLES[row.status]}`}>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STEPS = [
  { title: "Upload your report", description: "A PDF or a clear photo. Large images are compressed on your device first." },
  { title: "Review the extracted values", description: "See each result next to its reference range, with anything outside it flagged." },
  { title: "Talk to your doctor", description: "Use the plain-language summary to ask better questions at your appointment." },
] as const;

/* ============================================================
   PAGE (server component: no client JavaScript needed, except
   the two client islands explicitly imported above)
   ============================================================ */

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2" aria-label={`${siteConfig.name} home`}>
          <HeartPulse className="h-7 w-7 text-brand" aria-hidden="true" />
          <span className="text-xl font-bold text-foreground">{siteConfig.name}</span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Button asChild variant="ghost"><Link href="/login">Login</Link></Button>
          <Button asChild><Link href="/signup">Get Started</Link></Button>
        </nav>
      </header>

      <main id="main-content" className="flex-grow">
        {/* HERO — unchanged structure (waveform, SymptomPreview), headline
            and subheadline rewritten: hybrid tone, specific to this app */}
        <section className="container mx-auto px-4 pb-16 pt-10 text-center md:pt-16">
          <div
            className="relative mx-auto mb-10 h-20 max-w-4xl overflow-hidden md:h-28"
            style={{
              WebkitMaskImage: "linear-gradient(90deg, transparent, black 15%, black 85%, transparent)",
              maskImage: "linear-gradient(90deg, transparent, black 15%, black 85%, transparent)",
            }}
            aria-hidden="true"
          >
            <div className="flex w-[200%] animate-vitals-scroll">
              {[0, 1].map((copy) => (
                <svg key={copy} viewBox="0 0 600 120" className="h-20 w-[600px] shrink-0 md:h-28" fill="none">
                  <path
                    d="M0,60 L230,60 L255,60 L270,15 L285,105 L300,25 L315,60 L600,60"
                    stroke="url(#vitalsGradient)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  />
                  <defs>
                    <linearGradient id="vitalsGradient" x1="0" y1="0" x2="600" y2="0" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="hsl(var(--brand))" />
                      <stop offset="100%" stopColor="hsl(var(--brand-accent))" />
                    </linearGradient>
                  </defs>
                </svg>
              ))}
            </div>
          </div>

          <h1 className="font-headline text-gradient-brand mx-auto mb-4 max-w-4xl pb-2 text-4xl font-extrabold leading-[1.1] tracking-tight md:text-6xl">
  Health software that explains itself
</h1>

          <p className="mx-auto mb-8 max-w-3xl text-lg text-muted-foreground md:text-xl">
            Check symptoms, make sense of your lab results, journal what's going on, and keep habits that actually
            stick, without switching between four different apps to do it.
          </p>

          <div className="mb-8">
            <SymptomPreview />
          </div>

          <Button asChild size="lg">
            <Link href="/signup">Create your account <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" /></Link>
          </Button>

          <p className="mx-auto mt-6 max-w-2xl text-xs text-muted-foreground">
            {siteConfig.name} provides general information only. It is not a medical service and does not diagnose,
            treat, or replace a qualified healthcare professional. In an emergency, call your local emergency number
            (112 in India).
          </p>
        </section>

        {/* FEATURES — asymmetric bento grid, now with one card (Lab Report
            Analysis) showing real content instead of icon+description */}
        <section className="bg-muted/50 py-16 md:py-24" aria-labelledby="features-heading">
          <div className="container mx-auto px-4">
            <div className="mb-12 text-center">
            <h2 id="features-heading" className="font-headline text-3xl font-bold tracking-tight md:text-4xl">
  Every part of your health, in one account
</h2>
              <p className="mx-auto mt-2 max-w-2xl text-lg text-muted-foreground">
                Not four separate apps pretending to talk to each other, just the record of your symptoms, your
                lab results, and your habits, in the place you'll actually open again tomorrow.
              </p>
            </div>

            <ul className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description, badge, span, content }) => (
                <li key={title} className={span === "wide" ? "sm:col-span-2 lg:col-span-2" : "sm:col-span-1 lg:col-span-1"}>
                  <div className="flex h-full flex-col justify-between rounded-2xl border bg-card p-6 transition-colors hover:border-brand/40">
                    <div>
                      <Icon className="mb-5 h-7 w-7 text-brand" aria-hidden="true" />
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        {title}
                        {badge && <Badge variant="secondary">{badge}</Badge>}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                      {content === "lab-preview" && <LabPreviewTable />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}