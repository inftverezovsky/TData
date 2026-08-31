export type ParserProbeStatus = "healthy" | "healthy_empty" | "warning" | "failed";

export type ParserProbeErrorClass =
  | "cloudflare_block"
  | "upstream_timeout"
  | "schema_drift"
  | "parse_failed"
  | "stale_cache"
  | "filter_excluded"
  | "placeholder_404"
  | "uncovered_provider";

export interface SourceProbeResult {
  id: string;
  source: string;
  scope: string | null;
  hostname: string;
  required: boolean;
  status: ParserProbeStatus;
  errorClass: ParserProbeErrorClass | null;
  summary: string;
  rawCandidates: number;
  normalizedItems: number;
  detailChecked: boolean;
  cacheHit: boolean;
  stale: boolean;
  attempts: number;
  durationMs: number;
  checkedAt: string;
}

export interface ParserMonitorReport {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: SourceProbeResult[];
  summary: {
    total: number;
    healthy: number;
    healthyEmpty: number;
    warning: number;
    failed: number;
  };
  exitCode: 0 | 1 | 2;
}

export function isParserMonitorReport(value: unknown): value is ParserMonitorReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ParserMonitorReport>;
  return report.schemaVersion === 1
    && typeof report.runId === "string"
    && typeof report.startedAt === "string"
    && typeof report.finishedAt === "string"
    && Array.isArray(report.results)
    && Boolean(report.summary && typeof report.summary === "object")
    && (report.exitCode === 0 || report.exitCode === 1 || report.exitCode === 2);
}
