import { Fragment, useEffect, useMemo, useState } from "react";
import { EmptyState, Panel } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type CoverageReport, type Project } from "../lib/api";
import { toDateTime, toNumber, toPercent, toPercentNumber, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";
import { ChevronDown, ChevronRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RunsState {
  loading: boolean;
  reports: CoverageReport[];
  expandedRunId: string | null;
  selectedPackageId: string | null;
  compareMode: boolean;
  compareSelection: [string, string | null];
  error: string | null;
}

interface RunGroup {
  runId: string;
  reports: CoverageReport[];
  createdAt: string;
  runMode: string;
  branch: string | null;
  commitSha: string | null;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  avgCoverage: number;
  llmModel: string | null;
  llmTotalTokens: number;
  executionTimeMs: number | null;
  executionEnvironment: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function groupByRunId(reports: CoverageReport[]): RunGroup[] {
  const groups = new Map<string, CoverageReport[]>();

  for (const report of reports) {
    const existing = groups.get(report.runId) ?? [];
    existing.push(report);
    groups.set(report.runId, existing);
  }

  return Array.from(groups.entries()).map(([runId, runReports]) => {
    const first = runReports[0];
    const totalTests = runReports.reduce((sum, r) => sum + r.testsGenerated, 0);
    const totalPassed = runReports.reduce((sum, r) => sum + r.testsPassed, 0);
    const totalFailed = runReports.reduce((sum, r) => sum + r.testsFailed, 0);
    const totalTokens = runReports.reduce((sum, r) => sum + (r.llmTotalTokens ?? 0), 0);

    const coverages = runReports
      .map(r => r.overallCoverage)
      .filter((c): c is number => c !== null);
    const avgCoverage = coverages.length > 0
      ? coverages.reduce((sum, c) => sum + c, 0) / coverages.length
      : 0;

    return {
      runId,
      reports: runReports,
      createdAt: first.createdAt,
      runMode: first.runMode,
      branch: first.branch,
      commitSha: first.commitSha,
      totalTests,
      totalPassed,
      totalFailed,
      avgCoverage,
      llmModel: first.llmModel,
      llmTotalTokens: totalTokens,
      executionTimeMs: first.executionTimeMs,
      executionEnvironment: first.executionEnvironment
    };
  });
}

function getUniquePackages(reports: CoverageReport[]): Array<{ id: string | null; label: string }> {
  const packages = new Set<string | null>();
  for (const report of reports) {
    packages.add(report.packageId);
  }

  return Array.from(packages).map(id => ({
    id,
    label: id ?? "root"
  }));
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function coverageColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function coverageTrackColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500/15";
  if (pct >= 50) return "bg-amber-500/15";
  return "bg-red-500/15";
}

function modeBadgeVariant(mode: string): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  const m = mode.toLowerCase();
  if (m === "pick") return "destructive";
  if (m === "watch") return "default";
  return "secondary";
}

/* ------------------------------------------------------------------ */
/*  Inline Coverage Bar                                                */
/* ------------------------------------------------------------------ */

function CoverageBar({ value }: { value: number | null }) {
  const pct = toPercentNumber(value);
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className={cn("h-2 w-full rounded-full", coverageTrackColor(pct))}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", coverageColor(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-medium w-12 text-right shrink-0">
        {toPercent(value)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Test Result Indicator                                              */
/* ------------------------------------------------------------------ */

function TestResult({ passed, total }: { passed: number; total: number }) {
  const allPassed = passed === total && total > 0;
  const hasFails = total > 0 && passed < total;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums">
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          allPassed && "bg-emerald-500",
          hasFails && "bg-red-500",
          total === 0 && "bg-default-500/40"
        )}
      />
      <span className={cn("font-medium", hasFails && "text-red-600 dark:text-red-400")}>
        {passed}/{total}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded Row Detail                                                */
/* ------------------------------------------------------------------ */

function RunDetail({ run }: { run: RunGroup }) {
  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="border-t border-divider bg-default-100/30">
          {/* Top detail strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-divider">
            <div className="bg-content1 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Run Mode</p>
              <p className="mt-0.5 text-sm font-semibold">{run.runMode}</p>
            </div>
            <div className="bg-content1 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Avg Coverage</p>
              <p className="mt-0.5 text-sm font-semibold">{toPercent(run.avgCoverage)}</p>
            </div>
            <div className="bg-content1 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Execution Time</p>
              <p className="mt-0.5 text-sm font-semibold">
                {run.executionTimeMs ? `${(run.executionTimeMs / 1000).toFixed(1)}s` : "n/a"}
              </p>
            </div>
            <div className="bg-content1 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Total Tests</p>
              <p className="mt-0.5 text-sm font-semibold">{toNumber(run.totalTests)}</p>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Git context + LLM usage side by side */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Git context */}
              <div className="rounded-lg border border-divider bg-content1 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-3">Git Context</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-default-500">Branch</span>
                    <code className="font-mono text-xs bg-default-100 px-2 py-0.5 rounded">
                      {run.branch ?? "n/a"}
                    </code>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-default-500">Commit</span>
                    <code className="font-mono text-xs bg-default-100 px-2 py-0.5 rounded">
                      {run.commitSha ? truncate(run.commitSha, 16) : "n/a"}
                    </code>
                  </div>
                </div>
              </div>

              {/* LLM usage */}
              <div className="rounded-lg border border-divider bg-content1 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-3">LLM Usage</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-default-500">Model</span>
                    <code className="font-mono text-xs bg-default-100 px-2 py-0.5 rounded">
                      {run.llmModel ?? "n/a"}
                    </code>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-default-500">Total Tokens</span>
                    <span className="font-semibold tabular-nums">{toNumber(run.llmTotalTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-default-500">Environment</span>
                    <span className="text-xs">{run.executionEnvironment ?? "n/a"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Package reports table */}
            <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
              <div className="px-4 py-3 border-b border-divider bg-default-100/40">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-default-500">
                  Package Reports ({run.reports.length})
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 bg-default-100/20">
                      <th className="px-4 py-2 font-medium">Package</th>
                      <th className="px-4 py-2 font-medium">Coverage</th>
                      <th className="px-4 py-2 font-medium">Tests</th>
                      <th className="px-4 py-2 font-medium">Passed</th>
                      <th className="px-4 py-2 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.reports.map((report) => (
                      <tr key={report.id} className="border-t border-divider/50">
                        <td className="px-4 py-2 font-mono text-xs">{report.packageId ?? "root"}</td>
                        <td className="px-4 py-2">
                          <CoverageBar value={report.overallCoverage} />
                        </td>
                        <td className="px-4 py-2 tabular-nums">{toNumber(report.testsGenerated)}</td>
                        <td className="px-4 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{toNumber(report.testsPassed)}</td>
                        <td className="px-4 py-2 tabular-nums text-red-600 dark:text-red-400">{toNumber(report.testsFailed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detailed LLM metrics table */}
            {run.reports.length > 0 && run.reports[0].llmProvider && (
              <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
                <div className="px-4 py-3 border-b border-divider bg-default-100/40">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-default-500">
                    Detailed LLM Metrics
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 bg-default-100/20">
                        <th className="px-4 py-2 font-medium">Package</th>
                        <th className="px-4 py-2 font-medium">Provider</th>
                        <th className="px-4 py-2 font-medium">Model</th>
                        <th className="px-4 py-2 font-medium">Prompt Tokens</th>
                        <th className="px-4 py-2 font-medium">Completion Tokens</th>
                        <th className="px-4 py-2 font-medium">Cost (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.reports.map((report) => (
                        <tr key={report.id} className="border-t border-divider/50">
                          <td className="px-4 py-2 font-mono text-xs">{report.packageId ?? "root"}</td>
                          <td className="px-4 py-2">{report.llmProvider ?? "n/a"}</td>
                          <td className="px-4 py-2 font-mono text-xs">{report.llmModel ?? "n/a"}</td>
                          <td className="px-4 py-2 tabular-nums">{toNumber(report.llmPromptTokens ?? 0)}</td>
                          <td className="px-4 py-2 tabular-nums">{toNumber(report.llmCompletionTokens ?? 0)}</td>
                          <td className="px-4 py-2 tabular-nums">${report.llmCostUsd?.toFixed(4) ?? "0.0000"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

function RunsContent(props: { project: Project }) {
  const [state, setState] = useState<RunsState>({
    loading: true,
    reports: [],
    expandedRunId: null,
    selectedPackageId: null,
    compareMode: false,
    compareSelection: [null as unknown as string, null],
    error: null
  });

  useEffect(() => {
    let active = true;

    async function load() {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const reportResponse = await api.reports.list({ projectId: props.project.id, limit: 200 });

        if (!active) {
          return;
        }

        setState((prev) => ({
          ...prev,
          loading: false,
          reports: reportResponse.reports,
          error: null
        }));
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof ApiError ? error.message : "Unable to load runs";
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [props.project.id]);

  const filteredReports = useMemo(() => {
    if (state.selectedPackageId === null) {
      return state.reports;
    }
    return state.reports.filter(r => r.packageId === state.selectedPackageId);
  }, [state.reports, state.selectedPackageId]);

  const runGroups = useMemo(() => groupByRunId(filteredReports), [filteredReports]);
  const packages = useMemo(() => getUniquePackages(state.reports), [state.reports]);

  const totalTests = useMemo(
    () => runGroups.reduce((sum, r) => sum + r.totalTests, 0),
    [runGroups]
  );

  const latestRunDate = useMemo(
    () => (runGroups.length > 0 ? toDateTime(runGroups[0].createdAt) : "n/a"),
    [runGroups]
  );

  function toggleExpand(runId: string) {
    setState(prev => ({
      ...prev,
      expandedRunId: prev.expandedRunId === runId ? null : runId
    }));
  }

  if (state.loading) {
    return <Panel><p className="text-sm text-default-500">Loading runs...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Runs data unavailable" body={state.error} />;
  }

  if (state.reports.length === 0) {
    return <EmptyState title="No runs" body="Upload a report via CLI or API to visualize runs." />;
  }

  return (
    <div className="space-y-6">
      {/* ---- Summary strip ---- */}
      <div className="flex items-center gap-6 rounded-lg border border-divider bg-content1 px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-default-500">Runs</span>
          <span className="font-semibold tabular-nums">{toNumber(runGroups.length)}</span>
        </div>
        <div className="h-4 w-px bg-divider" />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-default-500">Latest</span>
          <span className="font-medium text-xs">{latestRunDate}</span>
        </div>
        <div className="h-4 w-px bg-divider" />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-default-500">Total Tests</span>
          <span className="font-semibold tabular-nums">{toNumber(totalTests)}</span>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setState(prev => ({ ...prev, compareMode: !prev.compareMode, compareSelection: [null as unknown as string, null] }))}
            className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", state.compareMode ? "bg-primary text-primary-foreground" : "bg-default-200 text-foreground hover:bg-default-200/80")}
          >
            {state.compareMode ? "Exit Compare" : "Compare"}
          </button>
        </div>
      </div>

      {/* ---- Comparison Panel ---- */}
      {state.compareMode && state.compareSelection[0] && state.compareSelection[1] && (() => {
        const runA = runGroups.find(r => r.runId === state.compareSelection[0]);
        const runB = runGroups.find(r => r.runId === state.compareSelection[1]);
        if (!runA || !runB) return null;

        const covDelta = runB.avgCoverage - runA.avgCoverage;
        const testsDelta = runB.totalTests - runA.totalTests;
        const tokensDelta = runB.llmTotalTokens - runA.llmTotalTokens;

        const deltaColor = (d: number) => d > 0 ? "text-emerald-600 dark:text-emerald-400" : d < 0 ? "text-rose-600 dark:text-rose-400" : "text-default-500";
        const deltaSign = (d: number) => d > 0 ? "+" : "";

        return (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Run Comparison</h3>
              <button
                onClick={() => setState(prev => ({ ...prev, compareSelection: [null as unknown as string, null] }))}
                className="text-xs text-default-500 hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-default-500 mb-1">Coverage</p>
                <p className={cn("text-lg font-bold", deltaColor(covDelta))}>{deltaSign(covDelta)}{toPercent(covDelta)}</p>
              </div>
              <div>
                <p className="text-xs text-default-500 mb-1">Tests</p>
                <p className={cn("text-lg font-bold", deltaColor(testsDelta))}>{deltaSign(testsDelta)}{toNumber(testsDelta)}</p>
              </div>
              <div>
                <p className="text-xs text-default-500 mb-1">Tokens</p>
                <p className={cn("text-lg font-bold", deltaColor(-tokensDelta))}>{deltaSign(tokensDelta)}{toNumber(tokensDelta)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-content1 border border-divider p-2">
                <p className="text-default-500">Run A: <code className="font-mono">{truncate(runA.runId, 12)}</code></p>
                <p className="mt-0.5">{toDateTime(runA.createdAt)} — {toPercent(runA.avgCoverage)}</p>
              </div>
              <div className="rounded-md bg-content1 border border-divider p-2">
                <p className="text-default-500">Run B: <code className="font-mono">{truncate(runB.runId, 12)}</code></p>
                <p className="mt-0.5">{toDateTime(runB.createdAt)} — {toPercent(runB.avgCoverage)}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- Package filter pills ---- */}
      {packages.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-default-500 mr-1">Package:</span>
          <button
            onClick={() => setState(prev => ({ ...prev, selectedPackageId: null }))}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              state.selectedPackageId === null
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-default-200 text-foreground hover:bg-default-200/80"
            )}
          >
            All
          </button>
          {packages.map((pkg) => (
            <button
              key={pkg.id ?? "root"}
              onClick={() => setState(prev => ({ ...prev, selectedPackageId: pkg.id }))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                state.selectedPackageId === pkg.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-default-200 text-foreground hover:bg-default-200/80"
              )}
            >
              {pkg.label}
            </button>
          ))}
        </div>
      )}

      {/* ---- Data table ---- */}
      <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider bg-default-100/40">
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Run ID</th>
                <th className="px-3 py-3 font-medium">Mode</th>
                <th className="px-3 py-3 font-medium">Branch</th>
                <th className="px-3 py-3 font-medium min-w-[160px]">Coverage</th>
                <th className="px-3 py-3 font-medium">Tests</th>
                <th className="px-3 py-3 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {runGroups.map((run) => {
                const isExpanded = state.expandedRunId === run.runId;
                return (
                  <Fragment key={run.runId}>
                    <tr
                      onClick={() => toggleExpand(run.runId)}
                      className={cn(
                        "border-b border-divider/50 cursor-pointer transition-colors",
                        isExpanded
                          ? "bg-default-100/50"
                          : "hover:bg-default-100/30"
                      )}
                    >
                      {/* Chevron / Compare checkbox */}
                      <td className="px-3 py-3 text-default-500">
                        {state.compareMode ? (
                          <input
                            type="checkbox"
                            checked={state.compareSelection[0] === run.runId || state.compareSelection[1] === run.runId}
                            onChange={(e) => {
                              e.stopPropagation();
                              setState(prev => {
                                const sel = [...prev.compareSelection] as [string, string | null];
                                if (e.target.checked) {
                                  if (!sel[0]) sel[0] = run.runId;
                                  else if (!sel[1]) sel[1] = run.runId;
                                  else { sel[0] = sel[1]; sel[1] = run.runId; }
                                } else {
                                  if (sel[0] === run.runId) sel[0] = sel[1] ?? (null as unknown as string);
                                  if (sel[1] === run.runId) sel[1] = null;
                                }
                                return { ...prev, compareSelection: sel };
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-divider"
                          />
                        ) : isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-3 py-3 whitespace-nowrap text-xs">
                        {toDateTime(run.createdAt)}
                      </td>

                      {/* Run ID */}
                      <td className="px-3 py-3">
                        <code className="font-mono text-xs text-default-500">
                          {truncate(run.runId, 12)}
                        </code>
                      </td>

                      {/* Mode */}
                      <td className="px-3 py-3">
                        <Badge variant={modeBadgeVariant(run.runMode)}>
                          {run.runMode}
                        </Badge>
                      </td>

                      {/* Branch */}
                      <td className="px-3 py-3">
                        {run.branch ? (
                          <code className="font-mono text-xs bg-default-100 px-1.5 py-0.5 rounded">
                            {truncate(run.branch, 20)}
                          </code>
                        ) : (
                          <span className="text-xs text-default-500">--</span>
                        )}
                      </td>

                      {/* Coverage with inline bar */}
                      <td className="px-3 py-3">
                        <CoverageBar value={run.avgCoverage} />
                      </td>

                      {/* Tests pass/total */}
                      <td className="px-3 py-3">
                        <TestResult passed={run.totalPassed} total={run.totalTests} />
                      </td>

                      {/* Tokens */}
                      <td className="px-3 py-3 text-xs tabular-nums text-default-500">
                        {compactTokens(run.llmTotalTokens)}
                      </td>
                    </tr>

                    {/* Expanded detail panel */}
                    {isExpanded && <RunDetail run={run} />}
                  </Fragment>
                );
              })}

              {runGroups.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-default-500">
                    No runs match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                        */
/* ------------------------------------------------------------------ */

export function ProjectRunsPage() {
  return <ProjectPageShell>{(project) => <RunsContent project={project} />}</ProjectPageShell>;
}
