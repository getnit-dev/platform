import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString, asNumber, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

interface PromptRecordRow {
  id: string;
  projectId: string;
  sessionId: string | null;
  model: string;
  messages: string;
  temperature: number | null;
  maxTokens: number | null;
  metadata: string | null;
  responseText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  sourceFile: string | null;
  templateName: string | null;
  builderName: string | null;
  framework: string | null;
  contextTokens: number | null;
  outcome: string | null;
  validationAttempts: number | null;
  errorMessage: string | null;
  comparisonGroupId: string | null;
  createdAt: string;
}

export const promptRoutes = new Hono<AppEnv>();

// POST / - Batch insert prompt records
promptRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const records = Array.isArray(payload.records) ? payload.records : [];

  if (records.length === 0) {
    return c.json({ error: "records array is required" }, 400);
  }

  const statements: D1PreparedStatement[] = [];

  for (const r of records) {
    if (!isRecord(r)) continue;

    const model = asNonEmptyString(r.model);
    const messages = asNonEmptyString(r.messages);

    if (!model || !messages) continue;

    const id = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO prompt_records (
          id, project_id, session_id, model, messages,
          temperature, max_tokens, metadata, response_text,
          prompt_tokens, completion_tokens, total_tokens, duration_ms,
          source_file, template_name, builder_name, framework, context_tokens,
          outcome, validation_attempts, error_message, comparison_group_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        resolved.projectId,
        asNonEmptyString(r.sessionId),
        model,
        messages,
        asNumber(r.temperature),
        asNumber(r.maxTokens),
        asNonEmptyString(r.metadata),
        asNonEmptyString(r.responseText),
        asNumber(r.promptTokens),
        asNumber(r.completionTokens),
        asNumber(r.totalTokens),
        asNumber(r.durationMs),
        asNonEmptyString(r.sourceFile),
        asNonEmptyString(r.templateName),
        asNonEmptyString(r.builderName),
        asNonEmptyString(r.framework),
        asNumber(r.contextTokens),
        asNonEmptyString(r.outcome) ?? "pending",
        asNumber(r.validationAttempts) ?? 0,
        asNonEmptyString(r.errorMessage),
        asNonEmptyString(r.comparisonGroupId)
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ inserted: statements.length }, 201);
});

// GET / - List prompts with filters
promptRoutes.get("/", async (c) => {
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

  const model = asNonEmptyString(c.req.query("model"));
  const template = asNonEmptyString(c.req.query("template"));
  const outcome = asNonEmptyString(c.req.query("outcome"));
  const limit = parseLimit(c.req.query("limit"), 100);

  let sql = `
    SELECT
      id, project_id AS projectId, session_id AS sessionId,
      model, messages, temperature, max_tokens AS maxTokens,
      metadata, response_text AS responseText,
      prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
      total_tokens AS totalTokens, duration_ms AS durationMs,
      source_file AS sourceFile, template_name AS templateName,
      builder_name AS builderName, framework, context_tokens AS contextTokens,
      outcome, validation_attempts AS validationAttempts,
      error_message AS errorMessage, comparison_group_id AS comparisonGroupId,
      created_at AS createdAt
    FROM prompt_records
    WHERE project_id = ?
  `;
  const binds: Array<string | number> = [projectId];

  if (model) {
    sql += " AND model = ?";
    binds.push(model);
  }
  if (template) {
    sql += " AND template_name = ?";
    binds.push(template);
  }
  if (outcome) {
    sql += " AND outcome = ?";
    binds.push(outcome);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<PromptRecordRow>();
  return c.json({ records: rows.results });
});

// GET /analytics - Aggregated stats
promptRoutes.get("/analytics", async (c) => {
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
    "SELECT COUNT(*) AS total FROM prompt_records WHERE project_id = ?"
  ).bind(projectId).first<{ total: number }>();

  const successRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM prompt_records WHERE project_id = ? AND outcome = 'success'"
  ).bind(projectId).first<{ total: number }>();

  const failedRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM prompt_records WHERE project_id = ? AND outcome = 'failed'"
  ).bind(projectId).first<{ total: number }>();

  const byModelRows = await c.env.DB.prepare(
    `SELECT model, COUNT(*) AS count,
       SUM(prompt_tokens) AS promptTokens,
       SUM(completion_tokens) AS completionTokens,
       SUM(total_tokens) AS totalTokens,
       AVG(duration_ms) AS avgDurationMs
     FROM prompt_records WHERE project_id = ?
     GROUP BY model ORDER BY count DESC`
  ).bind(projectId).all<{
    model: string;
    count: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    avgDurationMs: number | null;
  }>();

  const byTemplateRows = await c.env.DB.prepare(
    `SELECT template_name AS templateName, COUNT(*) AS count,
       SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes,
       SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failures,
       AVG(duration_ms) AS avgDurationMs
     FROM prompt_records WHERE project_id = ? AND template_name IS NOT NULL
     GROUP BY template_name ORDER BY count DESC`
  ).bind(projectId).all<{
    templateName: string;
    count: number;
    successes: number;
    failures: number;
    avgDurationMs: number | null;
  }>();

  const trendRows = await c.env.DB.prepare(
    `SELECT date(created_at) AS date, COUNT(*) AS count
     FROM prompt_records WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
     GROUP BY date(created_at) ORDER BY date ASC`
  ).bind(projectId).all<{ date: string; count: number }>();

  const total = totalRow?.total ?? 0;
  const successes = successRow?.total ?? 0;

  return c.json({
    totalRecords: total,
    successCount: successes,
    failedCount: failedRow?.total ?? 0,
    successRate: total > 0 ? successes / total : 0,
    byModel: byModelRows.results,
    byTemplate: byTemplateRows.results,
    recentTrend: trendRows.results
  });
});

// GET /comparison/:groupId - Get all records in a comparison group
promptRoutes.get("/comparison/:groupId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const groupId = c.req.param("groupId");

  const rows = await c.env.DB.prepare(
    `SELECT
      pr.id, pr.project_id AS projectId, pr.session_id AS sessionId,
      pr.model, pr.messages, pr.temperature, pr.max_tokens AS maxTokens,
      pr.metadata, pr.response_text AS responseText,
      pr.prompt_tokens AS promptTokens, pr.completion_tokens AS completionTokens,
      pr.total_tokens AS totalTokens, pr.duration_ms AS durationMs,
      pr.source_file AS sourceFile, pr.template_name AS templateName,
      pr.builder_name AS builderName, pr.framework, pr.context_tokens AS contextTokens,
      pr.outcome, pr.validation_attempts AS validationAttempts,
      pr.error_message AS errorMessage, pr.comparison_group_id AS comparisonGroupId,
      pr.created_at AS createdAt
    FROM prompt_records pr
    INNER JOIN projects p ON p.id = pr.project_id
    WHERE pr.comparison_group_id = ? AND p.user_id = ?
    ORDER BY pr.created_at ASC`
  ).bind(groupId, actor.userId).all<PromptRecordRow>();

  return c.json({ records: rows.results });
});

// GET /:id - Get single prompt record by ID
promptRoutes.get("/:id", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT
      pr.id, pr.project_id AS projectId, pr.session_id AS sessionId,
      pr.model, pr.messages, pr.temperature, pr.max_tokens AS maxTokens,
      pr.metadata, pr.response_text AS responseText,
      pr.prompt_tokens AS promptTokens, pr.completion_tokens AS completionTokens,
      pr.total_tokens AS totalTokens, pr.duration_ms AS durationMs,
      pr.source_file AS sourceFile, pr.template_name AS templateName,
      pr.builder_name AS builderName, pr.framework, pr.context_tokens AS contextTokens,
      pr.outcome, pr.validation_attempts AS validationAttempts,
      pr.error_message AS errorMessage, pr.comparison_group_id AS comparisonGroupId,
      pr.created_at AS createdAt
    FROM prompt_records pr
    INNER JOIN projects p ON p.id = pr.project_id
    WHERE pr.id = ? AND p.user_id = ?
    LIMIT 1`
  ).bind(id, actor.userId).first<PromptRecordRow>();

  if (!row) {
    return c.json({ error: "Prompt record not found" }, 404);
  }

  return c.json({ record: row });
});
