import type { RequestActor } from "./access";

export interface ActivityLogParams {
  db: D1Database;
  projectId: string;
  eventType: string;
  source?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget activity log insertion.
 * Never throws, never blocks the caller's response.
 */
export function logActivity(params: ActivityLogParams): void {
  const { db, projectId, eventType, source, summary, metadata } = params;
  const id = crypto.randomUUID();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  void db
    .prepare(
      `INSERT INTO activity_log (id, project_id, event_type, source, summary, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, eventType, source ?? null, summary ?? null, metadataJson)
    .run()
    .catch(() => {});
}

export function actorSource(actor: RequestActor): string {
  return actor.mode === "api-key" ? "cli" : "dashboard";
}
