import type { OfficialSourceAdapter } from "./contracts";
import { createHockeyByAdapter } from "./hockeyBy";
import { createNffrFloorballAdapter } from "./nffrFloorball";
import { createVolleyRuAdapter } from "./volleyRu";

export interface OfficialSourceRegistry {
  readonly providers: readonly string[];
  get(provider: string): OfficialSourceAdapter;
}

export function createOfficialSourceRegistry(adapters: readonly OfficialSourceAdapter[]): OfficialSourceRegistry {
  const duplicate = adapters.find(
    (adapter, index) => adapters.findIndex((candidate) => candidate.provider === adapter.provider) !== index,
  );
  if (duplicate) throw new Error(`Duplicate TLine official source provider: ${duplicate.provider}`);

  const adapterByProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  const providers = Object.freeze(adapters.map((adapter) => adapter.provider));
  return Object.freeze({
    providers,
    get(provider: string) {
      const adapter = adapterByProvider.get(provider);
      if (!adapter) throw new Error(`Unknown TLine official source provider: ${provider}`);
      return adapter;
    },
  });
}

export function createDefaultOfficialSourceRegistry(): OfficialSourceRegistry {
  return createOfficialSourceRegistry([
    createVolleyRuAdapter(),
    createNffrFloorballAdapter(),
    createHockeyByAdapter(),
  ]);
}
