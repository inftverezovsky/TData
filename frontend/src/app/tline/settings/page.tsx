import { SettingsPasswordGate } from "@/components/settings/SettingsPasswordGate";
import { TLineSettingsWorkspace } from "@/components/tline/TLineSettingsWorkspace";

export default function TLineSettingsPage() {
  return (
    <SettingsPasswordGate>
      <TLineSettingsWorkspace />
    </SettingsPasswordGate>
  );
}
