import AppShell from "@/components/layout/app-shell";
import AccountPage from "@/components/account-page";

export default function AccountPageRoute() {
  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">My Account</h1>
        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Manage your profile, settings, and view your activity.
        </p>
      </div>

      <AccountPage />
    </AppShell>
  );
}