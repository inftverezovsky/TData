import { SettingsPasswordGate } from "@/components/settings/SettingsPasswordGate";
import { TLineWorkspace } from "@/components/tline/TLineWorkspace";

export default function TLineLinePage() {
  return (
    <SettingsPasswordGate>
      <TLineWorkspace />
    </SettingsPasswordGate>
  );
}
