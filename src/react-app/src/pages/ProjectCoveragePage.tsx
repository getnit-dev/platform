import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, Panel } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type CoverageReport, type CoverageGap, type DocCoverageEntry, type Project } from "../lib/api";
import { TICK_STYLE, TOOLTIP_STYLE } from "../lib/chart-styles";
import { toDateTime, toNumber, toPercentNumber, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";

/* ---------- types ---------- */

interface FileHeatPoint {
  path: string;
  coveragePercent: number;
}

interface CoverageState {
  loading: boolean;
  reports: CoverageReport[];
  fullReport: unknown;
  gaps: CoverageGap[];
  gapSummary: { totalGaps: number; byPriority: Record<string, number>; untestedFiles: number } | null;
  docSummary: { totalFiles: number; documented: number; undocumented: number; stale: number; coveragePercent: number } | null;
  docEntries: DocCoverageEntry[];
  error: string | null;
}

/* ---------- helper functions (preserved) ---------- */

function coverageColor(value: number): string {
  if (value >= 85) {
    return "hsl(160 84% 39% / 0.15)";
  }

  if (value >= 70) {
    return "hsl(38 92% 50% / 0.15)";
  }

  return "hsl(346 77% 50% / 0.15)";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function numericFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractFileHeatmap(fullReport: unknown): FileHeatPoint[] {
  const out: FileHeatPoint[] = [];
  const root = asRecord(fullReport);
  if (!root) {
    return out;
  }

  const filesArray = Array.isArray(root.files) ? root.files : null;
  if (filesArray) {
    for (const item of filesArray) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }

      const rawPath = record.path ?? record.file ?? record.name;
      const path = typeof rawPath === "string" ? rawPath : null;
      const rawCoverage =
        numericFromUnknown(record.coveragePercent) ??
        numericFromUnknown(record.coverage) ??
        numericFromUnknown(record.lineCoverage);

      if (!path || rawCoverage === null) {
        continue;
      }

      const normalized = rawCoverage <= 1 ? rawCoverage * 100 : rawCoverage;
      out.push({ path, coveragePercent: Math.max(0, Math.min(100, normalized)) });
    }
  }

  const coverage = asRecord(root.coverage);
  const coverageFiles = coverage ? asRecord(coverage.files) : null;
  if (coverageFiles) {
    for (const [path, value] of Object.entries(coverageFiles)) {
      const record = asRecord(value);
      const raw = record
        ? numericFromUnknown(record.pct) ?? numericFromUnknown(record.coverage)
        : numericFromUnknown(value);

      if (raw === null) {
        continue;
      }

      const normalized = raw <= 1 ? raw * 100 : raw;
      out.push({ path, coveragePercent: Math.max(0, Math.min(100, normalized)) });
    }
  }

  const deduped = new Map<string, FileHeatPoint>();
  for (const point of out) {
    const existing = deduped.get(point.path);
    if (!existing || existing.coveragePercent < point.coveragePercent) {
      deduped.set(point.path, point);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => a.coveragePercent - b.coveragePercent)
    .slice(0, 60);
}

function packageBreakdown(reports: CoverageReport[]): Array<{
  packageId: string;
  reports: number;
  avgCoverage: number;
  passRate: number;
}> {
  const map = new Map<string, { totalCoverage: number; coverageCount: number; passed: number; generated: number; reports: number }>();

  for (const report of reports) {
    const key = report.packageId ?? "root";
    const entry = map.get(key) ?? {
      totalCoverage: 0,
      coverageCount: 0,
      passed: 0,
      generated: 0,
      reports: 0
    };

    if (report.overallCoverage !== null) {
      entry.totalCoverage += report.overallCoverage;
      entry.coverageCount += 1;
    }

    entry.passed += report.testsPassed;
    entry.generated += report.testsGenerated;
    entry.reports += 1;
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([packageId, value]) => ({
      packageId,
      reports: value.reports,
      avgCoverage: value.coverageCount ? (value.totalCoverage / value.coverageCount) * 100 : 0,
      passRate: value.generated > 0 ? (value.passed / value.generated) * 100 : 0
    }))
    .sort((a, b) => b.avgCoverage - a.avgCoverage);
}

function buildTrend(reports: CoverageReport[]) {
  return [...reports]
    .reverse()
    .map((report) => ({
      date: report.createdAt.slice(0, 10),
      coverage: toPercentNumber(report.overallCoverage),
      testsPassed: report.testsPassed,
      testsFailed: report.testsFailed
    }));
}

/* ---------- small inline components ---------- */

function CoverageProgressBar(props: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, props.value));
  const barColor =
    clamped >= 85
      ? "bg-emerald-500"
      : clamped >= 70
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div className={cn("flex items-center gap-2", props.className)}>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-default-100">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500", barColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="mono min-w-[3.2rem] text-right text-xs font-medium tabular-nums">
        {clamped.toFixed(1)}%
      </span>
    </div>
  );
}

function TrendArrow(props: { delta: number }) {
  if (Math.abs(props.delta) < 0.05) {
    return <span className="text-default-500 text-sm font-medium">--</span>;
  }

  const isUp = props.delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-sm font-semibold",
        isUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      )}
    >
      <svg
        viewBox="0 0 12 12"
        className={cn("h-3 w-3", !isUp && "rotate-180")}
        fill="currentColor"
      >
        <path d="M6 2l4 5H2z" />
      </svg>
      {Math.abs(props.delta).toFixed(1)}%
    </span>
  );
}

/* ---------- main content ---------- */

function CoverageContent(props: { project: Project }) {
  const [state, setState] = useState<CoverageState>({
    loading: true,
    reports: [],
    fullReport: null,
    gaps: [],
    gapSummary: null,
    docSummary: null,
    docEntries: [],
    error: null
  });
  const [gapFilter, setGapFilter] = useState<string>("All");

  useEffect(() => {
    let active = true;

    async function load() {
      setState({ loading: true, reports: [], fullReport: null, gaps: [], gapSummary: null, docSummary: null, docEntries: [], error: null });

      try {
        const [reportResponse, gapsRes, gapSummaryRes, docSummaryRes, docEntriesRes] = await Promise.all([
          api.reports.list({ projectId: props.project.id, limit: 200 }),
          api.coverageGaps.list({ projectId: props.project.id, limit: 200 }).catch(() => ({ gaps: [] as CoverageGap[] })),
          api.coverageGaps.summary({ projectId: props.project.id }).catch(() => null),
          api.docCoverage.summary({ projectId: props.project.id }).catch(() => null),
          api.docCoverage.list({ projectId: props.project.id, limit: 100 }).catch(() => ({ files: [] as DocCoverageEntry[] })),
        ]);

        const latestReport = reportResponse.reports[0];
        let fullReport: unknown = null;
        if (latestReport) {
          const detail = await api.reports.get(latestReport.id, { includeFull: true });
          fullReport = detail.fullReport ?? null;
        }

        if (!active) return;

        setState({
          loading: false,
          reports: reportResponse.reports,
          fullReport,
          gaps: gapsRes.gaps,
          gapSummary: gapSummaryRes,
          docSummary: docSummaryRes,
          docEntries: docEntriesRes.files,
          error: null
        });
      } catch (error) {
        if (!active) return;
        const message = error instanceof ApiError ? error.message : "Unable to load coverage tab";
        setState({ loading: false, reports: [], fullReport: null, gaps: [], gapSummary: null, docSummary: null, docEntries: [], error: message });
      }
    }

    void load();
    return () => { active = false; };
  }, [props.project.id]);

  const trend = useMemo(() => buildTrend(state.reports), [state.reports]);
  const packages = useMemo(() => packageBreakdown(state.reports), [state.reports]);
  const heatmap = useMemo(() => extractFileHeatmap(state.fullReport), [state.fullReport]);

  const latest = state.reports[0];
  const previous = state.reports[1];

  const latestCoverage = toPercentNumber(latest?.overallCoverage);
  const previousCoverage = previous ? toPercentNumber(previous.overallCoverage) : null;
  const delta = previousCoverage !== null ? latestCoverage - previousCoverage : 0;

  /* Compute aggregate type-breakdown from the most recent reports that have the data */
  const typeBreakdown = useMemo(() => {
    let unitSum = 0, unitCount = 0;
    let intSum = 0, intCount = 0;
    let e2eSum = 0, e2eCount = 0;

    for (const r of state.reports.slice(0, 20)) {
      if (r.unitCoverage !== null) { unitSum += r.unitCoverage * 100; unitCount++; }
      if (r.integrationCoverage !== null) { intSum += r.integrationCoverage * 100; intCount++; }
      if (r.e2eCoverage !== null) { e2eSum += r.e2eCoverage * 100; e2eCount++; }
    }

    return {
      unit: unitCount > 0 ? unitSum / unitCount : null,
      integration: intCount > 0 ? intSum / intCount : null,
      e2e: e2eCount > 0 ? e2eSum / e2eCount : null,
    };
  }, [state.reports]);

  const hasTypeBreakdown = typeBreakdown.unit !== null || typeBreakdown.integration !== null || typeBreakdown.e2e !== null;

  const heroColorClass =
    latestCoverage >= 85
      ? "text-emerald-600 dark:text-emerald-400"
      : latestCoverage >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";

  const heroRingColor =
    latestCoverage >= 85
      ? "hsl(160 84% 39%)"
      : latestCoverage >= 70
        ? "hsl(38 92% 50%)"
        : "hsl(346 77% 50%)";

  if (state.loading) {
    return <Panel><p className="text-sm text-default-500">Loading coverage tab...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Coverage data unavailable" body={state.error} />;
  }

  if (state.reports.length === 0) {
    return <EmptyState title="No coverage reports" body="Upload a report via CLI or API to visualize trends." />;
  }

  /* ---------- coverage ring math ---------- */
  const ringSize = 160;
  const ringRadius = (ringSize - 16) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (latestCoverage / 100) * ringCircumference;

  return (
    <div className="space-y-6">
      {/* ========== 1. Hero Metric Section ========== */}
      <Panel className="relative overflow-hidden">
        <div className="flex flex-col items-center gap-6 py-4 md:flex-row md:gap-10 md:py-2">
          {/* Large coverage ring */}
          <div className="relative flex-shrink-0" style={{ width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize} className="-rotate-90">
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={ringRadius}
                fill="none"
                stroke="hsl(var(--heroui-default-300))"
                strokeWidth={8}
              />
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={ringRadius}
                fill="none"
                stroke={heroRingColor}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("mono text-3xl font-bold tracking-tight", heroColorClass)}>
                {latestCoverage.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Hero text */}
          <div className="flex flex-col items-center gap-1 md:items-start">
            <h2 className="text-lg font-semibold text-foreground">Overall Coverage</h2>
            <div className="flex items-center gap-3">
              <TrendArrow delta={delta} />
              {previousCoverage !== null && (
                <span className="text-xs text-default-500">vs previous report</span>
              )}
            </div>
            <p className="mt-1 text-sm text-default-500">
              Latest run: {latest?.createdAt ? toDateTime(latest.createdAt) : "n/a"},{" "}
              <span className="font-medium text-foreground">{latest?.runMode ?? "n/a"}</span>{" "}
              on <span className="font-medium text-foreground">{latest?.branch ?? "n/a"}</span>
            </p>
            <div className="mt-2 flex items-center gap-4 text-xs text-default-500">
              <span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{toNumber(latest?.testsPassed ?? 0)}</span>{" "}
                passed
              </span>
              <span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">{toNumber(latest?.testsFailed ?? 0)}</span>{" "}
                failed
              </span>
              <span>
                <span className="font-semibold text-foreground">{toNumber(latest?.testsGenerated ?? 0)}</span>{" "}
                total
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {/* ========== 2. Coverage Breakdown Strip ========== */}
      {hasTypeBreakdown && (
        <div className="grid gap-4 md:grid-cols-3">
          {([
            { label: "Unit Coverage", value: typeBreakdown.unit },
            { label: "Integration Coverage", value: typeBreakdown.integration },
            { label: "E2E Coverage", value: typeBreakdown.e2e },
          ] as const).map((item) => (
            <Panel key={item.label} className="py-4">
              <p className="text-xs font-medium text-default-500">{item.label}</p>
              {item.value !== null ? (
                <CoverageProgressBar value={item.value} className="mt-2" />
              ) : (
                <p className="mt-2 text-xs text-default-500 italic">No data</p>
              )}
            </Panel>
          ))}
        </div>
      )}

      {/* ========== 3. Trend Area Chart ========== */}
      <Panel>
        <h2 className="text-sm font-semibold text-foreground">Coverage over time</h2>
        <div className="mt-4 h-72">
          {trend.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="coverageFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-default-300))" />
                <XAxis dataKey="date" tick={TICK_STYLE} />
                <YAxis tick={TICK_STYLE} domain={[0, 100]} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, "Coverage"]}
                />
                <Area
                  dataKey="coverage"
                  type="monotone"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#coverageFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-default-500">
              Need at least two reports to render a trend chart.
            </div>
          )}
        </div>
      </Panel>

      {/* ========== 4. Package Table with Inline Progress Bars ========== */}
      <Panel>
        <h2 className="text-sm font-semibold text-foreground">Per-package breakdown</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider">
                <th className="pb-2 pr-4 font-medium">Package</th>
                <th className="pb-2 pr-4 font-medium" style={{ minWidth: 200 }}>Avg coverage</th>
                <th className="pb-2 pr-4 font-medium text-right">Pass rate</th>
                <th className="pb-2 font-medium text-right">Reports</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((row) => (
                <tr key={row.packageId} className="border-b border-divider/50 last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="mono text-xs font-medium">{row.packageId}</span>
                  </td>
                  <td className="py-2.5 pr-4" style={{ minWidth: 200 }}>
                    <CoverageProgressBar value={row.avgCoverage} />
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <span
                      className={cn(
                        "mono text-xs font-semibold",
                        row.passRate >= 90
                          ? "text-emerald-600 dark:text-emerald-400"
                          : row.passRate >= 70
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {row.passRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-xs text-default-500">
                    {toNumber(row.reports)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {packages.length === 0 && (
            <p className="py-4 text-center text-sm text-default-500">No package data available.</p>
          )}
        </div>
      </Panel>

      {/* ========== 5. File-Level Heatmap Tiles ========== */}
      <Panel>
        <h2 className="text-sm font-semibold text-foreground">File-level heatmap</h2>
        <p className="mt-1 text-xs text-default-500">
          Lower-coverage files surface first from the latest full report payload.
        </p>

        {heatmap.length > 0 ? (
          <div className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {heatmap.map((item) => {
              const tileColor =
                item.coveragePercent >= 85
                  ? "border-emerald-500/30"
                  : item.coveragePercent >= 70
                    ? "border-amber-500/30"
                    : "border-rose-500/30";

              return (
                <div
                  key={item.path}
                  className={cn(
                    "group relative rounded-lg border-l-4 p-2.5 transition-colors",
                    tileColor
                  )}
                  style={{ backgroundColor: coverageColor(item.coveragePercent) }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="mono text-[11px] leading-snug text-foreground/80">
                      {truncate(item.path, 46)}
                    </p>
                    <span
                      className={cn(
                        "mono shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold",
                        item.coveragePercent >= 85
                          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : item.coveragePercent >= 70
                            ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                            : "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                      )}
                    >
                      {item.coveragePercent.toFixed(1)}%
                    </span>
                  </div>
                  {/* Micro inline bar under the file name */}
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background/50">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        item.coveragePercent >= 85
                          ? "bg-emerald-500/60"
                          : item.coveragePercent >= 70
                            ? "bg-amber-500/60"
                            : "bg-rose-500/60"
                      )}
                      style={{ width: `${item.coveragePercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-default-500">
            Full report file-level coverage details were not found. Upload richer report payloads to render this heatmap.
          </p>
        )}
      </Panel>

      {/* ========== 6. Coverage Gaps ========== */}
      {state.gaps.length > 0 && (
        <Panel>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Coverage Gaps</h2>
              <Badge variant="secondary">{state.gapSummary?.totalGaps ?? state.gaps.length}</Badge>
            </div>
            {state.gapSummary?.untestedFiles !== undefined && (
              <span className="text-xs text-default-500">{state.gapSummary.untestedFiles} untested files</span>
            )}
          </div>

          {/* Priority filter pills */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {["All", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map(p => (
              <button
                key={p}
                onClick={() => setGapFilter(p)}
                className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors", gapFilter === p ? "bg-primary text-primary-foreground shadow-sm" : "bg-default-200 text-foreground hover:bg-default-200/80")}
              >
                {p === "All" ? "All" : p.charAt(0) + p.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider">
                  <th className="pb-2 pr-4 font-medium">File</th>
                  <th className="pb-2 pr-4 font-medium">Function</th>
                  <th className="pb-2 pr-4 font-medium">Line</th>
                  <th className="pb-2 pr-4 font-medium" style={{ minWidth: 120 }}>Coverage</th>
                  <th className="pb-2 pr-4 font-medium text-right">Complexity</th>
                  <th className="pb-2 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {state.gaps
                  .filter(g => gapFilter === "All" || g.priority?.toUpperCase() === gapFilter)
                  .map(gap => {
                    const pct = gap.coveragePercentage ?? 0;
                    const priorityColor = gap.priority?.toUpperCase() === "CRITICAL" ? "text-red-600 dark:text-red-400"
                      : gap.priority?.toUpperCase() === "HIGH" ? "text-red-500 dark:text-red-400"
                      : gap.priority?.toUpperCase() === "MEDIUM" ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400";
                    return (
                      <tr key={gap.id} className="border-b border-divider/50 last:border-0">
                        <td className="py-2 pr-4 mono text-xs">{truncate(gap.filePath, 40)}</td>
                        <td className="py-2 pr-4 mono text-xs">{gap.functionName}</td>
                        <td className="py-2 pr-4 text-xs tabular-nums text-default-500">{gap.lineNumber ?? "--"}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-default-100">
                              <div className={cn("absolute inset-y-0 left-0 rounded-full", pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="mono text-xs tabular-nums">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right text-xs tabular-nums">{gap.complexity ?? "--"}</td>
                        <td className="py-2">
                          <span className={cn("text-xs font-semibold capitalize", priorityColor)}>
                            {gap.priority?.toLowerCase() ?? "--"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ========== 7. Documentation Coverage ========== */}
      {state.docSummary && state.docSummary.totalFiles > 0 && (
        <Panel>
          <h2 className="text-sm font-semibold text-foreground">Documentation Coverage</h2>

          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-divider bg-default-100/30 p-3 text-center">
              <p className="text-2xl font-bold">{state.docSummary.coveragePercent.toFixed(1)}%</p>
              <p className="text-xs text-default-500">Documented</p>
            </div>
            <div className="rounded-md border border-divider bg-default-100/30 p-3 text-center">
              <p className="text-2xl font-bold">{state.docSummary.documented}</p>
              <p className="text-xs text-default-500">With Docs</p>
            </div>
            <div className="rounded-md border border-divider bg-default-100/30 p-3 text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{state.docSummary.undocumented}</p>
              <p className="text-xs text-default-500">Missing Docs</p>
            </div>
            <div className="rounded-md border border-divider bg-default-100/30 p-3 text-center">
              <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{state.docSummary.stale}</p>
              <p className="text-xs text-default-500">Stale Docs</p>
            </div>
          </div>

          {state.docEntries.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider">
                    <th className="pb-2 pr-4 font-medium">File</th>
                    <th className="pb-2 pr-4 font-medium">Function</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Framework</th>
                  </tr>
                </thead>
                <tbody>
                  {state.docEntries
                    .filter(e => !e.hasDocstring || e.isStale)
                    .slice(0, 50)
                    .map(entry => (
                      <tr key={entry.id} className="border-b border-divider/50 last:border-0">
                        <td className="py-2 pr-4 mono text-xs">{truncate(entry.filePath, 40)}</td>
                        <td className="py-2 pr-4 mono text-xs">{entry.functionName ?? "--"}</td>
                        <td className="py-2 pr-4">
                          {entry.isStale ? (
                            <Badge variant="warning">Stale</Badge>
                          ) : (
                            <Badge variant="destructive">Missing</Badge>
                          )}
                        </td>
                        <td className="py-2 text-xs text-default-500">{entry.docFramework ?? "--"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

export function ProjectCoveragePage() {
  return <ProjectPageShell>{(project) => <CoverageContent project={project} />}</ProjectPageShell>;
}
