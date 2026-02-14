import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, EmptyState, Gauge, Panel } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type DriftResult, type DriftTimelinePoint, type Project } from "../lib/api";
import { TICK_STYLE, TOOLTIP_STYLE } from "../lib/chart-styles";
import { toDateTime, truncate } from "../lib/format";
import { readStoredJson, writeStoredJson } from "../lib/storage";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";

/* ---------- types ---------- */

interface DriftState {
  loading: boolean;
  results: DriftResult[];
  timeline: DriftTimelinePoint[];
  error: string | null;
}

type BaselineState = Record<string, string>;

/* ---------- inline components ---------- */

function StatusBanner(props: {
  driftedCount: number;
  errorCount: number;
  avgSimilarity: number;
}) {
  const isClean = props.driftedCount === 0 && props.errorCount === 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-5",
        isClean
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-rose-500/30 bg-rose-500/5"
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: status message */}
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              isClean
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
            )}
          >
            {isClean ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            )}
          </div>

          <div>
            <h2 className={cn(
              "text-base font-semibold",
              isClean
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-rose-700 dark:text-rose-300"
            )}>
              {isClean
                ? "All tests stable"
                : `${props.driftedCount} test${props.driftedCount !== 1 ? "s" : ""} drifted`}
            </h2>
            {!isClean && props.errorCount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {props.errorCount} error{props.errorCount !== 1 ? "s" : ""} detected
              </p>
            )}
          </div>
        </div>

        {/* Right: similarity gauge */}
        <Gauge value={props.avgSimilarity} label="Avg similarity" size={90} />
      </div>
    </div>
  );
}

function SimilarityBar(props: { value: number | null }) {
  if (props.value === null) {
    return <span className="text-xs text-default-500">--</span>;
  }

  const pct = Math.max(0, Math.min(100, props.value * 100));
  const barColor =
    pct >= 90
      ? "bg-emerald-500"
      : pct >= 70
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-default-100">
        <div
          className={cn("h-full rounded-full transition-all duration-300", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="mono text-[11px] tabular-nums text-default-500">{pct.toFixed(0)}%</span>
    </div>
  );
}

function DriftStatusBadge(props: { status: string }) {
  switch (props.status) {
    case "stable":
      return <Badge variant="success">stable</Badge>;
    case "drifted":
      return <Badge variant="destructive">drifted</Badge>;
    case "error":
      return <Badge variant="warning">error</Badge>;
    default:
      return <Badge variant="secondary">{props.status}</Badge>;
  }
}

/* ---------- collapsible alert log ---------- */

function AlertLog(props: { alerts: DriftResult[] }) {
  const [expanded, setExpanded] = useState(false);

  if (props.alerts.length === 0) {
    return null;
  }

  const displayed = expanded ? props.alerts.slice(0, 50) : props.alerts.slice(0, 5);

  return (
    <Panel>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Alert history</h2>
          <span className="rounded-full bg-default-100 px-2 py-0.5 text-[11px] font-medium text-default-500 tabular-nums">
            {props.alerts.length}
          </span>
        </div>
        <svg
          viewBox="0 0 24 24"
          className={cn("h-4 w-4 text-default-500 transition-transform duration-200", expanded && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div className={cn("mt-3 space-y-0 overflow-hidden transition-all duration-300", !expanded && "max-h-[260px]")}>
        {displayed.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 border-b border-divider/50 py-2.5 last:border-0"
          >
            {/* Dot indicator */}
            <div
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                item.status === "drifted"
                  ? "bg-rose-500"
                  : item.status === "error"
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{item.testName}</p>
                <span className="shrink-0 text-[11px] tabular-nums text-default-500">
                  {toDateTime(item.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-default-500 leading-relaxed">
                {truncate(item.details, 140) || "No details attached"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {props.alerts.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : `Show all ${props.alerts.length} alerts`}
        </button>
      )}
    </Panel>
  );
}

/* ---------- main content ---------- */

function DriftContent(props: { project: Project }) {
  const storageKey = `nit:drift:baselines:${props.project.id}`;
  const [state, setState] = useState<DriftState>({
    loading: true,
    results: [],
    timeline: [],
    error: null
  });
  const [baselines, setBaselines] = useState<BaselineState>(() => readStoredJson<BaselineState>(storageKey, {}));

  useEffect(() => {
    writeStoredJson(storageKey, baselines);
  }, [baselines, storageKey]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [list, timeline] = await Promise.all([
          api.drift.list({ projectId: props.project.id, limit: 300 }),
          api.drift.timeline({ projectId: props.project.id, days: 90 })
        ]);

        if (!active) {
          return;
        }

        setState({
          loading: false,
          results: list.results,
          timeline: timeline.timeline,
          error: null
        });
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof ApiError ? error.message : "Unable to load drift data";
        setState({ loading: false, results: [], timeline: [], error: message });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [props.project.id]);

  const drifted = useMemo(() => state.results.filter((item) => item.status === "drifted"), [state.results]);
  const failed = useMemo(() => state.results.filter((item) => item.status === "error"), [state.results]);
  const avgSimilarity = useMemo(() => {
    const scored = state.results.filter((item) => item.similarityScore !== null);
    if (scored.length === 0) {
      return 0;
    }

    return (scored.reduce((acc, item) => acc + Number(item.similarityScore ?? 0), 0) / scored.length) * 100;
  }, [state.results]);

  const similarityTrend = useMemo(
    () => [...state.results]
      .reverse()
      .filter((item) => item.similarityScore !== null)
      .map((item) => ({
        date: item.createdAt.slice(0, 10),
        similarity: Number(item.similarityScore) * 100
      })),
    [state.results]
  );

  const latestPerTest = useMemo(() => {
    const map = new Map<string, DriftResult>();

    for (const item of state.results) {
      if (!map.has(item.testName)) {
        map.set(item.testName, item);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.testName.localeCompare(b.testName));
  }, [state.results]);

  function acceptBaseline(testName: string) {
    setBaselines((previous) => ({
      ...previous,
      [testName]: new Date().toISOString()
    }));
  }

  const alertItems = useMemo(
    () => [...drifted, ...failed].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [drifted, failed]
  );

  if (state.loading) {
    return <Panel><p className="text-sm text-default-500">Loading drift timeline...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Drift tab unavailable" body={state.error} />;
  }

  return (
    <div className="space-y-6">
      {/* ========== 1. Status Banner ========== */}
      <StatusBanner
        driftedCount={drifted.length}
        errorCount={failed.length}
        avgSimilarity={avgSimilarity}
      />

      {/* ========== 2. Two-Column Charts ========== */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Drift timeline bar chart */}
        <Panel>
          <h2 className="text-sm font-semibold text-foreground">Drift timeline</h2>
          <p className="mt-0.5 text-xs text-default-500">Total vs drifted checks per day</p>
          <div className="mt-4 h-64">
            {state.timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={state.timeline} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-default-300))" />
                  <XAxis dataKey="date" tick={TICK_STYLE} />
                  <YAxis tick={TICK_STYLE} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar
                    dataKey="total"
                    name="Total"
                    fill="hsl(var(--chart-1) / 0.4)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="drifted"
                    name="Drifted"
                    fill="hsl(346 77% 50% / 0.65)"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-default-500">
                No drift checks recorded yet.
              </div>
            )}
          </div>
        </Panel>

        {/* Right: Similarity score trend line chart */}
        <Panel>
          <h2 className="text-sm font-semibold text-foreground">Similarity score trend</h2>
          <p className="mt-0.5 text-xs text-default-500">Per-check similarity over time</p>
          <div className="mt-4 h-64">
            {similarityTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={similarityTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-default-300))" />
                  <XAxis dataKey="date" tick={TICK_STYLE} />
                  <YAxis domain={[0, 100]} tick={TICK_STYLE} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => [`${Number(value).toFixed(1)}%`, "Similarity"]}
                  />
                  <Line
                    dataKey="similarity"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-default-500">
                No similarity score samples available.
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ========== 3. Test Status Table ========== */}
      <Panel>
        <h2 className="text-sm font-semibold text-foreground">Test status</h2>
        <p className="mt-0.5 text-xs text-default-500">
          Latest result per test with baseline management
        </p>

        {latestPerTest.length === 0 ? (
          <p className="mt-4 text-sm text-default-500">No drift tests available.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider">
                  <th className="pb-2 pr-4 font-medium">Test name</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Similarity</th>
                  <th className="pb-2 pr-4 font-medium">Last checked</th>
                  <th className="pb-2 font-medium text-right">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {latestPerTest.map((item) => {
                  const hasBaseline = Boolean(baselines[item.testName]);

                  return (
                    <tr
                      key={item.testName}
                      className={cn(
                        "border-b border-divider/50 last:border-0 transition-colors",
                        item.status === "drifted" && "bg-rose-500/[0.03]",
                        item.status === "error" && "bg-amber-500/[0.03]"
                      )}
                    >
                      <td className="py-2.5 pr-4">
                        <div>
                          <p className="font-medium text-foreground">{item.testName}</p>
                          {hasBaseline && (
                            <p className="text-[11px] text-default-500">
                              Baseline: {toDateTime(baselines[item.testName])}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <DriftStatusBadge status={item.status} />
                      </td>
                      <td className="py-2.5 pr-4">
                        <SimilarityBar value={item.similarityScore} />
                      </td>
                      <td className="py-2.5 pr-4 text-xs tabular-nums text-default-500">
                        {toDateTime(item.createdAt)}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          kind="secondary"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => acceptBaseline(item.testName)}
                        >
                          Accept baseline
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ========== 4. Alert History (collapsible log) ========== */}
      <AlertLog alerts={alertItems} />
    </div>
  );
}

export function ProjectDriftPage() {
  return <ProjectPageShell>{(project) => <DriftContent project={project} />}</ProjectPageShell>;
}
