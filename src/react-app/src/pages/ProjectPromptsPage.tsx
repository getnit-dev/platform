import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Gauge, Panel } from "../components/ui";
import { Badge } from "../components/ui/badge";
import {
  api,
  ApiError,
  type Project,
  type PromptRecord,
  type PromptAnalyticsSummary
} from "../lib/api";
import { TICK_STYLE, TOOLTIP_STYLE } from "../lib/chart-styles";
import { toDateTime, toNumber, truncate, groupByDate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Layers,
  MessageSquare,
  GitCompare,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Outcome badge helper                                               */
/* ------------------------------------------------------------------ */

const OUTCOME_CONFIG: Record<string, { variant: "success" | "destructive" | "warning" | "secondary"; label: string }> = {
  success: { variant: "success", label: "Success" },
  error: { variant: "destructive", label: "Error" },
  validation_failed: { variant: "warning", label: "Validation Failed" },
  partial: { variant: "warning", label: "Partial" },
  timeout: { variant: "destructive", label: "Timeout" },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const config = OUTCOME_CONFIG[outcome.toLowerCase()] ?? { variant: "secondary" as const, label: outcome };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "\u2014";
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function safeParseJson<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

interface PromptsState {
  loading: boolean;
  records: PromptRecord[];
  analytics: PromptAnalyticsSummary | null;
  error: string | null;
}

interface MessageEntry {
  role: string;
  content: string;
}

/* ------------------------------------------------------------------ */
/*  Analytics stat cards                                               */
/* ------------------------------------------------------------------ */

function AnalyticsHero({ analytics }: { analytics: PromptAnalyticsSummary }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-divider bg-gradient-to-r from-[hsl(var(--heroui-content1))] to-[hsl(var(--chart-2)/0.04)]">
      <div className="absolute -left-20 -top-20 h-56 w-56 rounded-full bg-[hsl(var(--chart-2)/0.05)] blur-3xl" />
      <div className="absolute -right-16 -bottom-16 h-40 w-40 rounded-full bg-[hsl(var(--chart-3)/0.05)] blur-3xl" />

      <div className="relative flex flex-col gap-8 p-6 md:flex-row md:items-center md:p-8">
        {/* Big total count */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--chart-2)/0.12)]">
              <MessageSquare className="h-5 w-5 text-[hsl(var(--chart-2))]" />
            </div>
            <span className="text-sm font-medium text-default-500">Total Prompts</span>
          </div>
          <p className="mt-3 text-5xl font-bold tracking-tight text-foreground tabular-nums">
            {toNumber(analytics.totalPrompts)}
          </p>

          {/* Supporting numbers */}
          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[hsl(var(--chart-3))]" />
              <div>
                <p className="text-xs text-default-500">Total Tokens</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">{toNumber(analytics.totalTokens)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[hsl(var(--chart-4))]" />
              <div>
                <p className="text-xs text-default-500">Avg Duration</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">{formatDuration(analytics.avgDurationMs)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Success rate gauge */}
        <div className="flex items-center justify-center px-4">
          <Gauge value={analytics.successRate * 100} label="Success Rate" size={120} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Breakdown tables                                                   */
/* ------------------------------------------------------------------ */

function BreakdownTable({
  title,
  subtitle,
  icon,
  data,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  data: Record<string, { count: number; successRate: number; avgTokens: number }>;
}) {
  const rows = useMemo(
    () =>
      Object.entries(data)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.count - a.count),
    [data]
  );

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="text-xs text-default-500 mb-4">{subtitle}</p>

      {rows.length > 0 ? (
        <div className="overflow-auto max-h-80">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-default-500">
                <th className="pb-3 pr-4 font-medium">Name</th>
                <th className="pb-3 pr-4 font-medium text-right">Requests</th>
                <th className="pb-3 pr-4 font-medium text-right">Success Rate</th>
                <th className="pb-3 font-medium text-right">Avg Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider/50">
              {rows.map((row) => (
                <tr key={row.name} className="group transition-colors hover:bg-default-100/30">
                  <td className="py-2.5 pr-4 font-mono text-xs">{truncate(row.name, 40)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{toNumber(row.count)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    <span
                      className={cn(
                        "font-medium",
                        row.successRate >= 0.9
                          ? "text-emerald-600 dark:text-emerald-400"
                          : row.successRate >= 0.7
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {(row.successRate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-default-500">{toNumber(row.avgTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid h-32 place-items-center text-sm text-default-500">No data available.</div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded prompt detail                                             */
/* ------------------------------------------------------------------ */

function PromptDetail({ record }: { record: PromptRecord }) {
  const messages = safeParseJson<MessageEntry[]>(record.messages);
  const metadata = safeParseJson<Record<string, unknown>>(record.metadata);

  return (
    <div className="space-y-4 px-4 pb-4">
      {/* Lineage info */}
      <div className="rounded-lg border border-divider bg-default-100/30 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-3">Lineage</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          {record.sourceFile && (
            <div>
              <p className="text-[11px] text-default-400">Source File</p>
              <p className="font-mono text-xs truncate" title={record.sourceFile}>{record.sourceFile}</p>
            </div>
          )}
          {record.templateName && (
            <div>
              <p className="text-[11px] text-default-400">Template</p>
              <p className="font-mono text-xs">{record.templateName}</p>
            </div>
          )}
          {record.builderName && (
            <div>
              <p className="text-[11px] text-default-400">Builder</p>
              <p className="font-mono text-xs">{record.builderName}</p>
            </div>
          )}
          {record.framework && (
            <div>
              <p className="text-[11px] text-default-400">Framework</p>
              <p className="font-mono text-xs">{record.framework}</p>
            </div>
          )}
          {record.sessionId && (
            <div>
              <p className="text-[11px] text-default-400">Session</p>
              <p className="font-mono text-xs">{shortId(record.sessionId)}</p>
            </div>
          )}
          {record.temperature !== null && (
            <div>
              <p className="text-[11px] text-default-400">Temperature</p>
              <p className="font-mono text-xs">{record.temperature}</p>
            </div>
          )}
          {record.maxTokens !== null && (
            <div>
              <p className="text-[11px] text-default-400">Max Tokens</p>
              <p className="font-mono text-xs">{toNumber(record.maxTokens)}</p>
            </div>
          )}
          {record.validationAttempts > 0 && (
            <div>
              <p className="text-[11px] text-default-400">Validation Attempts</p>
              <p className="font-mono text-xs">{record.validationAttempts}</p>
            </div>
          )}
        </div>
      </div>

      {/* Token breakdown */}
      <div className="rounded-lg border border-divider bg-default-100/30 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-3">Token Breakdown</h3>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-[11px] text-default-400">Prompt</p>
            <p className="text-sm font-semibold tabular-nums">{toNumber(record.promptTokens)}</p>
          </div>
          <div>
            <p className="text-[11px] text-default-400">Completion</p>
            <p className="text-sm font-semibold tabular-nums">{toNumber(record.completionTokens)}</p>
          </div>
          <div>
            <p className="text-[11px] text-default-400">Context</p>
            <p className="text-sm font-semibold tabular-nums">{toNumber(record.contextTokens)}</p>
          </div>
          <div>
            <p className="text-[11px] text-default-400">Total</p>
            <p className="text-sm font-semibold tabular-nums">{toNumber(record.totalTokens)}</p>
          </div>
          <div>
            <p className="text-[11px] text-default-400">Duration</p>
            <p className="text-sm font-semibold tabular-nums">{formatDuration(record.durationMs)}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      {messages && messages.length > 0 && (
        <div className="rounded-lg border border-divider overflow-hidden">
          <div className="px-4 py-2.5 border-b border-divider bg-default-100/30">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-default-500">
              Messages ({messages.length})
            </h3>
          </div>
          <div className="divide-y divide-divider/40">
            {messages.map((msg, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge
                    variant={
                      msg.role === "system"
                        ? "secondary"
                        : msg.role === "assistant"
                          ? "success"
                          : "default"
                    }
                    className="text-[10px]"
                  >
                    {msg.role}
                  </Badge>
                </div>
                <pre className="rounded-md bg-default-200/50 px-3 py-2 text-xs overflow-x-auto font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {msg.content}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response text */}
      {record.responseText && (
        <div className="rounded-lg border border-divider overflow-hidden">
          <div className="px-4 py-2.5 border-b border-divider bg-default-100/30">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-default-500">Response</h3>
          </div>
          <div className="p-4">
            <pre className="rounded-md bg-default-200/50 px-3 py-2 text-xs overflow-x-auto font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
              {record.responseText}
            </pre>
          </div>
        </div>
      )}

      {/* Error message */}
      {record.errorMessage && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="h-4 w-4 text-red-500" />
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">Error</p>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap text-default-500">{record.errorMessage}</pre>
        </div>
      )}

      {/* Metadata */}
      {metadata && Object.keys(metadata).length > 0 && (
        <div className="rounded-lg border border-divider bg-default-100/30 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-2">Metadata</h3>
          <pre className="rounded-md bg-default-200/50 px-3 py-2 text-xs overflow-x-auto font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </div>
      )}

      {/* Comparison group link */}
      {record.comparisonGroupId && (
        <div className="rounded-lg border border-divider bg-default-100/30 p-4">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-default-500" />
            <p className="text-xs font-medium text-default-500">
              Comparison Group: <span className="font-mono">{shortId(record.comparisonGroupId)}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Prompt row                                                         */
/* ------------------------------------------------------------------ */

function PromptRow({ record }: { record: PromptRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-divider/40 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-default-100/30 transition-colors text-left"
      >
        {/* Expand icon */}
        <span className="text-default-500 shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        {/* ID */}
        <span className="font-mono text-[11px] text-default-500 shrink-0 w-16">{shortId(record.id)}</span>

        {/* Timestamp */}
        <span className="text-[11px] text-default-500 whitespace-nowrap shrink-0 hidden lg:block w-36">
          {toDateTime(record.createdAt)}
        </span>

        {/* Model */}
        <span className="font-mono text-xs text-foreground shrink-0 w-32 truncate hidden md:block" title={record.model}>
          {truncate(record.model, 24)}
        </span>

        {/* Template */}
        <span className="flex-1 min-w-0 text-xs text-default-500 truncate">
          {record.templateName ?? record.builderName ?? "\u2014"}
        </span>

        {/* Source file */}
        <span className="font-mono text-[11px] text-default-400 truncate hidden xl:block max-w-40" title={record.sourceFile ?? undefined}>
          {record.sourceFile ? truncate(record.sourceFile, 30) : "\u2014"}
        </span>

        {/* Outcome */}
        <span className="shrink-0">
          <OutcomeBadge outcome={record.outcome} />
        </span>

        {/* Tokens */}
        <span className="text-xs tabular-nums text-default-500 shrink-0 w-16 text-right hidden md:block">
          {toNumber(record.totalTokens)}
        </span>

        {/* Duration */}
        <span className="text-xs tabular-nums text-default-500 shrink-0 w-16 text-right hidden md:block">
          {formatDuration(record.durationMs)}
        </span>
      </button>

      {expanded && <PromptDetail record={record} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter bar                                                         */
/* ------------------------------------------------------------------ */

function FilterBar({
  models,
  templates,
  selectedModel,
  selectedTemplate,
  selectedOutcome,
  onModelChange,
  onTemplateChange,
  onOutcomeChange,
}: {
  models: string[];
  templates: string[];
  selectedModel: string;
  selectedTemplate: string;
  selectedOutcome: string;
  onModelChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onOutcomeChange: (value: string) => void;
}) {
  const selectClasses =
    "rounded-md border border-divider bg-content1 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        className={selectClasses}
      >
        <option value="">All Models</option>
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      <select
        value={selectedTemplate}
        onChange={(e) => onTemplateChange(e.target.value)}
        className={selectClasses}
      >
        <option value="">All Templates</option>
        {templates.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <select
        value={selectedOutcome}
        onChange={(e) => onOutcomeChange(e.target.value)}
        className={selectClasses}
      >
        <option value="">All Outcomes</option>
        <option value="success">Success</option>
        <option value="error">Error</option>
        <option value="validation_failed">Validation Failed</option>
        <option value="partial">Partial</option>
        <option value="timeout">Timeout</option>
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

function PromptsContent(props: { project: Project }) {
  const [state, setState] = useState<PromptsState>({
    loading: true,
    records: [],
    analytics: null,
    error: null,
  });

  const [filterModel, setFilterModel] = useState("");
  const [filterTemplate, setFilterTemplate] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [recordsRes, analyticsRes] = await Promise.all([
          api.prompts.list({ projectId: props.project.id, limit: 500 }),
          api.prompts.analytics({ projectId: props.project.id }),
        ]);

        if (!active) return;

        setState({
          loading: false,
          records: recordsRes.records,
          analytics: analyticsRes,
          error: null,
        });
      } catch (error) {
        if (!active) return;

        const message = error instanceof ApiError ? error.message : "Unable to load prompt data";
        setState({ loading: false, records: [], analytics: null, error: message });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [props.project.id]);

  // Derive filter options from records
  const models = useMemo(() => {
    const set = new Set<string>();
    for (const r of state.records) set.add(r.model);
    return Array.from(set).sort();
  }, [state.records]);

  const templates = useMemo(() => {
    const set = new Set<string>();
    for (const r of state.records) {
      if (r.templateName) set.add(r.templateName);
    }
    return Array.from(set).sort();
  }, [state.records]);

  // Filter records
  const filteredRecords = useMemo(() => {
    return state.records.filter((r) => {
      if (filterModel && r.model !== filterModel) return false;
      if (filterTemplate && r.templateName !== filterTemplate) return false;
      if (filterOutcome && r.outcome.toLowerCase() !== filterOutcome) return false;
      return true;
    });
  }, [state.records, filterModel, filterTemplate, filterOutcome]);

  // Timeline data
  const timeline = useMemo(
    () => groupByDate(filteredRecords, (r) => r.createdAt),
    [filteredRecords]
  );

  // Outcome distribution
  const outcomeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filteredRecords) {
      const key = r.outcome.toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [filteredRecords]);

  if (state.loading) {
    return <Panel><p className="text-sm text-default-500">Loading prompt analytics...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Prompts tab unavailable" body={state.error} />;
  }

  if (state.records.length === 0) {
    return (
      <EmptyState
        title="No prompts recorded"
        body="Prompt tracking data will appear here after nit runs with LLM prompt logging enabled."
      />
    );
  }

  return (
    <div className="space-y-6">

      {/* ---- Analytics Hero ---- */}
      {state.analytics && <AnalyticsHero analytics={state.analytics} />}

      {/* ---- Outcome distribution bar ---- */}
      {Object.keys(outcomeCounts).length > 0 && (
        <Panel>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-3">
            Outcome Distribution
          </h2>
          <div className="space-y-2.5">
            {/* Stacked bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-default-100">
              {Object.entries(outcomeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, count], i, arr) => {
                  const total = filteredRecords.length;
                  const pct = (count / total) * 100;
                  const colorMap: Record<string, string> = {
                    success: "bg-emerald-500",
                    error: "bg-red-500",
                    validation_failed: "bg-amber-500",
                    partial: "bg-orange-400",
                    timeout: "bg-red-600",
                  };
                  const color = colorMap[outcome] ?? "bg-default-400";
                  return (
                    <div
                      key={outcome}
                      className={cn(
                        color,
                        "h-full transition-all duration-500",
                        i === 0 && "rounded-l-full",
                        i === arr.length - 1 && "rounded-r-full"
                      )}
                      style={{ width: `${pct}%` }}
                      title={`${outcome}: ${count} (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              {Object.entries(outcomeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, count]) => {
                  const total = filteredRecords.length;
                  const pct = (count / total) * 100;
                  const colorMap: Record<string, string> = {
                    success: "bg-emerald-500",
                    error: "bg-red-500",
                    validation_failed: "bg-amber-500",
                    partial: "bg-orange-400",
                    timeout: "bg-red-600",
                  };
                  const iconMap: Record<string, React.ReactNode> = {
                    success: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
                    error: <XCircle className="h-3 w-3 text-red-500" />,
                    validation_failed: <AlertTriangle className="h-3 w-3 text-amber-500" />,
                  };
                  const color = colorMap[outcome] ?? "bg-default-400";
                  return (
                    <div key={outcome} className="flex items-center gap-1.5 text-xs">
                      {iconMap[outcome] ?? <span className={cn("h-2.5 w-2.5 rounded-sm shrink-0", color)} />}
                      <span className="text-default-500 capitalize">{outcome.replace(/_/g, " ")}</span>
                      <span className="font-semibold tabular-nums">{count}</span>
                      <span className="text-default-500">({pct.toFixed(0)}%)</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </Panel>
      )}

      {/* ---- Breakdown tables (By Model + By Template) ---- */}
      {state.analytics && (
        <div className="grid gap-6 lg:grid-cols-2">
          <BreakdownTable
            title="By Model"
            subtitle="Performance breakdown across LLM models"
            icon={<Layers className="h-4 w-4 text-[hsl(var(--chart-1))]" />}
            data={state.analytics.byModel}
          />
          <BreakdownTable
            title="By Template"
            subtitle="Performance breakdown across prompt templates"
            icon={<FileText className="h-4 w-4 text-[hsl(var(--chart-2))]" />}
            data={state.analytics.byTemplate}
          />
        </div>
      )}

      {/* ---- Prompt Volume Timeline ---- */}
      <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
        <div className="px-5 py-3 border-b border-divider bg-default-100/30 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-default-500">
            Prompt Volume
          </h2>
          {timeline.length > 0 && (
            <span className="rounded-md bg-[hsl(var(--chart-2)/0.1)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--chart-2))]">
              {timeline.length} days
            </span>
          )}
        </div>
        <div className="p-5">
          <div className="h-64">
            {timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeline} barCategoryGap="15%">
                  <defs>
                    <linearGradient id="promptBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-default-300))" vertical={false} />
                  <XAxis dataKey="date" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    formatter={(value) => [toNumber(Number(value)), "Prompts"]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Bar dataKey="value" fill="url(#promptBarGrad)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-sm text-default-500">
                No prompt volume data.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- Prompt Records Table ---- */}
      <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
        <div className="px-5 py-3 border-b border-divider bg-default-100/30 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-default-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-default-500">
              Prompt Records
            </h2>
            <span className="rounded-md bg-default-200 px-2 py-0.5 text-[11px] font-medium tabular-nums text-default-500">
              {filteredRecords.length}
            </span>
          </div>
          <FilterBar
            models={models}
            templates={templates}
            selectedModel={filterModel}
            selectedTemplate={filterTemplate}
            selectedOutcome={filterOutcome}
            onModelChange={setFilterModel}
            onTemplateChange={setFilterTemplate}
            onOutcomeChange={setFilterOutcome}
          />
        </div>

        {/* Table header */}
        <div className="hidden md:flex items-center gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-default-400 font-medium border-b border-divider/40 bg-default-50/50">
          <span className="w-4" /> {/* expand icon spacer */}
          <span className="w-16">ID</span>
          <span className="w-36 hidden lg:block">Timestamp</span>
          <span className="w-32 hidden md:block">Model</span>
          <span className="flex-1 min-w-0">Template / Builder</span>
          <span className="max-w-40 hidden xl:block">Source</span>
          <span className="w-20">Outcome</span>
          <span className="w-16 text-right hidden md:block">Tokens</span>
          <span className="w-16 text-right hidden md:block">Duration</span>
        </div>

        {/* Rows */}
        {filteredRecords.length > 0 ? (
          <div className="divide-y-0">
            {filteredRecords.map((record) => (
              <PromptRow key={record.id} record={record} />
            ))}
          </div>
        ) : (
          <div className="grid h-40 place-items-center text-sm text-default-500">
            No records match the selected filters.
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                        */
/* ------------------------------------------------------------------ */

export function ProjectPromptsPage() {
  return <ProjectPageShell>{(project) => <PromptsContent project={project} />}</ProjectPageShell>;
}
