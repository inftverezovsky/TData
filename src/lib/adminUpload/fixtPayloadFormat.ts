export type AdminFixtPayload = {
  shapka: number;
  sport: number;
  max: number;
  match: Array<{
    date: string;
    team1: number;
    team2: number | "";
  }>;
};

export type AdminFixtPayloadEnvelope<T extends AdminFixtPayload = AdminFixtPayload> = [T];

export function toAdminFixtPayloadEnvelope<T extends AdminFixtPayload>(
  payload: T | AdminFixtPayloadEnvelope<T>
): AdminFixtPayloadEnvelope<T> {
  return Array.isArray(payload) ? payload : [payload];
}

export function getAdminFixtPayloadHead<T extends AdminFixtPayload>(
  payload: T | AdminFixtPayloadEnvelope<T>
): T | undefined {
  return Array.isArray(payload) ? payload[0] : payload;
}
