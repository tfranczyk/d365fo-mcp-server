/**
 * Server mode configuration.
 *
 * Controls which tools are exposed by this MCP server instance,
 * enabling a hybrid deployment where:
 *  - An Azure-hosted instance runs in 'read-only' mode (search / analysis)
 *  - A local Windows VM instance runs in 'write-only' mode (file operations)
 *
 * Set via environment variable:  MCP_SERVER_MODE=full|read-only|write-only
 */

/**
 * Tools that require local Windows VM filesystem access (K:\ drive) or read
 * local server state not available from Azure (e.g. in-memory config, .mcp.json).
 *
 * These tools have three properties in common:
 *  1. They access local paths (K:\PackagesLocalDirectory, K:\VSProjects, .mcp.json)
 *     that are NOT reachable from an Azure-hosted instance.
 *  2. They do NOT need the symbol database — they skip the dbReady await.
 *  3. They are the tools available in 'write-only' (local companion) mode.
 *
 * The set also includes bridge-backed READ tools (get_class_info, get_table_info, …)
 * which work in write-only mode via IMetadataProvider — no SQLite needed.
 * This allows Copilot to verify objects it just created without an Azure re-deploy.
 *
 * - Excluded in 'read-only' mode (Azure deployment can't access local K:\ paths)
 * - The only tools exposed in 'write-only' mode (lightweight local companion)
 *
 * Members:
 *  create_d365fo_file   — writes XML to K:\PackagesLocalDirectory
 *  modify_d365fo_file   — edits XML on K:\PackagesLocalDirectory
 *  create_label         — writes to K:\PackagesLocalDirectory label files
 *  rename_label         — rewrites label files + all source references on K:\
 *  verify_d365fo_project — reads .rnrproj from K:\VSProjects
 *  get_workspace_info   — scans .rnrproj via D365FO_SOLUTIONS_PATH (K:\); reads
 *                         .mcp.json + in-memory config/stdio session state;
 *                         on Azure would return irrelevant server info, not dev
 *                         workspace info — so it's excluded from read-only mode
 */
export const LOCAL_TOOLS = new Set([
  'create_d365fo_file',
  'modify_d365fo_file',
  'create_label',
  'rename_label',
  // Plan gate — must be reachable wherever writes happen (full + write-only),
  // and needs no symbol DB, so it lives with the local tools.
  'confirm_implementation_plan',
  'verify_d365fo_project',
  'update_symbol_index',
  'build_d365fo_project',
  'trigger_db_sync',
  'run_bp_check',
  'run_systest_class',
  'review_workspace_changes',
  'undo_last_modification',
  'get_workspace_info',
  // Bridge-backed read tools: work in write-only mode via IMetadataProvider
  // (no SQLite needed — bridge reads directly from disk).
  // Allows Copilot to verify objects it just created/modified without waiting
  // for an Azure DB re-deploy or an explicit update_symbol_index call.
  'get_class_info',
  'get_table_info',
  'get_form_info',
  'get_enum_info',
  'get_edt_info',
  'get_query_info',
  'get_view_info',
  'get_report_info',
  'get_data_entity_info',
  'get_method_source',
  'get_method_signature',
  'get_menu_item_info',
]);

/**
 * @deprecated Use LOCAL_TOOLS — kept temporarily so any external import doesn't break.
 * Will be removed in the next major release.
 */
export const WRITE_TOOLS = LOCAL_TOOLS;

/**
 * Server mode, resolved once at startup from MCP_SERVER_MODE env var.
 * - 'full'       (default) – all tools registered (local development)
 * - 'read-only'  – LOCAL_TOOLS excluded   (Azure App Service deployment)
 * - 'write-only' – only LOCAL_TOOLS exposed (lightweight local companion)
 */
export type ServerMode = 'full' | 'read-only' | 'write-only';

export const SERVER_MODE: ServerMode = (() => {
  const raw = (process.env.MCP_SERVER_MODE ?? 'full').toLowerCase().trim();
  if (raw === 'read-only' || raw === 'readonly') return 'read-only';
  if (raw === 'write-only' || raw === 'writeonly') return 'write-only';
  return 'full';
})();

/**
 * Code-creating tools that mutate the D365FO model on disk.
 *
 * These are gated behind a developer-approved implementation plan: on a writing
 * instance (full / write-only mode) they refuse to run until the agent has
 * recorded an approval via `confirm_implementation_plan`. See
 * src/utils/planApproval.ts and the gate in src/tools/toolHandler.ts.
 *
 * NOTE: this is intentionally NOT LOCAL_TOOLS — LOCAL_TOOLS is the broad
 * "available on the local companion" set (it also contains read, build, and
 * sync tools, and it does NOT contain the smart generators, which are dual-mode:
 * they execute locally but only return a plan on Azure/read-only).
 */
export const PLAN_GATED_TOOLS = new Set<string>([
  'create_d365fo_file',
  'modify_d365fo_file',
  'create_label',
  'rename_label',
  'generate_smart_table',
  'generate_smart_form',
  'generate_smart_report',
]);

/**
 * Tools that have side effects (run a process, mutate the DB or symbol index,
 * or revert files) but are not "code creation" and so are not plan-gated.
 * They are still surfaced to the client as non-read-only so VS Code keeps
 * prompting for confirmation before running them.
 */
export const EXECUTING_TOOLS = new Set<string>([
  'build_d365fo_project',
  'trigger_db_sync',
  'run_systest_class',
  'update_symbol_index',
  'undo_last_modification',
]);

/**
 * MCP tool annotations (https://modelcontextprotocol.io — ToolAnnotations).
 * VS Code only shows its confirmation dialog for tools NOT marked readOnlyHint,
 * so marking the read/search/analysis tools read-only keeps the investigation
 * phase friction-free, while code-creating tools stay prompt-worthy.
 */
export function getToolAnnotations(name: string): {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
} {
  if (PLAN_GATED_TOOLS.has(name)) {
    return { title: name, readOnlyHint: false, destructiveHint: true, openWorldHint: false };
  }
  if (EXECUTING_TOOLS.has(name)) {
    return { title: name, readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  }
  // Everything else (search, get_*, analysis, suggest_*, confirm_implementation_plan)
  // is read-only with respect to the D365FO model and the developer's files.
  return { title: name, readOnlyHint: true, openWorldHint: false };
}
