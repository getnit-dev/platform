import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Gauge, Panel } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type Bug, type Project } from "../lib/api";
import { groupByDate, toDateTime, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";
import { AlertTriangle, CheckCircle2, Bug as BugIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--card))",
  color: "hsl(var(--card-foreground))",
};

const TICK_STYLE = { fill: "hsl(var(--muted-foreground))", fontSize: 12 };

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

const SEVERITY_CONFIG: Record<string, {
  label: string;
  barColor: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  headerBg: string;
}> = {
  critical: {
    label: "Critical",
    barColor: "bg-red-600",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    textColor: "text-red-600 dark:text-red-400",
    headerBg: "bg-red-500/10 border-red-500/20",
  },
  high: {
    label: "High",
    barColor: "bg-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    textColor: "text-red-600 dark:text-red-400",
    headerBg: "bg-red-500/10 border-red-500/20",
  },
  medium: {
    label: "Medium",
    barColor: "bg-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    textColor: "text-amber-600 dark:text-amber-400",
    headerBg: "bg-amber-500/10 border-amber-500/20",
  },
  low: {
    label: "Low",
    barColor: "bg-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    textColor: "text-emerald-600 dark:text-emerald-400",
    headerBg: "bg-emerald-500/10 border-emerald-500/20",
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface BugsState {
  loading: boolean;
  bugs: Bug[];
  error: string | null;
}



function getSeverityConfig(severity: string) {
  return SEVERITY_CONFIG[severity.toLowerCase()] ?? SEVERITY_CONFIG.low;
}

function countBySeverity(bugs: Bug[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bug of bugs) {
    const key = bug.severity.toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/*  Severity Breakdown Bar (like GitHub's language bar)                 */
/* ------------------------------------------------------------------ */

function SeverityBreakdownBar({ bugs }: { bugs: Bug[] }) {
  const counts = countBySeverity(bugs);
  const total = bugs.length;

  if (total === 0) return null;

  const segments = SEVERITY_ORDER
    .filter(sev => (counts[sev] ?? 0) > 0)
    .map(sev => ({
      severity: sev,
      count: counts[sev] ?? 0,
      pct: ((counts[sev] ?? 0) / total) * 100,
      config: getSeverityConfig(sev),
    }));

  return (
    <div className="space-y-2.5">
      {/* The stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg, i) => (
          <div
            key={seg.severity}
            className={cn(
              seg.config.barColor,
              "h-full transition-all duration-500",
              i === 0 && "rounded-l-full",
              i === segments.length - 1 && "rounded-r-full"
            )}
            style={{ width: `${seg.pct}%` }}
            title={`${seg.config.label}: ${seg.count} (${seg.pct.toFixed(1)}%)`}
          />
        ))}
      </div>

      {/* Legend below */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {segments.map((seg) => (
          <div key={seg.severity} className="flex items-center gap-1.5 text-xs">
            <span className={cn("h-2.5 w-2.5 rounded-sm shrink-0", seg.config.barColor)} />
            <span className="text-muted-foreground">{seg.config.label}</span>
            <span className="font-semibold tabular-nums">{seg.count}</span>
            <span className="text-muted-foreground">({seg.pct.toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Open vs Resolved — big numbers with ratio bar                      */
/* ------------------------------------------------------------------ */

function OpenResolvedSplit({ openCount, resolvedCount }: { openCount: number; resolvedCount: number }) {
  const total = openCount + resolvedCount;
  const openPct = total > 0 ? (openCount / total) * 100 : 50;
  const resolvedPct = total > 0 ? (resolvedCount / total) * 100 : 50;

  return (
    <div className="flex items-stretch gap-0">
      {/* Open side */}
      <div className="flex-1 flex flex-col items-center justify-center py-4">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-wider">Open</span>
        </div>
        <p className="mt-1.5 text-4xl font-bold tabular-nums">{openCount}</p>
      </div>

      {/* Ratio divider bar */}
      <div className="flex flex-col items-center justify-center w-16 py-3">
        <div className="flex flex-col h-full w-2.5 rounded-full overflow-hidden bg-muted">
          <div
            className="bg-amber-500 transition-all duration-500 w-full"
            style={{ height: `${openPct}%` }}
          />
          <div
            className="bg-emerald-500 transition-all duration-500 w-full"
            style={{ height: `${resolvedPct}%` }}
          />
        </div>
      </div>

      {/* Resolved side */}
      <div className="flex-1 flex flex-col items-center justify-center py-4">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-wider">Resolved</span>
        </div>
        <p className="mt-1.5 text-4xl font-bold tabular-nums">{resolvedCount}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bug Row (compact)                                                  */
/* ------------------------------------------------------------------ */

function BugRow({
  bug,
  onMarkFixed,
  isUpdating,
}: {
  bug: Bug;
  onMarkFixed: (id: string) => void;
  isUpdating: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
      {/* Description + file path */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{truncate(bug.description, 100)}</p>
        <p className="font-mono text-[11px] text-muted-foreground truncate mt-0.5">{bug.filePath}</p>
      </div>

      {/* Status badge */}
      <Badge
        variant={bug.status === "open" ? "warning" : "success"}
        className="shrink-0"
      >
        {bug.status}
      </Badge>

      {/* Date */}
      <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 hidden md:block">
        {toDateTime(bug.createdAt)}
      </span>

      {/* Action buttons inline */}
      <div className="flex items-center gap-2 shrink-0">
        {bug.githubIssueUrl && (
          <a
            className="text-xs text-primary hover:underline"
            href={bug.githubIssueUrl}
            target="_blank"
            rel="noreferrer"
          >
            Issue
          </a>
        )}
        {bug.githubPrUrl && (
          <a
            className="text-xs text-primary hover:underline"
            href={bug.githubPrUrl}
            target="_blank"
            rel="noreferrer"
          >
            PR
          </a>
        )}
        {bug.status === "open" && (
          <button
            onClick={() => onMarkFixed(bug.id)}
            disabled={isUpdating}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isUpdating ? "Saving..." : "Mark fixed"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Severity Group                                                     */
/* ------------------------------------------------------------------ */

function SeverityGroup({
  severity,
  bugs,
  onMarkFixed,
  updatingId,
}: {
  severity: string;
  bugs: Bug[];
  onMarkFixed: (id: string) => void;
  updatingId: string | null;
}) {
  const config = getSeverityConfig(severity);

  if (bugs.length === 0) return null;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Colored group header */}
      <div className={cn("flex items-center justify-between px-4 py-2.5 border-b", config.headerBg)}>
        <div className="flex items-center gap-2">
          <BugIcon className={cn("h-4 w-4", config.textColor)} />
          <span className={cn("text-sm font-semibold", config.textColor)}>{config.label}</span>
        </div>
        <span className={cn("text-xs font-medium tabular-nums", config.textColor)}>
          {bugs.length} {bugs.length === 1 ? "bug" : "bugs"}
        </span>
      </div>

      {/* Bug rows */}
      <div className="bg-card">
        {bugs.map((bug) => (
          <BugRow
            key={bug.id}
            bug={bug}
            onMarkFixed={onMarkFixed}
            isUpdating={updatingId === bug.id}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

function BugsContent(props: { project: Project }) {
  const [state, setState] = useState<BugsState>({ loading: true, bugs: [], error: null });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    try {
      const response = await api.bugs.list({ projectId: props.project.id, limit: 500 });
      setState({ loading: false, bugs: response.bugs, error: null });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to load bug metrics";
      setState({ loading: false, bugs: [], error: message });
    }
  }

  useEffect(() => {
    void load();
  }, [props.project.id]);

  const openBugs = useMemo(() => state.bugs.filter((bug) => bug.status === "open"), [state.bugs]);
  const fixedBugs = useMemo(
    () => state.bugs.filter((bug) => ["fixed", "wont_fix", "false_positive"].includes(bug.status)),
    [state.bugs]
  );

  const fixRate = useMemo(() => {
    if (state.bugs.length === 0) {
      return 0;
    }

    return (fixedBugs.length / state.bugs.length) * 100;
  }, [fixedBugs.length, state.bugs.length]);

  const timeline = useMemo(
    () => groupByDate(state.bugs, (bug) => bug.createdAt),
    [state.bugs]
  );

  // Group open bugs by severity
  const bugsBySeverity = useMemo(() => {
    const groups: Record<string, Bug[]> = {};
    for (const sev of SEVERITY_ORDER) {
      groups[sev] = [];
    }
    for (const bug of openBugs) {
      const key = bug.severity.toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(bug);
    }
    return groups;
  }, [openBugs]);

  async function markAsFixed(bugId: string) {
    setUpdatingId(bugId);

    try {
      await api.bugs.update(bugId, { status: "fixed" });
      await load();
    } finally {
      setUpdatingId(null);
    }
  }

  if (state.loading) {
    return <Panel><p className="text-sm text-muted-foreground">Loading bug analytics...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Bug tab unavailable" body={state.error} />;
  }

  return (
    <div className="space-y-5">
      {/* ---- Severity breakdown bar ---- */}
      {state.bugs.length > 0 && (
        <Panel>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Severity Distribution
          </h2>
          <SeverityBreakdownBar bugs={state.bugs} />
        </Panel>
      )}

      {/* ---- Open vs Resolved + Fix Rate ---- */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        {/* Split open/resolved */}
        <div className="rounded-lg border border-border bg-card">
          <OpenResolvedSplit openCount={openBugs.length} resolvedCount={fixedBugs.length} />
        </div>

        {/* Fix rate as circular gauge */}
        <div className="rounded-lg border border-border bg-card flex items-center justify-center px-8 py-4">
          <Gauge value={fixRate} label="Fix Rate" size={110} />
        </div>
      </div>

      {/* ---- Bug list grouped by severity ---- */}
      {openBugs.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
            <p className="text-sm font-medium">No open bugs</p>
            <p className="text-xs text-muted-foreground mt-1">All discovered bugs in this project have been resolved.</p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          {SEVERITY_ORDER.map((sev) => (
            <SeverityGroup
              key={sev}
              severity={sev}
              bugs={bugsBySeverity[sev] ?? []}
              onMarkFixed={markAsFixed}
              updatingId={updatingId}
            />
          ))}
        </div>
      )}

      {/* ---- Discovery Timeline ---- */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Discovery Timeline
          </h2>
        </div>
        <div className="p-5">
          <div className="h-56">
            {timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline}>
                  <defs>
                    <linearGradient id="bugAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-4))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--chart-4))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--chart-4))"
                    strokeWidth={2}
                    fill="url(#bugAreaGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                No bugs discovered yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                        */
/* ------------------------------------------------------------------ */

export function ProjectBugsPage() {
  return <ProjectPageShell>{(project) => <BugsContent project={project} />}</ProjectPageShell>;
}
