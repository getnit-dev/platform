import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { actorSource, logActivity } from "../lib/activity";
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
  prNumber: number | null;
  prUrl: string | null;
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
  const prNumber = asInteger(payload.prNumber, 0) || null;
  const prUrl = asNonEmptyString(payload.prUrl);

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
        run_metadata,
        pr_number,
        pr_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      runMetadata,
      prNumber,
      prUrl
    )
    .run();

  logActivity({
    db: c.env.DB,
    projectId: resolved.projectId,
    eventType: "report_uploaded",
    source: actorSource(resolved.actor),
    summary: `Coverage report uploaded (${runMode}, overall: ${overallCoverage ?? "N/A"}%)`,
    metadata: { reportId, runId, runMode, branch, overallCoverage }
  });

  return c.json({ reportId, reportR2Key }, 201);
});

reportRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const queryProjectId = asNonEmptyString(c.req.query("projectId"));
  const queryBranch = asNonEmptyString(c.req.query("branch"));
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

  if (queryBranch) {
    sql += " AND cr.branch = ?";
    binds.push(queryBranch);
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

/* ---- GET /branches — List branches with stats ----------------------------- */

reportRoutes.get("/branches", async (c) => {
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

  const rows = await c.env.DB.prepare(
    `SELECT
       branch,
       COUNT(*) AS runCount,
       AVG(overall_coverage) AS avgCoverage,
       MAX(created_at) AS lastRun
     FROM coverage_reports
     WHERE project_id = ? AND branch IS NOT NULL
     GROUP BY branch
     ORDER BY lastRun DESC`
  ).bind(projectId).all<{ branch: string; runCount: number; avgCoverage: number | null; lastRun: string }>();

  return c.json({ branches: rows.results });
});

/* ---- GET /compare — Compare two runs -------------------------------------- */

reportRoutes.get("/compare", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const runIdA = asNonEmptyString(c.req.query("runIdA"));
  const runIdB = asNonEmptyString(c.req.query("runIdB"));

  if (!projectId || !runIdA || !runIdB) {
    return c.json({ error: "projectId, runIdA, and runIdB are required" }, 400);
  }

  if (!(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const selectSql = `
    SELECT
      run_id AS runId, run_mode AS runMode, branch,
      AVG(overall_coverage) AS overallCoverage,
      SUM(tests_generated) AS testsGenerated,
      SUM(tests_passed) AS testsPassed,
      SUM(tests_failed) AS testsFailed,
      SUM(bugs_found) AS bugsFound,
      SUM(bugs_fixed) AS bugsFixed,
      SUM(llm_cost_usd) AS llmCostUsd,
      SUM(execution_time_ms) AS executionTimeMs,
      MIN(created_at) AS createdAt
    FROM coverage_reports
    WHERE project_id = ? AND run_id = ?
    GROUP BY run_id
  `;

  const [runA, runB] = await Promise.all([
    c.env.DB.prepare(selectSql).bind(projectId, runIdA).first(),
    c.env.DB.prepare(selectSql).bind(projectId, runIdB).first()
  ]);

  if (!runA || !runB) {
    return c.json({ error: "One or both runs not found" }, 404);
  }

  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  return c.json({
    runA,
    runB,
    delta: {
      coverageDelta: num(runB.overallCoverage) - num(runA.overallCoverage),
      testsDelta: num(runB.testsGenerated) - num(runA.testsGenerated),
      bugsDelta: num(runB.bugsFound) - num(runA.bugsFound),
      costDelta: num(runB.llmCostUsd) - num(runA.llmCostUsd),
      timeDelta: num(runB.executionTimeMs) - num(runA.executionTimeMs)
    }
  });
});

/* ---- GET /pr/:prNumber — PR impact view ----------------------------------- */

reportRoutes.get("/pr/:prNumber", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const prNumber = parseInt(c.req.param("prNumber"), 10);

  if (!projectId || !Number.isFinite(prNumber)) {
    return c.json({ error: "projectId and valid prNumber are required" }, 400);
  }

  if (!(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const reports = await c.env.DB.prepare(
    `SELECT
       id, run_id AS runId, run_mode AS runMode, branch, commit_sha AS commitSha,
       overall_coverage AS overallCoverage, tests_generated AS testsGenerated,
       tests_passed AS testsPassed, tests_failed AS testsFailed,
       bugs_found AS bugsFound, bugs_fixed AS bugsFixed,
       llm_cost_usd AS llmCostUsd, execution_time_ms AS executionTimeMs,
       pr_number AS prNumber, pr_url AS prUrl, created_at AS createdAt
     FROM coverage_reports
     WHERE project_id = ? AND pr_number = ?
     ORDER BY created_at ASC`
  ).bind(projectId, prNumber).all();

  const bugs = await c.env.DB.prepare(
    `SELECT b.id, b.file_path AS filePath, b.description, b.severity, b.status, b.created_at AS createdAt
     FROM bugs b
     WHERE b.project_id = ? AND b.created_at >= (
       SELECT MIN(created_at) FROM coverage_reports WHERE project_id = ? AND pr_number = ?
     )
     ORDER BY b.created_at DESC LIMIT 50`
  ).bind(projectId, projectId, prNumber).all();

  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const reps = reports.results;
  const summary = {
    testsAdded: reps.reduce((s, r) => s + num(r.testsGenerated), 0),
    bugsFound: reps.reduce((s, r) => s + num(r.bugsFound), 0),
    totalCost: reps.reduce((s, r) => s + num(r.llmCostUsd), 0),
    runs: reps.length,
    coverageDelta: reps.length >= 2
      ? num(reps[reps.length - 1].overallCoverage) - num(reps[0].overallCoverage)
      : 0
  };

  return c.json({ reports: reps, bugs: bugs.results, summary });
});
