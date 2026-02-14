import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Trash2, Users, AlertTriangle, Shield, Plus, History, Play, Bug, Zap, Database, GitPullRequest, ShieldAlert, FileSearch, Wrench, BookOpen, Key, FolderPlus, Settings, Route } from "lucide-react";
import { EmptyState, Panel, TextInput } from "../components/ui";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type ActivityEvent, type DashboardUser, type Project, type PlatformApiKey } from "../lib/api";
import { toDateTime } from "../lib/format";
import { ProjectPageShell } from "./project-shared";
import { cn } from "../lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface SettingsState {
  loading: boolean;
  platformKeys: PlatformApiKey[];
  user: DashboardUser | null;
  error: string | null;
}

const tabs = ["API Keys", "Activity", "Team", "Danger Zone"] as const;
type SettingsTab = typeof tabs[number];

const tabMeta: Record<SettingsTab, { icon: typeof Shield }> = {
  "API Keys": { icon: Shield },
  "Activity": { icon: History },
  "Team": { icon: Users },
  "Danger Zone": { icon: AlertTriangle },
};

/* -------------------------------------------------------------------------- */
/*  Tab Panels                                                                 */
/* -------------------------------------------------------------------------- */

function APIKeysTab(props: {
  project: Project;
  state: SettingsState;
  busy: boolean;
  platformKeyName: string;
  setPlatformKeyName: (v: string) => void;
  createdPlatformKey: string | null;
  setCreatedPlatformKey: (v: string | null) => void;
  createPlatformKey: (e: FormEvent<HTMLFormElement>) => void;
  deletePlatformKey: (id: string) => Promise<void>;
  copyToClipboard: (text: string) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-default-500">
        Create API keys for CLI authentication and data reporting.
      </p>

      {/* Created key banner */}
      {props.createdPlatformKey && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold">API Key Created Successfully!</p>
          </div>
          <p className="text-xs text-default-500">Save this key now — it will not be shown again.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={props.createdPlatformKey}
              className="mono flex-1 rounded-md bg-default-200 px-3 py-1.5 text-xs border border-divider"
            />
            <Button variant="outline" size="sm" onClick={() => props.copyToClipboard(props.createdPlatformKey!)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <pre className="rounded-md bg-default-200 px-3 py-1.5 text-xs overflow-x-auto border border-divider">
            <code>export NIT_PLATFORM_REPORTING_API_KEY={props.createdPlatformKey}</code>
          </pre>
          <Button variant="secondary" size="sm" onClick={() => props.setCreatedPlatformKey(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Create form */}
      <div className="rounded-lg border border-divider bg-content1 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="h-4 w-4 text-default-500" />
          <h3 className="text-sm font-semibold">Create API Key</h3>
        </div>
        <form onSubmit={props.createPlatformKey} className="flex gap-3 items-end">
          <div className="flex-1">
            <TextInput
              label="Name (optional)"
              value={props.platformKeyName}
              onChange={props.setPlatformKeyName}
              placeholder="e.g., Dev CLI Key, CI/CD Key"
            />
          </div>
          <Button type="submit" disabled={props.busy} size="sm">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create key
          </Button>
        </form>
      </div>

      {/* Key table */}
      <div>
        <h3 className="text-sm font-semibold text-default-500 mb-3">
          Existing keys ({props.state.platformKeys.length})
        </h3>
        {props.state.platformKeys.length > 0 ? (
          <div className="rounded-lg border border-divider overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider bg-default-100/50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-default-500">Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-default-500">Key Prefix</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-default-500 hidden md:table-cell">Created</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-default-500 hidden md:table-cell">Last Used</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-default-500">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-default-500"></th>
                </tr>
              </thead>
              <tbody>
                {props.state.platformKeys.map((key) => (
                  <tr key={key.id} className="border-b border-divider last:border-b-0 hover:bg-default-100/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{key.name || "Unnamed Key"}</td>
                    <td className="px-4 py-3 mono text-xs text-default-500">{key.keyHashPrefix}...</td>
                    <td className="px-4 py-3 text-xs text-default-500 hidden md:table-cell">{toDateTime(key.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-default-500 hidden md:table-cell">
                      {key.lastUsedAt ? toDateTime(key.lastUsedAt) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={key.revoked ? "warning" : "success"}>
                        {key.revoked ? "revoked" : "active"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => props.deletePlatformKey(key.id)}
                        disabled={props.busy || key.revoked}
                      >
                        <Trash2 className="h-4 w-4 text-default-500 hover:text-danger" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-divider py-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-default-500/50" />
            <p className="mt-2 text-sm text-default-500">No API keys yet. Create one above.</p>
          </div>
        )}
      </div>
    </div>
  );
}


function TeamTab(props: {
  user: DashboardUser | null;
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  invites: string[];
  addInvite: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-default-500">
        Manage team members and pending invitations.
      </p>

      {/* Current owner card */}
      <div className="rounded-lg border border-divider bg-content1 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{props.user?.name || "Project owner"}</p>
            <p className="text-xs text-default-500">{props.user?.email ?? "owner@n/a"}</p>
          </div>
          <Badge variant="default">Owner</Badge>
        </div>
      </div>

      {/* Invite form */}
      <div className="rounded-lg border border-divider bg-content1 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="h-4 w-4 text-default-500" />
          <h3 className="text-sm font-semibold">Invite Team Member</h3>
        </div>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <TextInput
              label="Email address"
              value={props.inviteEmail}
              onChange={props.setInviteEmail}
              placeholder="engineer@company.com"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={props.addInvite}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Queue invite
          </Button>
        </div>
      </div>

      {/* Pending invites */}
      {props.invites.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-default-500 mb-3">
            Pending invites ({props.invites.length})
          </h3>
          <div className="space-y-2">
            {props.invites.map((invite) => (
              <div key={invite} className="flex items-center justify-between rounded-lg border border-divider bg-content1 px-4 py-3">
                <span className="text-sm">{invite}</span>
                <Badge variant="secondary">pending</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, typeof Play> = {
  report_uploaded: Play,
  drift_uploaded: Zap,
  memory_synced: Database,
  memory_reset: Database,
  webhook_received: GitPullRequest,
  bug_created: Bug,
  bug_updated: Bug,
  vulnerability_found: ShieldAlert,
  vulnerability_resolved: Shield,
  coverage_gaps_uploaded: FileSearch,
  fix_generated: Wrench,
  risk_assessed: AlertTriangle,
  doc_coverage_uploaded: BookOpen,
  prompts_uploaded: Play,
  routes_discovered: Route,
  api_key_created: Key,
  api_key_revoked: Key,
  project_created: FolderPlus,
  project_updated: Settings,
};

function ActivityTab(props: { projectId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api.activity.list({ projectId: props.projectId, days: 14, limit: 100 });
        if (active) setEvents(res.events);
      } catch { /* ignore */ }
      if (active) setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [props.projectId]);

  if (loading) return <p className="text-sm text-default-500">Loading activity...</p>;

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-divider py-8 text-center">
        <History className="mx-auto h-8 w-8 text-default-500/50" />
        <p className="mt-2 text-sm text-default-500">No recent activity. All project events will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-default-500 mb-3">Recent activity for this project.</p>
      {events.map(event => {
        const Icon = ACTIVITY_ICONS[event.eventType] ?? History;
        return (
          <div key={event.id} className="flex items-start gap-3 rounded-lg border border-divider bg-content1 px-4 py-3">
            <Icon className="h-4 w-4 text-default-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{event.eventType.replace(/_/g, " ")}</Badge>
                {event.source && <Badge variant="secondary" className="text-[10px]">{event.source}</Badge>}
              </div>
              {event.summary && <p className="mt-1 text-sm">{event.summary}</p>}
              <p className="mt-0.5 text-[11px] text-default-500">{toDateTime(event.createdAt)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DangerZoneTab(props: {
  project: Project;
  deleteName: string;
  setDeleteName: (v: string) => void;
  deleteProject: () => void;
  busy: boolean;
}) {
  const nameMatches = props.deleteName === props.project.name;

  return (
    <div className="space-y-5">
      {/* Warning banner */}
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            Irreversible actions ahead
          </p>
          <p className="mt-1 text-sm text-default-500">
            Deleting this project will permanently remove all associated data including runs, reports, drift history, detected bugs, and all API keys. This action cannot be undone.
          </p>
        </div>
      </div>

      {/* Delete project card */}
      <div className="rounded-lg border border-red-500/20 bg-content1 p-5">
        <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Delete Project</h3>
        <p className="mt-2 text-sm text-default-500">
          To confirm deletion, type the project name below: <span className="font-mono font-semibold text-foreground">{props.project.name}</span>
        </p>

        <div className="mt-4 max-w-sm space-y-3">
          <TextInput
            label="Project name"
            value={props.deleteName}
            onChange={props.setDeleteName}
          />
          <Button
            variant="destructive"
            onClick={props.deleteProject}
            disabled={props.busy || !nameMatches}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Permanently delete project
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  SettingsContent (main component)                                           */
/* -------------------------------------------------------------------------- */

function SettingsContent(props: { project: Project }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>("API Keys");
  const [state, setState] = useState<SettingsState>({ loading: true, platformKeys: [], user: null, error: null });
  const [platformKeyName, setPlatformKeyName] = useState("My CLI Key");
  const [createdPlatformKey, setCreatedPlatformKey] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invites, setInvites] = useState<string[]>([]);
  const [deleteName, setDeleteName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [platformKeys, me] = await Promise.all([
        api.platformKeys.list({ projectId: props.project.id }),
        api.dashboard.me()
      ]);

      setState({ loading: false, platformKeys: platformKeys.keys, user: me, error: null });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to load settings";
      setState({ loading: false, platformKeys: [], user: null, error: message });
    }
  }

  useEffect(() => {
    void load();
  }, [props.project.id]);

  async function createPlatformKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);

    try {
      const requestPayload = {
        projectId: props.project.id,
        name: platformKeyName.trim() || undefined
      };

      const result = await api.platformKeys.create(requestPayload);

      setCreatedPlatformKey(result.key);
      setPlatformKeyName("");
      await load();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to create API key";
      setState((prev) => ({ ...prev, error: message }));
    } finally {
      setBusy(false);
    }
  }

  async function deletePlatformKey(keyId: string) {
    setBusy(true);
    try {
      await api.platformKeys.delete(keyId);
      await load();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to delete API key";
      setState((prev) => ({ ...prev, error: message }));
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
  }

  async function deleteProject() {
    if (deleteName !== props.project.name) {
      return;
    }

    setBusy(true);

    try {
      await api.projects.remove(props.project.id);
      navigate("/", { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to delete project";
      setState((prev) => ({ ...prev, error: message }));
    } finally {
      setBusy(false);
    }
  }

  function addInvite() {
    const normalized = inviteEmail.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    setInvites((previous) => Array.from(new Set([...previous, normalized])));
    setInviteEmail("");
  }

  if (state.loading) {
    return <Panel><p className="text-sm text-default-500">Loading project settings...</p></Panel>;
  }

  if (state.error && !state.user) {
    return <EmptyState title="Settings unavailable" body={state.error} />;
  }

  return (
    <div className="space-y-6">
      {/* Inline operation error */}
      {state.error && state.user && (
        <div className="flex items-center justify-between rounded-lg border border-danger/20 bg-danger/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
            <p className="text-sm text-danger">{state.error}</p>
          </div>
          <button
            type="button"
            onClick={() => setState((prev) => ({ ...prev, error: null }))}
            className="text-xs text-danger hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-divider bg-content1 p-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tabMeta[tab].icon;
          const isActive = activeTab === tab;
          const isDanger = tab === "Danger Zone";

          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all select-none",
                isActive
                  ? isDanger
                    ? "bg-red-500/20 text-red-500 ring-1 ring-red-500/30"
                    : "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                  : "text-default-500 hover:text-foreground hover:bg-white/5 cursor-pointer"
              )}
            >
              <Icon className={cn("h-4 w-4", isActive && !isDanger && "text-primary-foreground")} />
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "API Keys" && (
          <APIKeysTab
            project={props.project}
            state={state}
            busy={busy}
            platformKeyName={platformKeyName}
            setPlatformKeyName={setPlatformKeyName}
            createdPlatformKey={createdPlatformKey}
            setCreatedPlatformKey={setCreatedPlatformKey}
            createPlatformKey={createPlatformKey}
            deletePlatformKey={deletePlatformKey}
            copyToClipboard={copyToClipboard}
          />
        )}

        {activeTab === "Activity" && (
          <ActivityTab projectId={props.project.id} />
        )}

        {activeTab === "Team" && (
          <TeamTab
            user={state.user}
            inviteEmail={inviteEmail}
            setInviteEmail={setInviteEmail}
            invites={invites}
            addInvite={addInvite}
          />
        )}

        {activeTab === "Danger Zone" && (
          <DangerZoneTab
            project={props.project}
            deleteName={deleteName}
            setDeleteName={setDeleteName}
            deleteProject={deleteProject}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Export                                                                      */
/* -------------------------------------------------------------------------- */

export function ProjectSettingsPage() {
  return <ProjectPageShell>{(project) => <SettingsContent project={project} />}</ProjectPageShell>;
}
