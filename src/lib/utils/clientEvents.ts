export const TOURNAMENT_DATA_UPDATED_EVENT = "tcyber:tournament-data-updated";
export const TEAM_MAPPINGS_UPDATED_EVENT = "tcyber:team-mappings-updated";
export const ADMIN_MAPPING_UPDATED_EVENT = "tcyber:admin-mapping-updated";

type TournamentEventDetail = {
  tournamentId?: string;
  disciplineSlug?: string;
};

export function dispatchTournamentDataUpdated(detail: TournamentEventDetail) {
  dispatchClientEvent(TOURNAMENT_DATA_UPDATED_EVENT, detail);
}

export function dispatchTeamMappingsUpdated(detail: TournamentEventDetail) {
  dispatchClientEvent(TEAM_MAPPINGS_UPDATED_EVENT, detail);
}

export function dispatchAdminMappingUpdated(detail: TournamentEventDetail) {
  dispatchClientEvent(ADMIN_MAPPING_UPDATED_EVENT, detail);
}

function dispatchClientEvent(name: string, detail: TournamentEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
