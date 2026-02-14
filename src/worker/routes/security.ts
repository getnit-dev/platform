import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { actorSource, logActivity } from "../lib/activity";
import { asNonEmptyString, asNumber, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

interface SecurityFindingRow {
  id: string;
  projectId: string;
  runId: string | null;
  vulnerabilityType: string;
  severity: string;
  filePath: string;
  lineNumber: number | null;
  functionName: string | null;
  title: string;
  description: string;
  remediation: string | null;
  confidence: number | null;
  cweId: string | null;
  evidence: string | null;
  detectionMethod: string | null;
  status: string;
  resolvedAt: string | null;
  createdAt: string;
}

export const securityRoutes = new Hono<AppEnv>();

securityRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const runId = asNonEmptyString(payload.runId);
  const findings = Array.isArray(payload.findings) ? payload.findings : [];

  if (findings.length === 0) {
    return c.json({ error: "findings array is required" }, 400);
  }

  const statements: D1PreparedStatement[] = [];

  for (const f of findings) {
    if (!isRecord(f)) continue;

    const filePath = asNonEmptyString(f.filePath);
    const title = asNonEmptyString(f.title);
    const description = asNonEmptyString(f.description);
    const vulnerabilityType = asNonEmptyString(f.vulnerabilityType);
    const severity = asNonEmptyString(f.severity);

    if (!filePath || !title || !description || !vulnerabilityType || !severity) continue;

    const id = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO security_findings (id, project_id, run_id, vulnerability_type, severity, file_path, line_number, function_name, title, description, remediation, confidence, cwe_id, evidence, detection_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        resolved.projectId,
        runId,
        vulnerabilityType,
        severity,
        filePath,
        asNumber(f.lineNumber),
        asNonEmptyString(f.functionName),
        title,
        description,
        asNonEmptyString(f.remediation),
        asNumber(f.confidence),
        asNonEmptyString(f.cweId),
        asNonEmptyString(f.evidence),
        asNonEmptyString(f.detectionMethod)
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  logActivity({
    db: c.env.DB,
    projectId: resolved.projectId,
    eventType: "vulnerability_found",
    source: actorSource(resolved.actor),
    summary: `${statements.length} security finding(s) uploaded`,
    metadata: { count: statements.length, runId }
  });

  return c.json({ inserted: statements.length }, 201);
});

securityRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  if (!(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const status = asNonEmptyString(c.req.query("status"));
  const severity = asNonEmptyString(c.req.query("severity"));
  const vulnerabilityType = asNonEmptyString(c.req.query("vulnerabilityType"));
  const limit = parseLimit(c.req.query("limit"), 100);

  let sql = `
    SELECT
      id, project_id AS projectId, run_id AS runId,
      vulnerability_type AS vulnerabilityType, severity,
      file_path AS filePath, line_number AS lineNumber,
      function_name AS functionName, title, description,
      remediation, confidence, cwe_id AS cweId,
      evidence, detection_method AS detectionMethod,
      status, resolved_at AS resolvedAt, created_at AS createdAt
    FROM security_findings
    WHERE project_id = ?
  `;
  const binds: Array<string | number> = [projectId];

  if (status) {
    sql += " AND status = ?";
    binds.push(status);
  }
  if (severity) {
    sql += " AND severity = ?";
    binds.push(severity);
  }
  if (vulnerabilityType) {
    sql += " AND vulnerability_type = ?";
    binds.push(vulnerabilityType);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<SecurityFindingRow>();
  return c.json({ findings: rows.results });
});

securityRoutes.patch("/:findingId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const findingId = c.req.param("findingId");
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const status = asNonEmptyString(payload.status);
  if (!status) {
    return c.json({ error: "status is required" }, 400);
  }

  let sql = "UPDATE security_findings SET status = ?";
  const binds: Array<string | null> = [status];

  if (["resolved", "false_positive"].includes(status)) {
    sql += ", resolved_at = datetime('now')";
  }

  sql += " WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)";
  binds.push(findingId, actor.userId);

  const result = await c.env.DB.prepare(sql).bind(...binds).run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Finding not found" }, 404);
  }

  const finding = await c.env.DB.prepare(
    "SELECT project_id AS projectId FROM security_findings WHERE id = ?"
  ).bind(findingId).first<{ projectId: string }>();

  if (finding) {
    logActivity({
      db: c.env.DB,
      projectId: finding.projectId,
      eventType: "vulnerability_resolved",
      source: actorSource(actor),
      summary: `Security finding marked as ${status}`,
      metadata: { findingId, status }
    });
  }

  return c.json({ updated: true });
});

securityRoutes.get("/summary", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  if (!(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const totalRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM security_findings WHERE project_id = ?"
  ).bind(projectId).first<{ total: number }>();

  const openRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM security_findings WHERE project_id = ? AND status = 'open'"
  ).bind(projectId).first<{ total: number }>();

  const severityRows = await c.env.DB.prepare(
    "SELECT severity, COUNT(*) AS count FROM security_findings WHERE project_id = ? GROUP BY severity"
  ).bind(projectId).all<{ severity: string; count: number }>();

  const typeRows = await c.env.DB.prepare(
    "SELECT vulnerability_type AS type, COUNT(*) AS count FROM security_findings WHERE project_id = ? GROUP BY vulnerability_type ORDER BY count DESC"
  ).bind(projectId).all<{ type: string; count: number }>();

  const trendRows = await c.env.DB.prepare(
    `SELECT date(created_at) AS date, COUNT(*) AS count
     FROM security_findings WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
     GROUP BY date(created_at) ORDER BY date ASC`
  ).bind(projectId).all<{ date: string; count: number }>();

  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of severityRows.results) {
    const key = row.severity.toLowerCase();
    if (key in bySeverity) {
      bySeverity[key] = row.count;
    }
  }

  return c.json({
    totalFindings: totalRow?.total ?? 0,
    openFindings: openRow?.total ?? 0,
    bySeverity,
    byType: typeRows.results,
    recentTrend: trendRows.results
  });
});
