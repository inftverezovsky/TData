import ManualImportWorkbench from "@/components/manualImport/ManualImportWorkbench";
import { SettingsPasswordGate } from "@/components/settings/SettingsPasswordGate";

export default function ManualImportPage() {
  return (
    <SettingsPasswordGate>
      <ManualImportWorkbench />
    </SettingsPasswordGate>
  );
}
