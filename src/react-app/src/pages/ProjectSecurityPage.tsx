import { useEffect, useMemo, useState } from "react";
import { EmptyState, Panel, StatCard } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type Project, type SecurityFinding, type RiskScore } from "../lib/api";
import { toNumber, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";
import { ShieldAlert, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

const SEVERITY_COLORS: Record<string, { bg: string; text: string; bar: string; headerBg: string }> = {
  critical: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", bar: "bg-red-600", headerBg: "bg-red-500/10 border-red-500/20" },
  high: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", bar: "bg-red-500", headerBg: "bg-red-500/10 border-red-500/20" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", headerBg: "bg-amber-500/10 border-amber-500/20" },
  low: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", headerBg: "bg-emerald-500/10 border-emerald-500/20" },
};

const RISK_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-500/20 border-red-500/30",
  HIGH: "bg-red-500/10 border-red-500/20",
  MEDIUM: "bg-amber-500/10 border-amber-500/20",
  LOW: "bg-emerald-500/10 border-emerald-500/20",
};

function getSeverityColor(severity: string) {
  return SEVERITY_COLORS[severity.toLowerCase()] ?? SEVERITY_COLORS.low;
}

interface SecurityState {
  loading: boolean;
  findings: SecurityFinding[];
  riskFiles: RiskScore[];
  securitySummary: { totalFindings: number; openFindings: number; bySeverity: Record<string, number>; byType: Array<{ type: string; count: number }>; recentTrend: { date: string; count: number }[] } | null;
  riskSummary: { avgScore: number; byLevel: Record<string, number>; topRiskyFiles: Array<{ filePath: string; overallScore: number; level: string }> } | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Severity Breakdown Bar                                             */
/* ------------------------------------------------------------------ */

function SeverityBar({ bySeverity, total }: { bySeverity: Record<string, number>; total: number }) {
  if (total === 0) return null;

  const segments = SEVERITY_ORDER
    .filter(s => (bySeverity[s] ?? 0) > 0)
    .map(s => ({ severity: s, count: bySeverity[s] ?? 0, pct: ((bySeverity[s] ?? 0) / total) * 100 }));

  return (
    <div className="space-y-2.5">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-default-100">
        {segments.map((seg, i) => (
          <div
            key={seg.severity}
            className={cn(getSeverityColor(seg.severity).bar, "h-full transition-all duration-500", i === 0 && "rounded-l-full", i === segments.length - 1 && "rounded-r-full")}
            style={{ width: `${seg.pct}%` }}
            title={`${seg.severity}: ${seg.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {segments.map(seg => (
          <div key={seg.severity} className="flex items-center gap-1.5 text-xs">
            <span className={cn("h-2.5 w-2.5 rounded-sm shrink-0", getSeverityColor(seg.severity).bar)} />
            <span className="text-default-500 capitalize">{seg.severity}</span>
            <span className="font-semibold tabular-nums">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Finding Row                                                        */
/* ------------------------------------------------------------------ */

function FindingRow({ finding, onUpdateStatus }: { finding: SecurityFinding; onUpdateStatus: (id: string, status: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-divider/40 last:border-0">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-default-100/30 transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-default-500 shrink-0" /> : <ChevronRight className="h-4 w-4 text-default-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{finding.title}</p>
          <p className="font-mono text-[11px] text-default-500 truncate mt-0.5">
            {finding.filePath}{finding.lineNumber ? `:${finding.lineNumber}` : ""}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{finding.vulnerabilityType}</Badge>
        <Badge variant={finding.status === "open" ? "warning" : "success"} className="shrink-0">{finding.status}</Badge>
        {finding.confidence !== null && (
          <span className="text-[11px] text-default-500 tabular-nums shrink-0">{(finding.confidence * 100).toFixed(0)}%</span>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 ml-7 space-y-3">
          <p className="text-sm text-default-500 leading-relaxed">{finding.description}</p>
          {finding.remediation && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">Remediation</p>
              <p className="text-sm text-default-500">{finding.remediation}</p>
            </div>
          )}
          {finding.evidence && (
            <pre className="rounded-md bg-default-100 px-3 py-2 text-xs overflow-x-auto font-mono">{finding.evidence}</pre>
          )}
          {finding.cweId && (
            <a href={`https://cwe.mitre.org/data/definitions/${finding.cweId.replace("CWE-", "")}.html`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              {finding.cweId} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {finding.status === "open" && (
            <div className="flex gap-2">
              <button onClick={() => onUpdateStatus(finding.id, "resolved")} className="rounded-md px-2.5 py-1 text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                Mark resolved
              </button>
              <button onClick={() => onUpdateStatus(finding.id, "false_positive")} className="rounded-md px-2.5 py-1 text-xs font-medium bg-default-200 text-default-500 hover:bg-default-200/80 transition-colors">
                False positive
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Risk Heatmap                                                       */
/* ------------------------------------------------------------------ */

function RiskHeatmap({ files }: { files: Array<{ filePath: string; overallScore: number; level: string }> }) {
  if (files.length === 0) return null;

  return (
    <Panel>
      <h2 className="text-sm font-semibold text-foreground">Risk Heatmap</h2>
      <p className="mt-1 text-xs text-default-500">Files colored by risk level — higher risk files appear first.</p>
      <div className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {files.map(file => (
          <div
            key={file.filePath}
            className={cn("rounded-lg border-l-4 p-2.5", RISK_COLORS[file.level] ?? RISK_COLORS.LOW)}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="mono text-[11px] leading-snug text-foreground/80">{truncate(file.filePath, 46)}</p>
              <span className="mono shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold bg-default-100">
                {(file.overallScore * 100).toFixed(0)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

function SecurityContent(props: { project: Project }) {
  const [state, setState] = useState<SecurityState>({
    loading: true, findings: [], riskFiles: [],
    securitySummary: null, riskSummary: null, error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [findingsRes, riskRes, secSummary, riskSummary] = await Promise.all([
          api.security.list({ projectId: props.project.id, limit: 200 }),
          api.risk.list({ projectId: props.project.id, limit: 100 }),
          api.security.summary({ projectId: props.project.id }),
          api.risk.summary({ projectId: props.project.id }),
        ]);

        if (!active) return;

        setState({
          loading: false,
          findings: findingsRes.findings,
          riskFiles: riskRes.files,
          securitySummary: secSummary,
          riskSummary: riskSummary,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        const message = error instanceof ApiError ? error.message : "Unable to load security data";
        setState(prev => ({ ...prev, loading: false, error: message }));
      }
    }

    void load();
    return () => { active = false; };
  }, [props.project.id]);

  async function updateFindingStatus(findingId: string, status: string) {
    try {
      await api.security.update(findingId, { status });
      setState(prev => ({
        ...prev,
        findings: prev.findings.map(f => f.id === findingId ? { ...f, status } : f),
      }));
    } catch { /* swallow */ }
  }

  const findingsBySeverity = useMemo(() => {
    const groups: Record<string, SecurityFinding[]> = {};
    for (const s of SEVERITY_ORDER) groups[s] = [];
    for (const f of state.findings) {
      const key = f.severity.toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }, [state.findings]);

  if (state.loading) {
    return <Panel><p className="text-sm text-default-500">Loading security data...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Security data unavailable" body={state.error} />;
  }

  const ss = state.securitySummary;
  const rs = state.riskSummary;
  const hasFindings = state.findings.length > 0;
  const hasRisk = (rs?.topRiskyFiles?.length ?? 0) > 0;

  if (!hasFindings && !hasRisk) {
    return <EmptyState title="No security data" body="Run a security scan via the CLI to surface findings and risk scores." />;
  }

  return (
    <div className="space-y-6">
      {/* Hero stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Findings" value={toNumber(ss?.totalFindings ?? 0)} />
        <StatCard label="Open" value={toNumber(ss?.openFindings ?? 0)} />
        <StatCard label="Critical / High" value={toNumber((ss?.bySeverity?.critical ?? 0) + (ss?.bySeverity?.high ?? 0))} />
        <StatCard label="Avg Risk Score" value={rs ? `${(rs.avgScore * 100).toFixed(0)}` : "n/a"} />
      </div>

      {/* Severity breakdown */}
      {hasFindings && ss && (
        <Panel>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-default-500 mb-3">Severity Distribution</h2>
          <SeverityBar bySeverity={ss.bySeverity} total={ss.totalFindings} />
        </Panel>
      )}

      {/* Risk heatmap */}
      {hasRisk && rs && (
        <RiskHeatmap files={rs.topRiskyFiles} />
      )}

      {/* Findings grouped by severity */}
      {hasFindings && (
        <div className="space-y-3">
          {SEVERITY_ORDER.map(sev => {
            const items = findingsBySeverity[sev] ?? [];
            if (items.length === 0) return null;
            const colors = getSeverityColor(sev);
            return (
              <div key={sev} className="rounded-lg border border-divider overflow-hidden">
                <div className={cn("flex items-center justify-between px-4 py-2.5 border-b", colors.headerBg)}>
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={cn("h-4 w-4", colors.text)} />
                    <span className={cn("text-sm font-semibold capitalize", colors.text)}>{sev}</span>
                  </div>
                  <span className={cn("text-xs font-medium tabular-nums", colors.text)}>{items.length}</span>
                </div>
                <div className="bg-content1">
                  {items.map(f => (
                    <FindingRow key={f.id} finding={f} onUpdateStatus={updateFindingStatus} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProjectSecurityPage() {
  return <ProjectPageShell>{(project) => <SecurityContent project={project} />}</ProjectPageShell>;
}
