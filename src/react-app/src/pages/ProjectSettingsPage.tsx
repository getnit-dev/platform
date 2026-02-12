import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Trash2, Key, Bell, Users, AlertTriangle, Shield, Plus, RotateCw } from "lucide-react";
import { EmptyState, Panel, StatusPill, TextInput } from "../components/ui";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { api, ApiError, type DashboardUser, type Project, type VirtualKey, type PlatformApiKey } from "../lib/api";
import { toCurrency, toDateTime } from "../lib/format";
import { useAlertConfig } from "../lib/alert-config";
import { ProjectPageShell } from "./project-shared";
import { cn } from "../lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface SettingsState {
  loading: boolean;
  keys: VirtualKey[];
  platformKeys: PlatformApiKey[];
  user: DashboardUser | null;
  error: string | null;
}

const tabs = ["Virtual Keys", "API Keys", "Alerts", "Team", "Danger Zone"] as const;
type SettingsTab = typeof tabs[number];

const tabMeta: Record<SettingsTab, { icon: typeof Key }> = {
  "Virtual Keys": { icon: Key },
  "API Keys": { icon: Shield },
  "Alerts": { icon: Bell },
  "Team": { icon: Users },
  "Danger Zone": { icon: AlertTriangle },
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function parseNumberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/* -------------------------------------------------------------------------- */
/*  KeyRow                                                                     */
/* -------------------------------------------------------------------------- */

function KeyRow(props: {
  keyRecord: VirtualKey;
  onRevoke: (id: string) => Promise<void>;
  onRotate: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: { name?: string; maxBudget?: number; rpmLimit?: number; tpmLimit?: number; modelsAllowed?: string[] }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(props.keyRecord.name ?? "");
  const [maxBudget, setMaxBudget] = useState(props.keyRecord.maxBudget?.toString() ?? "");
  const [rpmLimit, setRpmLimit] = useState(props.keyRecord.rpmLimit?.toString() ?? "");
  const [tpmLimit, setTpmLimit] = useState(props.keyRecord.tpmLimit?.toString() ?? "");
  const [modelsAllowed, setModelsAllowed] = useState(props.keyRecord.modelsAllowed.join(", "));

  async function save() {
    await props.onUpdate(props.keyRecord.id, {
      name: name.trim() || undefined,
      maxBudget: parseNumberOrUndefined(maxBudget),
      rpmLimit: parseNumberOrUndefined(rpmLimit),
      tpmLimit: parseNumberOrUndefined(tpmLimit),
      modelsAllowed: modelsAllowed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card transition-colors">
      {/* Summary row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{props.keyRecord.name || "Unnamed Key"}</span>
              <span className="mono text-xs text-muted-foreground">{props.keyRecord.keyHashPrefix}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>Spend: {toCurrency(props.keyRecord.spendTotal)}</span>
              {props.keyRecord.maxBudget != null && (
                <span>Budget: {toCurrency(props.keyRecord.maxBudget)}</span>
              )}
              <span>Created {toDateTime(props.keyRecord.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill
            label={props.keyRecord.revoked ? "revoked" : "active"}
            tone={props.keyRecord.revoked ? "warn" : "good"}
          />
          <svg
            className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded edit area */}
      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <TextInput label="Name" value={name} onChange={setName} placeholder="Production API" />
            <TextInput label="Models (comma-separated)" value={modelsAllowed} onChange={setModelsAllowed} placeholder="gpt-4o-mini, claude-3-5" />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <TextInput label="Max budget (USD)" value={maxBudget} onChange={setMaxBudget} />
            <TextInput label="RPM limit" value={rpmLimit} onChange={setRpmLimit} />
            <TextInput label="TPM limit" value={tpmLimit} onChange={setTpmLimit} />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="default" size="sm" onClick={save}>
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={() => props.onRotate(props.keyRecord.id)}>
              <RotateCw className="h-3.5 w-3.5 mr-1" />
              Rotate
            </Button>
            <Button variant="destructive" size="sm" onClick={() => props.onRevoke(props.keyRecord.id)}>
              Revoke
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab Panels                                                                 */
/* -------------------------------------------------------------------------- */

function VirtualKeysTab(props: {
  project: Project;
  state: SettingsState;
  busy: boolean;
  setBusy: (v: boolean) => void;
  latestPlainKey: string | null;
  setLatestPlainKey: (v: string | null) => void;
  createKeyName: string;
  setCreateKeyName: (v: string) => void;
  createKeyModelInput: string;
  setCreateKeyModelInput: (v: string) => void;
  createKeyBudget: string;
  setCreateKeyBudget: (v: string) => void;
  createKeyRpm: string;
  setCreateKeyRpm: (v: string) => void;
  createKeyTpm: string;
  setCreateKeyTpm: (v: string) => void;
  createKey: (e: FormEvent<HTMLFormElement>) => void;
  revokeKey: (id: string) => Promise<void>;
  rotateKey: (id: string) => Promise<void>;
  updateKey: (id: string, patch: { name?: string; maxBudget?: number; rpmLimit?: number; tpmLimit?: number; modelsAllowed?: string[] }) => Promise<void>;
  totalBudget: number;
  copyToClipboard: (text: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Budget summary bar */}
      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
          <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium">Total configured budget</p>
          <p className="text-lg font-semibold tabular-nums">{toCurrency(props.totalBudget)}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-muted-foreground">{props.state.keys.length} key{props.state.keys.length !== 1 ? "s" : ""}</p>
          <p className="text-xs text-muted-foreground">{props.state.keys.filter(k => !k.revoked).length} active</p>
        </div>
      </div>

      {/* Created key banner */}
      {props.latestPlainKey && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold">Virtual Key Created Successfully!</p>
          </div>
          <p className="text-xs text-muted-foreground">Save this key now — it will not be shown again.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={props.latestPlainKey}
              className="mono flex-1 rounded-md bg-secondary px-3 py-1.5 text-xs border border-border"
            />
            <Button variant="outline" size="sm" onClick={() => props.copyToClipboard(props.latestPlainKey!)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <pre className="rounded-md bg-secondary px-3 py-1.5 text-xs overflow-x-auto border border-border">
            <code>export OPENAI_API_KEY={props.latestPlainKey}</code>
          </pre>
          <Button variant="secondary" size="sm" onClick={() => props.setLatestPlainKey(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Create new key form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Create Virtual Key</h3>
        </div>
        <form onSubmit={props.createKey} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label="Name (optional)" value={props.createKeyName} onChange={props.setCreateKeyName} placeholder="e.g., Production API, Staging Key" />
            <TextInput label="Models (comma-separated)" value={props.createKeyModelInput} onChange={props.setCreateKeyModelInput} placeholder="gpt-4o-mini, claude-3-5" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <TextInput label="Max budget (USD)" value={props.createKeyBudget} onChange={props.setCreateKeyBudget} />
            <TextInput label="RPM limit" value={props.createKeyRpm} onChange={props.setCreateKeyRpm} />
            <TextInput label="TPM limit" value={props.createKeyTpm} onChange={props.setCreateKeyTpm} />
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={props.busy} size="sm">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Create key
            </Button>
          </div>
        </form>
      </div>

      {/* Key list */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">
          Existing keys ({props.state.keys.length})
        </h3>
        {props.state.keys.length > 0 ? (
          <div className="space-y-2">
            {props.state.keys.map((keyRecord) => (
              <KeyRow
                key={keyRecord.id}
                keyRecord={keyRecord}
                onRevoke={props.revokeKey}
                onRotate={props.rotateKey}
                onUpdate={props.updateKey}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <Key className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">No virtual keys yet. Create one above.</p>
          </div>
        )}
      </div>
    </div>
  );
}

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
      <p className="text-sm text-muted-foreground">
        Create API keys for CLI authentication and data reporting.
      </p>

      {/* Created key banner */}
      {props.createdPlatformKey && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold">API Key Created Successfully!</p>
          </div>
          <p className="text-xs text-muted-foreground">Save this key now — it will not be shown again.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={props.createdPlatformKey}
              className="mono flex-1 rounded-md bg-secondary px-3 py-1.5 text-xs border border-border"
            />
            <Button variant="outline" size="sm" onClick={() => props.copyToClipboard(props.createdPlatformKey!)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <pre className="rounded-md bg-secondary px-3 py-1.5 text-xs overflow-x-auto border border-border">
            <code>export NIT_PLATFORM_REPORTING_API_KEY={props.createdPlatformKey}</code>
          </pre>
          <Button variant="secondary" size="sm" onClick={() => props.setCreatedPlatformKey(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Create form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="h-4 w-4 text-muted-foreground" />
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
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">
          Existing keys ({props.state.platformKeys.length})
        </h3>
        {props.state.platformKeys.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Key Prefix</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Created</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Last Used</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {props.state.platformKeys.map((key) => (
                  <tr key={key.id} className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{key.name || "Unnamed Key"}</td>
                    <td className="px-4 py-3 mono text-xs text-muted-foreground">{key.keyHashPrefix}...</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{toDateTime(key.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
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
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">No API keys yet. Create one above.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AlertsTab(props: {
  projectId: string;
  alertConfig: ReturnType<typeof useAlertConfig>[0];
  setAlertConfig: ReturnType<typeof useAlertConfig>[1];
  alertValidationError: string | null;
  alertLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure notifications for cost alerts, budget warnings, and anomaly detection.
      </p>

      {/* Validation error */}
      {props.alertValidationError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{props.alertValidationError}</p>
        </div>
      )}

      {/* Slack section */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold">Slack Notifications</h3>
        </div>
        <TextInput
          label="Webhook URL"
          value={props.alertConfig.slackWebhook}
          onChange={(value) => props.setAlertConfig((previous) => ({ ...previous, slackWebhook: value }))}
          placeholder="https://hooks.slack.com/services/..."
        />
      </div>

      {/* Email section */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold">Email Alerts</h3>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label="Email threshold (USD)"
            value={props.alertConfig.emailThresholdUsd}
            onChange={(value) => props.setAlertConfig((previous) => ({ ...previous, emailThresholdUsd: value }))}
            placeholder="250"
          />
          <TextInput
            label="Budget alert (%)"
            value={props.alertConfig.budgetAlertPercent}
            onChange={(value) => props.setAlertConfig((previous) => ({ ...previous, budgetAlertPercent: value }))}
            placeholder="85"
          />
        </div>

        <TextInput
          label="Email recipients (comma-separated)"
          value={props.alertConfig.emailRecipients}
          onChange={(value) => props.setAlertConfig((previous) => ({ ...previous, emailRecipients: value }))}
          placeholder="alerts@company.com, team@company.com"
        />

        {/* Resend configuration sub-section */}
        <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Resend Email Configuration
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput
              label="Resend API Key"
              value={props.alertConfig.resendApiKey}
              onChange={(value) => props.setAlertConfig((previous) => ({ ...previous, resendApiKey: value }))}
              placeholder="re_..."
            />
            <TextInput
              label="From Address"
              value={props.alertConfig.emailFromAddress}
              onChange={(value) => props.setAlertConfig((previous) => ({ ...previous, emailFromAddress: value }))}
              placeholder="alerts@yourdomain.com"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Get your API key from{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              resend.com/api-keys
            </a>
            . From address must be verified in your Resend account.
          </p>
        </div>
      </div>

      {/* Auto-save indicator */}
      {!props.alertValidationError && !props.alertLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Configuration saved automatically</p>
        </div>
      )}
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
      <p className="text-sm text-muted-foreground">
        Manage team members and pending invitations.
      </p>

      {/* Current owner card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{props.user?.name || "Project owner"}</p>
            <p className="text-xs text-muted-foreground">{props.user?.email ?? "owner@n/a"}</p>
          </div>
          <Badge variant="default">Owner</Badge>
        </div>
      </div>

      {/* Invite form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="h-4 w-4 text-muted-foreground" />
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
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Pending invites ({props.invites.length})
          </h3>
          <div className="space-y-2">
            {props.invites.map((invite) => (
              <div key={invite} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
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
          <p className="mt-1 text-sm text-muted-foreground">
            Deleting this project will permanently remove all associated data including runs, reports, drift history, detected bugs, and all API keys. This action cannot be undone.
          </p>
        </div>
      </div>

      {/* Delete project card */}
      <div className="rounded-lg border border-red-500/20 bg-card p-5">
        <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Delete Project</h3>
        <p className="mt-2 text-sm text-muted-foreground">
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("Virtual Keys");
  const [state, setState] = useState<SettingsState>({ loading: true, keys: [], platformKeys: [], user: null, error: null });
  const [alertConfig, setAlertConfig, alertValidationError, alertLoading] = useAlertConfig(props.project.id);
  const [createKeyName, setCreateKeyName] = useState("Production API");
  const [createKeyModelInput, setCreateKeyModelInput] = useState("");
  const [createKeyBudget, setCreateKeyBudget] = useState("");
  const [createKeyRpm, setCreateKeyRpm] = useState("");
  const [createKeyTpm, setCreateKeyTpm] = useState("");
  const [latestPlainKey, setLatestPlainKey] = useState<string | null>(null);
  const [platformKeyName, setPlatformKeyName] = useState("My CLI Key");
  const [createdPlatformKey, setCreatedPlatformKey] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invites, setInvites] = useState<string[]>([]);
  const [deleteName, setDeleteName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [keys, platformKeys, me] = await Promise.all([
        api.llmKeys.list({ projectId: props.project.id }),
        api.platformKeys.list({ projectId: props.project.id }),
        api.dashboard.me()
      ]);

      setState({ loading: false, keys: keys.keys, platformKeys: platformKeys.keys, user: me, error: null });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to load settings";
      setState({ loading: false, keys: [], platformKeys: [], user: null, error: message });
    }
  }

  useEffect(() => {
    void load();
  }, [props.project.id]);

  const totalBudget = useMemo(
    () => state.keys.reduce((sum, key) => sum + Number(key.maxBudget ?? 0), 0),
    [state.keys]
  );

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);

    try {
      const result = await api.llmKeys.create({
        projectId: props.project.id,
        name: createKeyName.trim() || undefined,
        modelsAllowed: createKeyModelInput.split(",").map((value) => value.trim()).filter(Boolean),
        maxBudget: parseNumberOrUndefined(createKeyBudget),
        rpmLimit: parseNumberOrUndefined(createKeyRpm),
        tpmLimit: parseNumberOrUndefined(createKeyTpm)
      });

      setLatestPlainKey(result.key);
      setCreateKeyName("");
      setCreateKeyModelInput("");
      setCreateKeyBudget("");
      setCreateKeyRpm("");
      setCreateKeyTpm("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId: string) {
    setBusy(true);
    try {
      await api.llmKeys.revoke(keyId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey(keyId: string) {
    setBusy(true);
    try {
      const response = await api.llmKeys.rotate(keyId);
      setLatestPlainKey(response.key);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updateKey(
    keyId: string,
    patch: { maxBudget?: number; rpmLimit?: number; tpmLimit?: number; modelsAllowed?: string[] }
  ) {
    setBusy(true);
    try {
      await api.llmKeys.update(keyId, patch);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function createPlatformKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);

    try {
      const requestPayload = {
        projectId: props.project.id,
        name: platformKeyName.trim() || undefined
      };

      console.log("[Frontend] Creating platform key with payload:", requestPayload);
      console.log("[Frontend] platformKeyName state value:", platformKeyName);

      const result = await api.platformKeys.create(requestPayload);

      setCreatedPlatformKey(result.key);
      setPlatformKeyName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deletePlatformKey(keyId: string) {
    setBusy(true);
    try {
      await api.platformKeys.delete(keyId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  async function deleteProject() {
    if (deleteName !== props.project.name) {
      return;
    }

    setBusy(true);

    try {
      await api.projects.remove(props.project.id);
      navigate("/", { replace: true });
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
    return <Panel><p className="text-sm text-muted-foreground">Loading project settings...</p></Panel>;
  }

  if (state.error) {
    return <EmptyState title="Settings unavailable" body={state.error} />;
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1.5 overflow-x-auto">
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
                    : "bg-blue-600 text-white shadow-md shadow-blue-600/25"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5 cursor-pointer"
              )}
            >
              <Icon className={cn("h-4 w-4", isActive && !isDanger && "text-white")} />
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "Virtual Keys" && (
          <VirtualKeysTab
            project={props.project}
            state={state}
            busy={busy}
            setBusy={setBusy}
            latestPlainKey={latestPlainKey}
            setLatestPlainKey={setLatestPlainKey}
            createKeyName={createKeyName}
            setCreateKeyName={setCreateKeyName}
            createKeyModelInput={createKeyModelInput}
            setCreateKeyModelInput={setCreateKeyModelInput}
            createKeyBudget={createKeyBudget}
            setCreateKeyBudget={setCreateKeyBudget}
            createKeyRpm={createKeyRpm}
            setCreateKeyRpm={setCreateKeyRpm}
            createKeyTpm={createKeyTpm}
            setCreateKeyTpm={setCreateKeyTpm}
            createKey={createKey}
            revokeKey={revokeKey}
            rotateKey={rotateKey}
            updateKey={updateKey}
            totalBudget={totalBudget}
            copyToClipboard={copyToClipboard}
          />
        )}

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

        {activeTab === "Alerts" && (
          <AlertsTab
            projectId={props.project.id}
            alertConfig={alertConfig}
            setAlertConfig={setAlertConfig}
            alertValidationError={alertValidationError}
            alertLoading={alertLoading}
          />
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
