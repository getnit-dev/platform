import { useEffect, useMemo, useState } from "react";
import { EmptyState, Panel, StatCard } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type Project, type RouteInfo } from "../lib/api";
import { toNumber, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";
import { ChevronDown, ChevronRight, Lock, Unlock } from "lucide-react";

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  POST: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PATCH: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function parseMethods(methods: string | null): string[] {
  if (!methods) return [];
  try { return JSON.parse(methods); } catch { return [methods]; }
}

interface RoutesState {
  loading: boolean;
  routes: RouteInfo[];
  summary: { totalRoutes: number; coveredRoutes: number; byType: Record<string, number>; uncoveredRoutes: Array<{ path: string; methods: string }> } | null;
  error: string | null;
}

const ROUTE_TYPES = ["All", "API", "PAGE", "STATIC", "DYNAMIC"] as const;

function RouteRow({ route }: { route: RouteInfo }) {
  const [expanded, setExpanded] = useState(false);
  const methods = parseMethods(route.methods);
  const middleware = route.middleware ? (() => { try { return JSON.parse(route.middleware) as string[]; } catch { return []; } })() : [];
  const covPct = route.coveragePercentage !== null ? route.coveragePercentage : null;

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className={cn("border-b border-divider/50 cursor-pointer transition-colors", expanded ? "bg-default-100/50" : "hover:bg-default-100/30")}
      >
        <td className="px-3 py-3 text-default-500">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-3 py-3 font-mono text-xs">{route.path}</td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {methods.map(m => (
              <span key={m} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", METHOD_COLORS[m.toUpperCase()] ?? "bg-default-200 text-default-500")}>
                {m}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-3">
          {route.framework && <Badge variant="outline" className="text-[10px]">{route.framework}</Badge>}
        </td>
        <td className="px-3 py-3 text-xs text-default-500">{route.handlerFile ? truncate(route.handlerFile, 30) : "--"}</td>
        <td className="px-3 py-3">
          {route.authRequired === true ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : route.authRequired === false ? <Unlock className="h-3.5 w-3.5 text-default-400" /> : null}
        </td>
        <td className="px-3 py-3">
          {covPct !== null ? (
            <div className="flex items-center gap-2 min-w-[80px]">
              <div className="h-2 flex-1 rounded-full bg-default-100">
                <div className={cn("h-full rounded-full", covPct >= 80 ? "bg-emerald-500" : covPct >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${covPct}%` }} />
              </div>
              <span className="text-xs tabular-nums">{covPct.toFixed(0)}%</span>
            </div>
          ) : <span className="text-xs text-default-500">--</span>}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="border-t border-divider bg-default-100/30 px-8 py-3 space-y-2">
              {route.handlerName && <p className="text-xs"><span className="text-default-500">Handler:</span> <code className="font-mono">{route.handlerName}</code></p>}
              {route.handlerStartLine !== null && <p className="text-xs"><span className="text-default-500">Lines:</span> {route.handlerStartLine}–{route.handlerEndLine ?? "?"}</p>}
              {route.routeType && <p className="text-xs"><span className="text-default-500">Type:</span> {route.routeType}</p>}
              {middleware.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-default-500">Middleware:</span>
                  {middleware.map((m, i) => <Badge key={i} variant="secondary" className="text-[10px]">{m}</Badge>)}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RoutesContent(props: { project: Project }) {
  const [state, setState] = useState<RoutesState>({ loading: true, routes: [], summary: null, error: null });
  const [typeFilter, setTypeFilter] = useState<string>("All");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [routesRes, summaryRes] = await Promise.all([
          api.routeDiscovery.list({ projectId: props.project.id, limit: 500 }),
          api.routeDiscovery.summary({ projectId: props.project.id }),
        ]);
        if (!active) return;
        setState({ loading: false, routes: routesRes.routes, summary: summaryRes, error: null });
      } catch (err) {
        if (!active) return;
        setState({ loading: false, routes: [], summary: null, error: err instanceof ApiError ? err.message : "Unable to load routes" });
      }
    }
    void load();
    return () => { active = false; };
  }, [props.project.id]);

  const filtered = useMemo(() => {
    if (typeFilter === "All") return state.routes;
    return state.routes.filter(r => r.routeType?.toUpperCase() === typeFilter);
  }, [state.routes, typeFilter]);

  const s = state.summary;

  if (state.loading) return <Panel><p className="text-sm text-default-500">Loading routes...</p></Panel>;
  if (state.error) return <EmptyState title="Route data unavailable" body={state.error} />;
  if (state.routes.length === 0) return <EmptyState title="No route data" body="Run route discovery via the CLI to surface your project's routes." />;

  const coveredPct = s && s.totalRoutes > 0 ? ((s.coveredRoutes / s.totalRoutes) * 100).toFixed(0) : "0";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Routes" value={toNumber(s?.totalRoutes ?? 0)} />
        <StatCard label="API Routes" value={toNumber(s?.byType?.api ?? s?.byType?.API ?? 0)} />
        <StatCard label="Page Routes" value={toNumber(s?.byType?.page ?? s?.byType?.PAGE ?? 0)} />
        <StatCard label="Route Coverage" value={`${coveredPct}%`} />
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-default-500 mr-1">Type:</span>
        {ROUTE_TYPES.map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors", typeFilter === t ? "bg-primary text-primary-foreground shadow-sm" : "bg-default-200 text-foreground hover:bg-default-200/80")}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider bg-default-100/40">
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3 font-medium">Path</th>
                <th className="px-3 py-3 font-medium">Methods</th>
                <th className="px-3 py-3 font-medium">Framework</th>
                <th className="px-3 py-3 font-medium">Handler</th>
                <th className="px-3 py-3 font-medium">Auth</th>
                <th className="px-3 py-3 font-medium min-w-[120px]">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => <RouteRow key={r.id} route={r} />)}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-default-500">No routes match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Uncovered routes warning */}
      {s && s.uncoveredRoutes.length > 0 && (
        <Panel className="border-amber-500/20">
          <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400">Uncovered Routes ({s.uncoveredRoutes.length})</h2>
          <p className="mt-1 text-xs text-default-500">These routes have no test coverage.</p>
          <div className="mt-3 space-y-1">
            {s.uncoveredRoutes.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <code className="font-mono text-default-500">{r.path}</code>
                {r.methods && (
                  <div className="flex gap-1">
                    {parseMethods(r.methods).map(m => (
                      <span key={m} className={cn("rounded px-1 py-0.5 text-[9px] font-bold uppercase", METHOD_COLORS[m.toUpperCase()] ?? "bg-default-200 text-default-500")}>{m}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

export function ProjectRoutesPage() {
  return <ProjectPageShell>{(project) => <RoutesContent project={project} />}</ProjectPageShell>;
}
