import JournalEditor from "@/components/journal-editor";
import AppShell from "@/components/layout/app-shell";

export default function JournalPage() {
  return (
    <AppShell>
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold tracking-tight">Daily Journal</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Reflect on your thoughts, feelings, and experiences. Your entries are private and secure.
        </p>
      </div>
      <JournalEditor />
    </AppShell>
  );
}
