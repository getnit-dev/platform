import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, Panel, StatusPill } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api, ApiError, type Bug, type CoverageReport, type Project } from "../lib/api";
import { toNumber, truncate } from "../lib/format";
import {
  Plus,
  GitBranch,
  Activity,
  Bug as BugIcon,
  FlaskConical,
  GitPullRequest,
  Zap,
  X,
  Folder,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface OverviewState {
  loading: boolean;
  projects: Project[];
  reports: CoverageReport[];
  bugs: Bug[];
  error: string | null;
}

interface CreateProjectState {
  open: boolean;
  name: string;
  repoUrl: string;
  submitting: boolean;
  error: string | null;
  createdProject: Project | null;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function lastReportByProject(reports: CoverageReport[]): Map<string, CoverageReport> {
  const map = new Map<string, CoverageReport>();
  for (const report of reports) {
    const current = map.get(report.projectId);
    if (!current || current.createdAt < report.createdAt) {
      map.set(report.projectId, report);
    }
  }
  return map;
}

function healthStatus(
  report: CoverageReport | undefined,
  openBugs: number,
): { label: string; tone: "good" | "warn" | "danger" | "neutral" } {
  if (!report) return { label: "No runs", tone: "neutral" };
  if (report.testsFailed > 0 || openBugs > 0)
    return { label: report.testsFailed > 0 ? "Needs attention" : "Open bugs", tone: "warn" };
  return { label: "Healthy", tone: "good" };
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function ProjectCard({
  project,
  latestReport,
  openBugs,
}: {
  project: Project;
  latestReport: CoverageReport | undefined;
  openBugs: number;
}) {
  const status = healthStatus(latestReport, openBugs);

  return (
    <Link
      to={`/projects/${project.id}/runs`}
      className="group block rounded-xl border border-border bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5"
    >
      <div className="p-5 space-y-4">
        {/* Top row: name + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Folder className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                {project.name}
              </h3>
            </div>
            {project.repoUrl && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground truncate pl-10">
                <GitBranch className="h-3 w-3 flex-shrink-0" />
                {truncate(project.repoUrl.replace(/^https?:\/\/(www\.)?/, ""), 48)}
              </p>
            )}
          </div>
          <StatusPill label={status.label} tone={status.tone} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-2 border-t border-border pt-3">
          <div className="flex flex-col items-center gap-1">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">{toNumber(project.totalRuns ?? 0)}</span>
            <span className="text-[10px] text-muted-foreground">Runs</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <BugIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">{toNumber(project.detectedBugs ?? 0)}</span>
            <span className="text-[10px] text-muted-foreground">Bugs</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">{toNumber(project.createdIssues ?? 0)}</span>
            <span className="text-[10px] text-muted-foreground">Issues</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">{toNumber(project.createdPRs ?? 0)}</span>
            <span className="text-[10px] text-muted-foreground">PRs</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">{toNumber(project.totalTokens ?? 0)}</span>
            <span className="text-[10px] text-muted-foreground">Tokens</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Create Project Modal                                                      */
/* -------------------------------------------------------------------------- */

function CreateProjectModal({
  state,
  onClose,
  onChange,
  onSubmit,
}: {
  state: CreateProjectState;
  onClose: () => void;
  onChange: (next: Partial<CreateProjectState>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!state.open || state.createdProject) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <Panel className="relative">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Create New Project</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a project to start tracking test coverage and bugs.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="modal-project-name">Project Name</Label>
                <Input
                  id="modal-project-name"
                  value={state.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  placeholder="my-awesome-project"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modal-repo-url">Repository URL (optional)</Label>
                <Input
                  id="modal-repo-url"
                  value={state.repoUrl}
                  onChange={(e) => onChange({ repoUrl: e.target.value })}
                  placeholder="https://github.com/username/repo"
                />
              </div>

              {state.error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                  <p className="text-sm text-destructive">{state.error}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={onClose} variant="outline" className="flex-1">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!state.name.trim() || state.submitting}
                  className="flex-1"
                >
                  {state.submitting ? "Creating..." : "Create Project"}
                </Button>
              </div>
            </form>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Onboarding: first project creation                                        */
/* -------------------------------------------------------------------------- */

function OnboardingCreate({
  state,
  onChange,
  onSubmit,
}: {
  state: CreateProjectState;
  onChange: (next: Partial<CreateProjectState>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="min-h-[600px] grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Panel>
          <div className="space-y-6">
            <div className="text-center space-y-4 pb-4 border-b border-border">
              <div className="flex justify-center">
                <img src="/favicon.svg" alt="nit" className="w-16 h-16" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Create Your First Project</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Get started by creating a project to track
                </p>
              </div>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  value={state.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  placeholder="my-awesome-project"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="repo-url">Repository URL (optional)</Label>
                <Input
                  id="repo-url"
                  value={state.repoUrl}
                  onChange={(e) => onChange({ repoUrl: e.target.value })}
                  placeholder="https://github.com/username/repo"
                />
              </div>

              {state.error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                  <p className="text-sm text-destructive">{state.error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={!state.name.trim() || state.submitting}
                className="w-full"
              >
                {state.submitting ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function OnboardingSetup({ createdProject }: { createdProject: Project }) {
  return (
    <div className="min-h-[600px] grid place-items-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <Panel>
          <div className="space-y-6">
            <div className="text-center space-y-3 pb-4 border-b border-border">
              <div className="flex justify-center">
                <img src="/favicon.svg" alt="nit" className="w-16 h-16" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Project Created Successfully</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Follow these steps to connect your local project
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-base font-semibold">Get Started</h2>

              <div className="space-y-3">
                <SetupStep number={1} title="Initialize nit in your project" description="Run this command in your project directory:">
                  <pre className="bg-secondary p-3 rounded-lg text-sm overflow-x-auto border border-border">
                    <code className="text-primary">nit init</code>
                  </pre>
                </SetupStep>

                <SetupStep number={2} title="Configure your platform connection" description={<>Edit <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">.nit.yml</code> to connect:</>}>
                  <pre className="bg-secondary p-3 rounded-lg text-sm overflow-x-auto border border-border">
                    <code>{`llm:
  provider: openai
  model: gpt-4o
  api_key: \${OPENAI_API_KEY}

platform:
  url: ${typeof window !== "undefined" ? window.location.origin : "https://platform.getnit.dev"}
  project_id: ${createdProject.id}
  api_key: \${NIT_PLATFORM_REPORTING_API_KEY}`}</code>
                  </pre>
                </SetupStep>

                <SetupStep number={3} title="Set up GitHub Actions (optional)" description={<>Create <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">.github/workflows/nit.yml</code>:</>}>
                  <pre className="bg-secondary p-3 rounded-lg text-sm overflow-x-auto border border-border">
                    <code>{`name: nit

on: [pull_request]

jobs:
  test-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: getnit-dev/nit@v1
        with:
          mode: pick
          llm_provider: anthropic
          llm_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          upload_report: true
          platform_url: ${typeof window !== "undefined" ? window.location.origin : "https://platform.getnit.dev"}
          platform_api_key: \${{ secrets.NIT_PLATFORM_REPORTING_API_KEY }}`}</code>
                  </pre>
                </SetupStep>

                <SetupStep number={4} title="Generate tests and see results here">
                  <pre className="bg-secondary p-3 rounded-lg text-sm overflow-x-auto border border-border">
                    <code className="text-primary">nit pick --report</code>
                  </pre>
                  <p className="text-xs text-muted-foreground">
                    Your projects will appear on this dashboard once the first report is uploaded.
                  </p>
                </SetupStep>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                Need help?{" "}
                <a
                  href="https://github.com/getnit-dev/nit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  View documentation
                </a>
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SetupStep({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-muted border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0 bg-primary text-primary-foreground">
          {number}
        </div>
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Summary bar                                                               */
/* -------------------------------------------------------------------------- */

function SummaryBar({ projects }: { projects: Project[] }) {
  const totalRuns = projects.reduce((s, p) => s + (p.totalRuns ?? 0), 0);
  const totalBugs = projects.reduce((s, p) => s + (p.detectedBugs ?? 0), 0);
  const totalIssues = projects.reduce((s, p) => s + (p.createdIssues ?? 0), 0);
  const totalPRs = projects.reduce((s, p) => s + (p.createdPRs ?? 0), 0);
  const totalTokens = projects.reduce((s, p) => s + (p.totalTokens ?? 0), 0);

  const parts: string[] = [
    `${toNumber(projects.length)} project${projects.length === 1 ? "" : "s"}`,
  ];
  if (totalRuns > 0) parts.push(`${toNumber(totalRuns)} runs`);
  if (totalBugs > 0) parts.push(`${toNumber(totalBugs)} bugs`);
  if (totalIssues > 0) parts.push(`${toNumber(totalIssues)} issues`);
  if (totalPRs > 0) parts.push(`${toNumber(totalPRs)} PRs`);
  if (totalTokens > 0) parts.push(`${toNumber(totalTokens)} tokens`);

  return (
    <p className="text-sm text-muted-foreground">
      {parts.join(" \u00b7 ")}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main page                                                                 */
/* -------------------------------------------------------------------------- */

export function ProjectsOverviewPage() {
  const [state, setState] = useState<OverviewState>({
    loading: true,
    projects: [],
    reports: [],
    bugs: [],
    error: null,
  });

  const [createProject, setCreateProject] = useState<CreateProjectState>({
    open: false,
    name: "",
    repoUrl: "",
    submitting: false,
    error: null,
    createdProject: null,
  });

  /* ---- data fetching ---- */

  useEffect(() => {
    let active = true;

    async function load() {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const [projectResponse, reportResponse, bugResponse] = await Promise.all([
          api.projects.list(),
          api.reports.list({ limit: 300 }),
          api.bugs.list({ limit: 300 }),
        ]);

        if (!active) return;

        setState({
          loading: false,
          projects: projectResponse.projects,
          reports: reportResponse.reports,
          bugs: bugResponse.bugs,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof ApiError ? error.message : "Unable to load project overview";
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  /* ---- create project handler ---- */

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreateProject((prev) => ({ ...prev, submitting: true, error: null }));

    try {
      const response = await api.projects.create({
        name: createProject.name,
        repoUrl: createProject.repoUrl || null,
      });

      const projectsResponse = await api.projects.list();
      setState((prev) => ({ ...prev, projects: projectsResponse.projects }));

      setCreateProject({
        open: true,
        name: "",
        repoUrl: "",
        submitting: false,
        error: null,
        createdProject: response.project,
      });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to create project";
      setCreateProject((prev) => ({ ...prev, submitting: false, error: message }));
    }
  }

  /* ---- memos ---- */

  const latestByProject = useMemo(() => lastReportByProject(state.reports), [state.reports]);

  const openBugCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const bug of state.bugs) {
      if (bug.status !== "open") continue;
      map.set(bug.projectId, (map.get(bug.projectId) ?? 0) + 1);
    }
    return map;
  }, [state.bugs]);

  /* ---- loading / error states ---- */

  if (state.loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="h-7 w-28 rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-52 rounded-md bg-muted animate-pulse" />
          </div>
          <div className="h-9 w-28 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
                <div className="h-4 w-32 rounded-md bg-muted animate-pulse" />
              </div>
              <div className="grid grid-cols-5 gap-2 pt-3 border-t border-border">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex flex-col items-center gap-1">
                    <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-6 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-8 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.error) {
    return <EmptyState title="Failed to load projects" body={state.error} />;
  }

  /* ---- onboarding (no projects yet) ---- */

  if (state.projects.length === 0) {
    if (createProject.createdProject) {
      return <OnboardingSetup createdProject={createProject.createdProject} />;
    }
    return (
      <OnboardingCreate
        state={createProject}
        onChange={(next) => setCreateProject((prev) => ({ ...prev, ...next }))}
        onSubmit={handleCreateProject}
      />
    );
  }

  /* ---- main dashboard ---- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <SummaryBar projects={state.projects} />
        </div>
        <Button
          onClick={() =>
            setCreateProject({
              open: true,
              name: "",
              repoUrl: "",
              submitting: false,
              error: null,
              createdProject: null,
            })
          }
          className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Project
        </Button>
      </div>

      {/* Project grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.projects.map((project) => {
          const latest = latestByProject.get(project.id);
          const openBugs = openBugCounts.get(project.id) ?? 0;

          return (
            <ProjectCard
              key={project.id}
              project={project}
              latestReport={latest}
              openBugs={openBugs}
            />
          );
        })}
      </div>

      {/* Create project modal */}
      <CreateProjectModal
        state={createProject}
        onClose={() => setCreateProject((prev) => ({ ...prev, open: false }))}
        onChange={(next) => setCreateProject((prev) => ({ ...prev, ...next }))}
        onSubmit={handleCreateProject}
      />
    </div>
  );
}
