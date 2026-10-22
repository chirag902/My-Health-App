import type { Metadata } from "next";

import JournalEditor from "@/components/journal-editor";
import AppShell from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Daily Journal | MyHealthApp",
  description: "Reflect on your thoughts, feelings, and experiences. Private and secure.",
};

export default function JournalPage() {
  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Daily Journal</h1>
        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Reflect on your thoughts, feelings, and experiences. Your entries are private and secure.
        </p>
      </div>
      <JournalEditor />
    </AppShell>
  );
}