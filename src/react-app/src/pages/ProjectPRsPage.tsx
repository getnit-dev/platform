import { useEffect, useMemo, useState } from "react";
import { EmptyState, Panel, StatCard } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type CoverageReport, type Project } from "../lib/api";
import { toCurrency, toDateTime, toNumber, toPercent, truncate } from "../lib/format";
import { cn } from "../lib/utils";
import { ProjectPageShell } from "./project-shared";
import { ChevronDown, ChevronRight, ExternalLink, GitPullRequest } from "lucide-react";

interface PRGroup {
  prNumber: number;
  prUrl: string | null;
  reports: CoverageReport[];
  branch: string | null;
  latestDate: string;
  avgCoverage: number;
  totalTests: number;
  totalBugsFound: number;
  totalCost: number;
}

function groupByPR(reports: CoverageReport[]): PRGroup[] {
  const map = new Map<number, CoverageReport[]>();

  for (const r of reports) {
    if (r.prNumber === null) continue;
    const existing = map.get(r.prNumber) ?? [];
    existing.push(r);
    map.set(r.prNumber, existing);
  }

  return Array.from(map.entries())
    .map(([prNumber, prReports]) => {
      const first = prReports[0];
      const coverages = prReports.map(r => r.overallCoverage).filter((c): c is number => c !== null);
      const avgCoverage = coverages.length > 0 ? coverages.reduce((s, c) => s + c, 0) / coverages.length : 0;

      return {
        prNumber,
        prUrl: first.prUrl,
        reports: prReports,
        branch: first.branch,
        latestDate: prReports.reduce((latest, r) => r.createdAt > latest ? r.createdAt : latest, prReports[0].createdAt),
        avgCoverage,
        totalTests: prReports.reduce((s, r) => s + r.testsGenerated, 0),
        totalBugsFound: prReports.reduce((s, r) => s + r.bugsFound, 0),
        totalCost: prReports.reduce((s, r) => s + (r.llmCostUsd ?? 0), 0),
      };
    })
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

function PRRow({ pr }: { pr: PRGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className={cn("border-b border-divider/50 cursor-pointer transition-colors", expanded ? "bg-default-100/50" : "hover:bg-default-100/30")}
      >
        <td className="px-3 py-3 text-default-500">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold tabular-nums">#{pr.prNumber}</span>
            {pr.prUrl && (
              <a href={pr.prUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-primary hover:text-primary/80">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </td>
        <td className="px-3 py-3">
          {pr.branch ? (
            <code className="font-mono text-xs bg-default-100 px-1.5 py-0.5 rounded">{truncate(pr.branch, 20)}</code>
          ) : <span className="text-xs text-default-500">--</span>}
        </td>
        <td className="px-3 py-3 text-xs tabular-nums">{toPercent(pr.avgCoverage)}</td>
        <td className="px-3 py-3 text-xs tabular-nums">{toNumber(pr.totalTests)}</td>
        <td className="px-3 py-3 text-xs tabular-nums">
          {pr.totalBugsFound > 0 ? (
            <span className="text-red-600 dark:text-red-400 font-semibold">{pr.totalBugsFound}</span>
          ) : "0"}
        </td>
        <td className="px-3 py-3 text-xs tabular-nums">{toCurrency(pr.totalCost)}</td>
        <td className="px-3 py-3 text-xs text-default-500 whitespace-nowrap">{toDateTime(pr.latestDate)}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="border-t border-divider bg-default-100/30 p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border border-divider bg-content1 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Runs</p>
                  <p className="mt-0.5 text-sm font-semibold">{pr.reports.length}</p>
                </div>
                <div className="rounded-lg border border-divider bg-content1 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Avg Coverage</p>
                  <p className="mt-0.5 text-sm font-semibold">{toPercent(pr.avgCoverage)}</p>
                </div>
                <div className="rounded-lg border border-divider bg-content1 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">Tests Generated</p>
                  <p className="mt-0.5 text-sm font-semibold">{toNumber(pr.totalTests)}</p>
                </div>
                <div className="rounded-lg border border-divider bg-content1 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-default-500 font-medium">LLM Cost</p>
                  <p className="mt-0.5 text-sm font-semibold">{toCurrency(pr.totalCost)}</p>
                </div>
              </div>

              <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
                <div className="px-4 py-2 border-b border-divider bg-default-100/40">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-default-500">Reports in this PR</h4>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 bg-default-100/20">
                      <th className="px-4 py-2 font-medium">Run ID</th>
                      <th className="px-4 py-2 font-medium">Mode</th>
                      <th className="px-4 py-2 font-medium">Coverage</th>
                      <th className="px-4 py-2 font-medium">Passed</th>
                      <th className="px-4 py-2 font-medium">Failed</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pr.reports.map(r => (
                      <tr key={r.id} className="border-t border-divider/50">
                        <td className="px-4 py-2 font-mono text-xs">{truncate(r.runId, 12)}</td>
                        <td className="px-4 py-2"><Badge variant="secondary">{r.runMode}</Badge></td>
                        <td className="px-4 py-2 tabular-nums">{toPercent(r.overallCoverage)}</td>
                        <td className="px-4 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{toNumber(r.testsPassed)}</td>
                        <td className="px-4 py-2 tabular-nums text-red-600 dark:text-red-400">{toNumber(r.testsFailed)}</td>
                        <td className="px-4 py-2 text-xs text-default-500">{toDateTime(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PRsContent(props: { project: Project }) {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<CoverageReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await api.reports.list({ projectId: props.project.id, limit: 500 });
        if (!active) return;
        setReports(res.reports);
        setLoading(false);
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : "Unable to load PR data");
        setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [props.project.id]);

  const prGroups = useMemo(() => groupByPR(reports), [reports]);
  const totalPRs = prGroups.length;
  const totalBugs = prGroups.reduce((s, p) => s + p.totalBugsFound, 0);
  const totalCost = prGroups.reduce((s, p) => s + p.totalCost, 0);

  if (loading) return <Panel><p className="text-sm text-default-500">Loading PR data...</p></Panel>;
  if (error) return <EmptyState title="PR data unavailable" body={error} />;
  if (prGroups.length === 0) return <EmptyState title="No PR data" body="Upload reports with PR context (--diff mode) to see PR impact analysis." />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="PRs Analyzed" value={toNumber(totalPRs)} />
        <StatCard label="Bugs Found" value={toNumber(totalBugs)} />
        <StatCard label="Total LLM Cost" value={toCurrency(totalCost)} />
      </div>

      <div className="rounded-lg border border-divider bg-content1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-default-500 border-b border-divider bg-default-100/40">
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3 font-medium">PR</th>
                <th className="px-3 py-3 font-medium">Branch</th>
                <th className="px-3 py-3 font-medium">Coverage</th>
                <th className="px-3 py-3 font-medium">Tests</th>
                <th className="px-3 py-3 font-medium">Bugs</th>
                <th className="px-3 py-3 font-medium">Cost</th>
                <th className="px-3 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {prGroups.map(pr => <PRRow key={pr.prNumber} pr={pr} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ProjectPRsPage() {
  return <ProjectPageShell>{(project) => <PRsContent project={project} />}</ProjectPageShell>;
}
