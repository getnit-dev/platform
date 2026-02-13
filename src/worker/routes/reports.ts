import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asInteger, asNonEmptyString, asNumber, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

interface CoverageReportRow {
  id: string;
  projectId: string;
  packageId: string | null;
  runId: string;
  runMode: string;
  branch: string | null;
  commitSha: string | null;
  unitCoverage: number | null;
  integrationCoverage: number | null;
  e2eCoverage: number | null;
  overallCoverage: number | null;
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  bugsFound: number;
  bugsFixed: number;
  reportR2Key: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  llmPromptTokens: number | null;
  llmCompletionTokens: number | null;
  llmTotalTokens: number | null;
  llmCostUsd: number | null;
  executionTimeMs: number | null;
  executionEnvironment: string | null;
  runMetadata: string | null;
  createdAt: string;
}

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const requestedProjectId = asNonEmptyString(payload.projectId);
  const resolved = await resolveProjectForWrite(c, requestedProjectId);
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const reportId = crypto.randomUUID();
  const runId = asNonEmptyString(payload.runId) ?? reportId;
  const runMode = asNonEmptyString(payload.runMode) ?? "full";
  const packageId = asNonEmptyString(payload.packageId);
  const branch = asNonEmptyString(payload.branch);
  const commitSha = asNonEmptyString(payload.commitSha);

  const unitCoverage = asNumber(payload.unitCoverage);
  const integrationCoverage = asNumber(payload.integrationCoverage);
  const e2eCoverage = asNumber(payload.e2eCoverage);
  const overallCoverage = asNumber(payload.overallCoverage);

  const testsGenerated = asInteger(payload.testsGenerated);
  const testsPassed = asInteger(payload.testsPassed);
  const testsFailed = asInteger(payload.testsFailed);
  const bugsFound = asInteger(payload.bugsFound);
  const bugsFixed = asInteger(payload.bugsFixed);

  const llmProvider = asNonEmptyString(payload.llmProvider);
  const llmModel = asNonEmptyString(payload.llmModel);
  const llmPromptTokens = asInteger(payload.llmPromptTokens);
  const llmCompletionTokens = asInteger(payload.llmCompletionTokens);
  const llmTotalTokens = asInteger(payload.llmTotalTokens);
  const llmCostUsd = asNumber(payload.llmCostUsd);
  const executionTimeMs = asInteger(payload.executionTimeMs);
  const executionEnvironment = asNonEmptyString(payload.executionEnvironment);
  const runMetadata = isRecord(payload.runMetadata) ? JSON.stringify(payload.runMetadata) : asNonEmptyString(payload.runMetadata);

  const fullReport = isRecord(payload.fullReport) || Array.isArray(payload.fullReport)
    ? payload.fullReport
    : payload;

  const reportR2Key = `reports/${resolved.projectId}/${reportId}.json`;
  await c.env.R2.put(reportR2Key, JSON.stringify(fullReport), {
    httpMetadata: {
      contentType: "application/json"
    }
  });

  await c.env.DB.prepare(
    `
      INSERT INTO coverage_reports (
        id,
        project_id,
        package_id,
        run_id,
        run_mode,
        branch,
        commit_sha,
        unit_coverage,
        integration_coverage,
        e2e_coverage,
        overall_coverage,
        tests_generated,
        tests_passed,
        tests_failed,
        bugs_found,
        bugs_fixed,
        report_r2_key,
        llm_provider,
        llm_model,
        llm_prompt_tokens,
        llm_completion_tokens,
        llm_total_tokens,
        llm_cost_usd,
        execution_time_ms,
        execution_environment,
        run_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      reportId,
      resolved.projectId,
      packageId,
      runId,
      runMode,
      branch,
      commitSha,
      unitCoverage,
      integrationCoverage,
      e2eCoverage,
      overallCoverage,
      testsGenerated,
      testsPassed,
      testsFailed,
      bugsFound,
      bugsFixed,
      reportR2Key,
      llmProvider,
      llmModel,
      llmPromptTokens,
      llmCompletionTokens,
      llmTotalTokens,
      llmCostUsd,
      executionTimeMs,
      executionEnvironment,
      runMetadata
    )
    .run();

  return c.json({ reportId, reportR2Key }, 201);
});

reportRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const queryProjectId = asNonEmptyString(c.req.query("projectId"));
  const limit = parseLimit(c.req.query("limit"), 50);

  let sql = `
    SELECT
      cr.id AS id,
      cr.project_id AS projectId,
      cr.package_id AS packageId,
      cr.run_id AS runId,
      cr.run_mode AS runMode,
      cr.branch AS branch,
      cr.commit_sha AS commitSha,
      cr.unit_coverage AS unitCoverage,
      cr.integration_coverage AS integrationCoverage,
      cr.e2e_coverage AS e2eCoverage,
      cr.overall_coverage AS overallCoverage,
      cr.tests_generated AS testsGenerated,
      cr.tests_passed AS testsPassed,
      cr.tests_failed AS testsFailed,
      cr.bugs_found AS bugsFound,
      cr.bugs_fixed AS bugsFixed,
      cr.report_r2_key AS reportR2Key,
      cr.llm_provider AS llmProvider,
      cr.llm_model AS llmModel,
      cr.llm_prompt_tokens AS llmPromptTokens,
      cr.llm_completion_tokens AS llmCompletionTokens,
      cr.llm_total_tokens AS llmTotalTokens,
      cr.llm_cost_usd AS llmCostUsd,
      cr.execution_time_ms AS executionTimeMs,
      cr.execution_environment AS executionEnvironment,
      cr.run_metadata AS runMetadata,
      cr.created_at AS createdAt
    FROM coverage_reports cr
    INNER JOIN projects p ON p.id = cr.project_id
    WHERE p.user_id = ?
  `;
  const binds: Array<string | number> = [actor.userId];

  if (queryProjectId) {
    if (!(await canAccessProject(c, queryProjectId))) {
      return c.json({ error: "Project access denied" }, 403);
    }

    sql += " AND cr.project_id = ?";
    binds.push(queryProjectId);
  }

  if (actor.mode === "api-key" && actor.projectId) {
    sql += " AND cr.project_id = ?";
    binds.push(actor.projectId);
  }

  sql += " ORDER BY cr.created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<CoverageReportRow>();
  return c.json({ reports: rows.results });
});

reportRoutes.get("/:reportId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const reportId = c.req.param("reportId");

  const row = await c.env.DB.prepare(
    `
      SELECT
        cr.id AS id,
        cr.project_id AS projectId,
        cr.package_id AS packageId,
        cr.run_id AS runId,
        cr.run_mode AS runMode,
        cr.branch AS branch,
        cr.commit_sha AS commitSha,
        cr.unit_coverage AS unitCoverage,
        cr.integration_coverage AS integrationCoverage,
        cr.e2e_coverage AS e2eCoverage,
        cr.overall_coverage AS overallCoverage,
        cr.tests_generated AS testsGenerated,
        cr.tests_passed AS testsPassed,
        cr.tests_failed AS testsFailed,
        cr.bugs_found AS bugsFound,
        cr.bugs_fixed AS bugsFixed,
        cr.report_r2_key AS reportR2Key,
        cr.llm_provider AS llmProvider,
        cr.llm_model AS llmModel,
        cr.llm_prompt_tokens AS llmPromptTokens,
        cr.llm_completion_tokens AS llmCompletionTokens,
        cr.llm_total_tokens AS llmTotalTokens,
        cr.llm_cost_usd AS llmCostUsd,
        cr.execution_time_ms AS executionTimeMs,
        cr.execution_environment AS executionEnvironment,
        cr.run_metadata AS runMetadata,
        cr.created_at AS createdAt
      FROM coverage_reports cr
      INNER JOIN projects p ON p.id = cr.project_id
      WHERE cr.id = ? AND p.user_id = ?
      LIMIT 1
    `
  )
    .bind(reportId, actor.userId)
    .first<CoverageReportRow>();

  if (!row) {
    return c.json({ error: "Report not found" }, 404);
  }

  const includeFull = c.req.query("includeFull") === "1";
  if (!includeFull || !row.reportR2Key) {
    return c.json({ report: row });
  }

  const object = await c.env.R2.get(row.reportR2Key);
  const fullReportText = object ? await object.text() : null;
  let fullReport: unknown = null;

  if (fullReportText) {
    try {
      fullReport = JSON.parse(fullReportText);
    } catch {
      fullReport = fullReportText;
    }
  }

  return c.json({
    report: row,
    fullReport
  });
});
