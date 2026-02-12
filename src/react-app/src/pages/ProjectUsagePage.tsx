import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Panel } from "../components/ui";
import {
  api,
  ApiError,
  type Project,
  type UsageBreakdownRow,
  type UsageDailyPoint,
  type UsageSummary
} from "../lib/api";
import { toCurrency, toNumber, truncate } from "../lib/format";
import { DollarSign, Zap, TrendingUp } from "lucide-react";
import { ProjectPageShell } from "./project-shared";

const PROVIDER_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--card))",
  color: "hsl(var(--card-foreground))",
};

const TICK_STYLE = { fill: "hsl(var(--muted-foreground))", fontSize: 12 };

interface UsageState {
  loading: boolean;
  summary: UsageSummary | null;
  daily: UsageDailyPoint[];
  breakdown: UsageBreakdownRow[];
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Usage Content                                                             */
/* -------------------------------------------------------------------------- */

function UsageContent(props: { project: Project }) {
  const [state, setState] = useState<UsageState>({
    loading: true,
    summary: null,
    daily: [],
    breakdown: [],
    error: null
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [summary, daily, breakdown] = await Promise.all([
          api.llmUsage.summary({ projectId: props.project.id, days: 90 }),
          api.llmUsage.daily({ projectId: props.project.id, days: 90 }),
          api.llmUsage.breakdown({ projectId: props.project.id, days: 90 })
        ]);

        if (!active) {
          return;
        }

        setState({
          loading: false,
          summary: summary.summary,
          daily: daily.daily,
          breakdown: breakdown.breakdown,
          error: null
        });
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof ApiError ? error.message : "Unable to load usage analytics";
        setState({
          loading: false,
          summary: null,
          daily: [],
          breakdown: [],
          error: message
        });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [props.project.id]);

  const pieData = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of state.breakdown) {
      map.set(row.provider, (map.get(row.provider) ?? 0) + row.totalCostUsd);
    }

    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [state.breakdown]);

  if (state.loading) {
    return <Panel><p className="text-sm text-muted-foreground">Loading LLM usage analytics...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Usage tab unavailable" body={state.error} />;
  }

  return (
    <div className="space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/*  Hero Spend Section                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-r from-[hsl(var(--card))] to-[hsl(var(--chart-1)/0.04)]">
        <div className="absolute -left-20 -top-20 h-56 w-56 rounded-full bg-[hsl(var(--chart-1)/0.05)] blur-3xl" />
        <div className="absolute -right-16 -bottom-16 h-40 w-40 rounded-full bg-[hsl(var(--chart-4)/0.05)] blur-3xl" />

        <div className="relative flex flex-col gap-8 p-6 md:flex-row md:items-center md:p-8">
          {/* Big total cost */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--chart-1)/0.12)]">
                <DollarSign className="h-5 w-5 text-[hsl(var(--chart-1))]" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Total Spend (90d)</span>
            </div>
            <p className="mt-3 text-5xl font-bold tracking-tight text-foreground tabular-nums">
              {toCurrency(state.summary?.totalCostUsd ?? 0)}
            </p>

            {/* Supporting numbers */}
            <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[hsl(var(--chart-3))]" />
                <div>
                  <p className="text-xs text-muted-foreground">Requests</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{toNumber(state.summary?.totalRequests ?? 0)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[hsl(var(--chart-2))]" />
                <div>
                  <p className="text-xs text-muted-foreground">Tokens</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{toNumber(state.summary?.totalTokens ?? 0)}</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/*  Daily Spend Bar Chart                                             */}
      {/* ------------------------------------------------------------------ */}
      <Panel>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Daily Spend</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Cost per day over the last 90 days</p>
          </div>
          {state.daily.length > 0 ? (
            <span className="rounded-md bg-[hsl(var(--chart-1)/0.1)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[hsl(var(--chart-1))]">
              {state.daily.length} days
            </span>
          ) : null}
        </div>
        <div className="mt-5 h-72">
          {state.daily.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={state.daily} barCategoryGap="15%">
                <defs>
                  <linearGradient id="spendBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={TICK_STYLE} />
                <YAxis tick={TICK_STYLE} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  formatter={(value) => [toCurrency(Number(value)), "Cost"]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="totalCostUsd" fill="url(#spendBarGrad)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">No daily spend data.</div>
          )}
        </div>
      </Panel>

      {/* ------------------------------------------------------------------ */}
      {/*  Two-Column: Pie Chart + Model Table                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* LEFT -- Provider Cost Pie */}
        <Panel>
          <h2 className="text-sm font-semibold text-foreground">Cost by Provider</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Breakdown of spend across LLM providers</p>

          {pieData.length > 0 ? (
            <div className="mt-4 flex flex-col items-center">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={entry.name} fill={PROVIDER_COLORS[index % PROVIDER_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [toCurrency(Number(value)), "Cost"]}
                      contentStyle={TOOLTIP_STYLE}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Legend */}
              <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2">
                {pieData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: PROVIDER_COLORS[index % PROVIDER_COLORS.length] }}
                    />
                    <span className="text-muted-foreground">{entry.name}</span>
                    <span className="font-medium tabular-nums text-foreground">{toCurrency(entry.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid h-56 place-items-center text-sm text-muted-foreground">No provider spend data.</div>
          )}
        </Panel>

        {/* RIGHT -- Model Breakdown Table */}
        <Panel>
          <h2 className="text-sm font-semibold text-foreground">Model Breakdown</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Token usage and cost by model</p>

          <div className="mt-4 overflow-auto max-h-80">
            {state.breakdown.length > 0 ? (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Provider</th>
                    <th className="pb-3 pr-4 font-medium">Model</th>
                    <th className="pb-3 pr-4 font-medium text-right">Tokens</th>
                    <th className="pb-3 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {state.breakdown.slice(0, 24).map((row) => (
                    <tr key={`${row.provider}:${row.model}`} className="group transition-colors hover:bg-muted/30">
                      <td className="py-2.5 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: PROVIDER_COLORS[
                                pieData.findIndex((p) => p.name === row.provider) % PROVIDER_COLORS.length
                              ] ?? PROVIDER_COLORS[0]
                            }}
                          />
                          {row.provider}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{truncate(row.model, 30)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{toNumber(row.tokens)}</td>
                      <td className="py-2.5 text-right tabular-nums font-medium">{toCurrency(row.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid h-56 place-items-center text-sm text-muted-foreground">No model breakdown data.</div>
            )}
          </div>
        </Panel>
      </div>

    </div>
  );
}

export function ProjectUsagePage() {
  return <ProjectPageShell>{(project) => <UsageContent project={project} />}</ProjectPageShell>;
}
