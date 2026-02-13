import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Panel } from "../components/ui";
import { api, ApiError, type CoverageReport, type MemoryApiResponse, type Project } from "../lib/api";
import { TICK_STYLE, TOOLTIP_STYLE } from "../lib/chart-styles";
import { toDateTime, toNumber, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { Brain, CheckCircle2, XCircle } from "lucide-react";
import { ProjectPageShell } from "./project-shared";

interface MemoryEntry {
  reportId: string;
  createdAt: string;
  patterns: string[];
  failedApproaches: string[];
}

interface MemoryState {
  loading: boolean;
  patterns: string[];
  failedApproaches: string[];
  snapshotCount: number;
  latestDate: string | null;
  growth: Array<{ date: string; memoryItems: number; cumulative: number }>;
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Legacy: parse memory from report blobs (fallback)                         */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function listFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMemoryFromReport(fullReport: unknown): { patterns: string[]; failedApproaches: string[] } {
  const root = asRecord(fullReport);
  if (!root) {
    return { patterns: [], failedApproaches: [] };
  }

  const memory = asRecord(root.memory) ?? asRecord(root.agentMemory) ?? root;

  const patterns = [
    ...listFromUnknown(memory?.learnedPatterns),
    ...listFromUnknown(memory?.patterns),
    ...listFromUnknown(memory?.wins)
  ];

  const failed = [
    ...listFromUnknown(memory?.failedApproaches),
    ...listFromUnknown(memory?.failures),
    ...listFromUnknown(memory?.dontRepeat)
  ];

  return {
    patterns: Array.from(new Set(patterns)),
    failedApproaches: Array.from(new Set(failed))
  };
}

async function loadLegacyMemory(projectId: string, reports: CoverageReport[]): Promise<MemoryEntry[]> {
  const targets = reports.slice(0, 12);

  return await Promise.all(
    targets.map(async (report) => {
      try {
        const detail = await api.reports.get(report.id, { includeFull: true });
        const parsed = parseMemoryFromReport(detail.fullReport);

        return {
          reportId: report.id,
          createdAt: report.createdAt,
          patterns: parsed.patterns,
          failedApproaches: parsed.failedApproaches
        };
      } catch {
        return {
          reportId: report.id,
          createdAt: report.createdAt,
          patterns: [],
          failedApproaches: []
        };
      }
    })
  );
}

/* -------------------------------------------------------------------------- */
/*  Load memory: prefer dedicated API, fall back to legacy                    */
/* -------------------------------------------------------------------------- */

async function loadMemoryState(project: Project): Promise<Omit<MemoryState, "loading">> {
  // Try dedicated memory API first
  try {
    const data: MemoryApiResponse = await api.memory.get(project.id);

    if (data.version > 0 && data.global) {
      const patterns = data.global.knownPatterns.map((p) => p.pattern);
      const failedApproaches = data.global.failedPatterns.map((p) => p.pattern);

      return {
        patterns: patterns.slice(0, 25),
        failedApproaches: failedApproaches.slice(0, 25),
        snapshotCount: 1,
        latestDate: null,
        growth: [],
        error: null
      };
    }
  } catch {
    // API not available or empty — fall through to legacy
  }

  // Legacy: parse from report blobs
  try {
    const reportsResponse = await api.reports.list({ projectId: project.id, limit: 60 });
    const entries = await loadLegacyMemory(project.id, reportsResponse.reports);

    const allPatterns = Array.from(new Set(entries.flatMap((e) => e.patterns))).slice(0, 25);
    const allFailures = Array.from(new Set(entries.flatMap((e) => e.failedApproaches))).slice(0, 25);

    const growth = [...entries]
      .reverse()
      .map((entry, index) => ({
        date: entry.createdAt.slice(0, 10),
        memoryItems: entry.patterns.length + entry.failedApproaches.length,
        cumulative: entries
          .slice(entries.length - index - 1)
          .reduce((sum, current) => sum + current.patterns.length + current.failedApproaches.length, 0)
      }));

    const latestSnapshot = entries[0];

    return {
      patterns: allPatterns,
      failedApproaches: allFailures,
      snapshotCount: entries.length,
      latestDate: latestSnapshot?.createdAt ?? null,
      growth,
      error: null
    };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Unable to load memory tab";
    return {
      patterns: [],
      failedApproaches: [],
      snapshotCount: 0,
      latestDate: null,
      growth: [],
      error: message
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Memory Content                                                            */
/* -------------------------------------------------------------------------- */

function MemoryContent(props: { project: Project }) {
  const [state, setState] = useState<MemoryState>({
    loading: true,
    patterns: [],
    failedApproaches: [],
    snapshotCount: 0,
    latestDate: null,
    growth: [],
    error: null
  });

  useEffect(() => {
    let active = true;

    async function load() {
      const result = await loadMemoryState(props.project);

      if (!active) {
        return;
      }

      setState({ loading: false, ...result });
    }

    void load();

    return () => {
      active = false;
    };
  }, [props.project.id]);

  if (state.loading) {
    return <Panel><p className="text-sm text-muted-foreground">Loading memory tab...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Memory tab unavailable" body={state.error} />;
  }

  return (
    <div className="space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/*  Explanation Card                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[hsl(var(--chart-2)/0.06)] via-[hsl(var(--card))] to-[hsl(var(--chart-4)/0.06)]">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[hsl(var(--chart-2)/0.06)] blur-3xl" />
        <div className="relative flex items-start gap-5 p-6 md:p-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--chart-2)/0.12)]">
            <Brain className="h-6 w-6 text-[hsl(var(--chart-2))]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Project Memory
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Project Memory tracks patterns and lessons learned across your test runs.{" "}
              <span className="text-foreground/80 font-medium">nit</span> extracts what worked and
              what failed from each run, building a knowledge base that improves over time.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--chart-2))]" />
                <span className="font-medium text-foreground tabular-nums">{toNumber(state.snapshotCount)}</span>{" "}
                snapshots analyzed
              </span>
              {state.latestDate ? (
                <span className="text-muted-foreground">
                  Latest: <span className="font-medium text-foreground">{toDateTime(state.latestDate)}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/*  Two-Column: Patterns vs Failures                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* LEFT -- Learned Patterns */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              Learned Patterns
            </h3>
            <span className="ml-auto rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {state.patterns.length}
            </span>
          </div>

          <div className="space-y-2">
            {state.patterns.length > 0 ? (
              state.patterns.map((pattern, idx) => (
                <div
                  key={pattern}
                  className={cn(
                    "group relative rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-3 text-sm leading-relaxed text-foreground/90 transition-colors hover:bg-emerald-500/[0.08]",
                    idx === 0 && "animate-fade-slide"
                  )}
                >
                  <span className="absolute left-4 top-3 mr-3 text-emerald-500/50 text-xs font-mono select-none">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="ml-7 block">{truncate(pattern, 220)}</span>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No learned patterns present in reports yet.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT -- Failed Approaches */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10">
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              Failed Approaches
            </h3>
            <span className="ml-auto rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">
              {state.failedApproaches.length}
            </span>
          </div>

          <div className="space-y-2">
            {state.failedApproaches.length > 0 ? (
              state.failedApproaches.map((failure, idx) => (
                <div
                  key={failure}
                  className={cn(
                    "group relative rounded-lg border border-red-500/15 bg-red-500/[0.04] px-4 py-3 text-sm leading-relaxed text-foreground/90 transition-colors hover:bg-red-500/[0.08]",
                    idx === 0 && "animate-fade-slide"
                  )}
                >
                  <span className="absolute left-4 top-3 mr-3 text-red-500/50 text-xs font-mono select-none">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="ml-7 block">{truncate(failure, 220)}</span>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No failed approach notes present in reports yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/*  Growth Chart (only shown for legacy mode with multiple snapshots)  */}
      {/* ------------------------------------------------------------------ */}
      {state.growth.length > 0 ? (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Knowledge Growth</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cumulative memory items extracted over time
              </p>
            </div>
            <span className="rounded-md bg-[hsl(var(--chart-2)/0.1)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--chart-2))]">
              {toNumber(state.growth[state.growth.length - 1]?.cumulative ?? 0)} total
            </span>
          </div>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={state.growth}>
                <defs>
                  <linearGradient id="memoryGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={TICK_STYLE} />
                <YAxis tick={TICK_STYLE} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  fill="url(#memoryGrowthGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

export function ProjectMemoryPage() {
  return <ProjectPageShell>{(project) => <MemoryContent project={project} />}</ProjectPageShell>;
}
