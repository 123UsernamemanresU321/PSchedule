import { SettingsPage } from "@/components/settings/settings-page";
import { AppShell } from "@/components/shell/app-shell";

export default function SettingsRoute() {
  return (
    <AppShell>
      <SettingsPage />
    </AppShell>
  );
}
