import type { ReactNode } from "react";
import { Activity, Bug, GitPullRequest, GitCommit, Coins, AlertCircle } from "lucide-react";
import type { Project } from "../lib/api";
import { toNumber } from "../lib/format";

const STATS = [
  { key: "totalRuns", label: "Runs", icon: Activity, color: "text-blue-500" },
  { key: "detectedBugs", label: "Bugs", icon: Bug, color: "text-red-500" },
  { key: "createdIssues", label: "Issues", icon: AlertCircle, color: "text-amber-500" },
  { key: "createdPRs", label: "PRs", icon: GitPullRequest, color: "text-violet-500" },
  { key: "totalCommits", label: "Commits", icon: GitCommit, color: "text-emerald-500" },
  { key: "totalTokens", label: "Tokens", icon: Coins, color: "text-cyan-500" },
] as const;

export function ProjectDetailLayout(props: {
  project: Project;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {/* Project header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{props.project.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {props.project.repoUrl || "No repository URL configured"}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATS.map(({ key, label, icon: Icon, color }) => {
          const value = (props.project as unknown as Record<string, unknown>)[key] as number ?? 0;
          return (
            <div
              key={key}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold tabular-nums leading-tight">
                  {toNumber(value)}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {props.children}
    </div>
  );
}
