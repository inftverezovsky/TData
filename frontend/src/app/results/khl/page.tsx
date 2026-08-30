import { SettingsPasswordGate } from "@/components/settings/SettingsPasswordGate";
import { KhlResultsClient } from "@/components/results/khl/KhlResultsClient";

export default function KhlResultsPage() {
  return (
    <SettingsPasswordGate>
      <KhlResultsClient />
    </SettingsPasswordGate>
  );
}
