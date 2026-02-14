import { sql } from "drizzle-orm";
import { customType, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(datetime('now'))`;

const timestamp = customType<{ data: Date | string; driverData: string }>({
  dataType() {
    return "text";
  },
  fromDriver(value: string): Date {
    return new Date(value);
  },
  toDriver(value: Date | string): string {
    if (typeof value === "string") {
      return value;
    }
    return value.toISOString();
  }
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  githubUsername: text("github_username"),
  createdAt: timestamp("created_at").notNull().default(now),
  updatedAt: timestamp("updated_at").notNull().default(now)
}, (table) => ({
  usersEmailUnique: uniqueIndex("uq_users_email").on(table.email)
}));

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  scope: text("scope"),
  password: text("password"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  createdAt: timestamp("created_at").notNull().default(now),
  updatedAt: timestamp("updated_at").notNull().default(now)
}, (table) => ({
  accountsProviderAccountUnique: uniqueIndex("uq_accounts_provider_account").on(
    table.providerId,
    table.accountId
  ),
  accountsUserIndex: index("idx_accounts_user").on(table.userId)
}));

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  sessionToken: text("session_token"),
  tokenHash: text("token_hash"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(now),
  updatedAt: timestamp("updated_at").notNull().default(now)
}, (table) => ({
  sessionsTokenUnique: uniqueIndex("uq_sessions_token").on(table.token),
  sessionsSessionTokenUnique: uniqueIndex("uq_sessions_session_token").on(table.sessionToken),
  sessionsTokenHashUnique: uniqueIndex("uq_sessions_token_hash").on(table.tokenHash),
  sessionsUserIndex: index("idx_sessions_user").on(table.userId)
}));

export const verificationTokens = sqliteTable("verification_tokens", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(now)
}, (table) => ({
  verificationTokenUnique: uniqueIndex("uq_verification_tokens_token").on(table.token),
  verificationIdentifierTokenUnique: uniqueIndex("uq_verification_identifier_token").on(
    table.identifier,
    table.token
  )
}));

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  repoProvider: text("repo_provider").notNull().default("github"),
  defaultBranch: text("default_branch").notNull().default("main"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now)
}, (table) => ({
  projectsUserIndex: index("idx_projects_user").on(table.userId)
}));

export const packages = sqliteTable("packages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  language: text("language"),
  testFramework: text("test_framework"),
  docFramework: text("doc_framework"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  packagesProjectPathUnique: uniqueIndex("uq_packages_project_path").on(table.projectId, table.path)
}));

export const coverageReports = sqliteTable("coverage_reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  packageId: text("package_id").references(() => packages.id, { onDelete: "set null" }),
  runId: text("run_id").notNull(),
  runMode: text("run_mode").notNull(),
  branch: text("branch"),
  commitSha: text("commit_sha"),
  unitCoverage: real("unit_coverage"),
  integrationCoverage: real("integration_coverage"),
  e2eCoverage: real("e2e_coverage"),
  overallCoverage: real("overall_coverage"),
  testsGenerated: integer("tests_generated").notNull().default(0),
  testsPassed: integer("tests_passed").notNull().default(0),
  testsFailed: integer("tests_failed").notNull().default(0),
  bugsFound: integer("bugs_found").notNull().default(0),
  bugsFixed: integer("bugs_fixed").notNull().default(0),
  reportR2Key: text("report_r2_key"),
  llmProvider: text("llm_provider"),
  llmModel: text("llm_model"),
  llmPromptTokens: integer("llm_prompt_tokens").default(0),
  llmCompletionTokens: integer("llm_completion_tokens").default(0),
  llmTotalTokens: integer("llm_total_tokens").default(0),
  llmCostUsd: real("llm_cost_usd").default(0),
  executionTimeMs: integer("execution_time_ms"),
  executionEnvironment: text("execution_environment"),
  runMetadata: text("run_metadata"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  coverageProjectIndex: index("idx_coverage_project").on(table.projectId, table.createdAt),
  coveragePackageIndex: index("idx_coverage_package").on(table.packageId, table.createdAt),
  coverageProjectCommitIndex: index("idx_coverage_reports_project_commit").on(table.projectId, table.commitSha)
}));

export const driftResults = sqliteTable("drift_results", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  testName: text("test_name").notNull(),
  status: text("status").notNull(),
  similarityScore: real("similarity_score"),
  baselineOutput: text("baseline_output"),
  currentOutput: text("current_output"),
  details: text("details"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  driftProjectIndex: index("idx_drift_project").on(table.projectId, table.createdAt),
  driftCreatedIndex: index("idx_drift_results_created").on(table.createdAt)
}));

export const bugs = sqliteTable("bugs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  packageId: text("package_id").references(() => packages.id, { onDelete: "set null" }),
  filePath: text("file_path").notNull(),
  functionName: text("function_name"),
  description: text("description").notNull(),
  rootCause: text("root_cause"),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  githubIssueUrl: text("github_issue_url"),
  githubPrUrl: text("github_pr_url"),
  bugType: text("bug_type"),
  confidence: real("confidence"),
  stackTrace: text("stack_trace"),
  createdAt: text("created_at").notNull().default(now),
  resolvedAt: text("resolved_at")
}, (table) => ({
  bugsProjectStatusIndex: index("idx_bugs_project").on(table.projectId, table.status)
}));

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  keyHash: text("key_hash"),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  cacheHit: integer("cache_hit", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(),
  timestamp: text("timestamp").notNull(),
  sessionId: text("session_id"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  usageEventsUserTimestampIndex: index("idx_usage_events_user_ts").on(
    table.userId,
    table.timestamp
  ),
  usageEventsTimestampIndex: index("idx_usage_events_timestamp").on(table.timestamp),
  usageEventsProjectTimestampIndex: index("idx_usage_events_project_ts").on(table.projectId, table.timestamp),
  usageEventsSessionIndex: index("idx_usage_events_session").on(table.sessionId)
}));

export const usageDaily = sqliteTable("usage_daily", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  date: text("date").notNull(),
  totalRequests: integer("total_requests").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  totalCostUsd: real("total_cost_usd").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now)
}, (table) => ({
  usageDailyUserDateIndex: index("idx_usage_daily_user_date").on(table.userId, table.date),
  usageDailyRollupUnique: uniqueIndex("uq_usage_daily_rollup").on(
    table.userId,
    table.projectId,
    table.model,
    table.date
  )
}));


export const platformApiKeys = sqliteTable("platform_api_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name"),
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  platformApiKeysHashIndex: index("idx_platform_api_keys_hash").on(table.keyHash),
  platformApiKeysHashUnique: uniqueIndex("uq_platform_api_keys_hash").on(table.keyHash),
  platformApiKeysUserIndex: index("idx_platform_api_keys_user").on(table.userId),
  platformApiKeysUserProjectIndex: index("idx_platform_api_keys_user_project").on(table.userId, table.projectId)
}));

export const projectMemory = sqliteTable("project_memory", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  conventions: text("conventions"),
  knownPatterns: text("known_patterns"),
  failedPatterns: text("failed_patterns"),
  generationStats: text("generation_stats"),
  source: text("source"),
  updatedAt: text("updated_at").notNull().default(now),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  projectMemoryProjectUnique: uniqueIndex("uq_project_memory_project").on(table.projectId)
}));

export const packageMemoryTable = sqliteTable("package_memory", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  packageName: text("package_name").notNull(),
  version: integer("version").notNull().default(1),
  testPatterns: text("test_patterns"),
  knownIssues: text("known_issues"),
  coverageHistory: text("coverage_history"),
  llmFeedback: text("llm_feedback"),
  updatedAt: text("updated_at").notNull().default(now),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  packageMemoryProjectPkgUnique: uniqueIndex("uq_package_memory_project_pkg").on(table.projectId, table.packageName)
}));

export const securityFindings = sqliteTable("security_findings", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  vulnerabilityType: text("vulnerability_type").notNull(),
  severity: text("severity").notNull(),
  filePath: text("file_path").notNull(),
  lineNumber: integer("line_number"),
  functionName: text("function_name"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  remediation: text("remediation"),
  confidence: real("confidence"),
  cweId: text("cwe_id"),
  evidence: text("evidence"),
  detectionMethod: text("detection_method"),
  status: text("status").notNull().default("open"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  securityProjectIndex: index("idx_security_project").on(table.projectId, table.createdAt)
}));

export const riskScores = sqliteTable("risk_scores", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  filePath: text("file_path").notNull(),
  overallScore: real("overall_score"),
  complexityScore: real("complexity_score"),
  coverageScore: real("coverage_score"),
  recencyScore: real("recency_score"),
  criticalityScore: real("criticality_score"),
  level: text("level"),
  criticalityDomains: text("criticality_domains"),
  avgComplexity: real("avg_complexity"),
  coveragePercentage: real("coverage_percentage"),
  functionCount: integer("function_count"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  riskProjectIndex: index("idx_risk_project").on(table.projectId, table.createdAt)
}));

export const coverageGaps = sqliteTable("coverage_gaps", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  filePath: text("file_path").notNull(),
  functionName: text("function_name").notNull(),
  lineNumber: integer("line_number"),
  endLine: integer("end_line"),
  coveragePercentage: real("coverage_percentage"),
  complexity: integer("complexity"),
  isPublic: integer("is_public", { mode: "boolean" }),
  priority: text("priority"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  gapsProjectIndex: index("idx_gaps_project").on(table.projectId, table.createdAt),
  gapsProjectRunIndex: index("idx_gaps_project_run").on(table.projectId, table.runId)
}));

export const bugFixes = sqliteTable("bug_fixes", {
  id: text("id").primaryKey(),
  bugId: text("bug_id")
    .notNull()
    .references(() => bugs.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  patch: text("patch"),
  explanation: text("explanation"),
  confidence: real("confidence"),
  safetyNotes: text("safety_notes"),
  verificationStatus: text("verification_status"),
  r2Key: text("r2_key"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  fixesBugIndex: index("idx_fixes_bug").on(table.bugId),
  fixesProjectIndex: index("idx_fixes_project").on(table.projectId, table.createdAt)
}));

export const routes = sqliteTable("routes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  path: text("path").notNull(),
  routeType: text("route_type"),
  methods: text("methods"),
  handlerFile: text("handler_file"),
  handlerName: text("handler_name"),
  handlerStartLine: integer("handler_start_line"),
  handlerEndLine: integer("handler_end_line"),
  params: text("params"),
  framework: text("framework"),
  middleware: text("middleware"),
  authRequired: integer("auth_required", { mode: "boolean" }),
  coveragePercentage: real("coverage_percentage"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  routesProjectIndex: index("idx_routes_project").on(table.projectId, table.createdAt)
}));

export const activityLog = sqliteTable("activity_log", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  source: text("source"),
  summary: text("summary"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  activityProjectIndex: index("idx_activity_project").on(table.projectId, table.createdAt)
}));

export const docCoverage = sqliteTable("doc_coverage", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  filePath: text("file_path").notNull(),
  functionName: text("function_name"),
  hasDocstring: integer("has_docstring", { mode: "boolean" }),
  isStale: integer("is_stale", { mode: "boolean" }),
  docFramework: text("doc_framework"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  docProjectIndex: index("idx_doc_project").on(table.projectId, table.createdAt)
}));

export const promptRecords = sqliteTable("prompt_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  model: text("model").notNull(),
  messages: text("messages").notNull(), // JSON array
  temperature: real("temperature"),
  maxTokens: integer("max_tokens"),
  metadata: text("metadata"), // JSON object
  responseText: text("response_text"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  durationMs: integer("duration_ms"),
  // Lineage
  sourceFile: text("source_file"),
  templateName: text("template_name"),
  builderName: text("builder_name"),
  framework: text("framework"),
  contextTokens: integer("context_tokens"),
  // Outcome
  outcome: text("outcome").default("pending"),
  validationAttempts: integer("validation_attempts").default(0),
  errorMessage: text("error_message"),
  comparisonGroupId: text("comparison_group_id"),
  createdAt: text("created_at").notNull().default(now)
}, (table) => ({
  promptProjectIndex: index("idx_prompt_project").on(table.projectId, table.createdAt),
  promptModelIndex: index("idx_prompt_model").on(table.model),
  promptTemplateIndex: index("idx_prompt_template").on(table.templateName),
  promptComparisonIndex: index("idx_prompt_comparison").on(table.comparisonGroupId)
}));

export const schema = {
  users,
  accounts,
  sessions,
  verificationTokens,
  projects,
  packages,
  coverageReports,
  driftResults,
  bugs,
  usageEvents,
  usageDaily,
  platformApiKeys,
  projectMemory,
  packageMemoryTable,
  securityFindings,
  riskScores,
  coverageGaps,
  bugFixes,
  routes,
  activityLog,
  docCoverage,
  promptRecords
};
