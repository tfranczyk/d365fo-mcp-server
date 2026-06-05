/**
 * Session-scoped store for the developer-approved implementation plan.
 *
 * WHY THIS EXISTS
 * ---------------
 * The MCP server can only ever observe tool calls — it cannot see the chat or
 * the developer's "approved" message. So "present a plan and get the developer's
 * approval before writing" can only be made *reliable* (rather than purely an
 * instruction the model may skip) by routing the approval through a tool call.
 *
 * Flow:
 *   1. Agent investigates with read tools (unrestricted).
 *   2. Agent presents the COMPLETE plan to the developer in chat.
 *   3. Developer approves (or asks for changes) in chat.
 *   4. Agent calls `confirm_implementation_plan` with the full step list →
 *      the plan is recorded here.
 *   5. The code-creating tools (PLAN_GATED_TOOLS) refuse to run unless a
 *      matching, non-expired approval exists in this store.
 *
 * SCOPE
 * -----
 * The local writing instance runs over stdio (one process == one VS Code window
 * == one MCP session for the whole task), so a module-level singleton is the
 * correct scope. The gate is skipped entirely in read-only (Azure) mode, which
 * never mutates and is HTTP/multi-session — there the smart tools simply return
 * a plan for a local companion to execute.
 *
 * Approval TTL is configurable via PLAN_APPROVAL_TTL_MINUTES (default 30).
 */

export interface PlanStep {
  /** MCP tool that performs this step, e.g. 'generate_smart_table', 'create_label'. */
  tool: string;
  /** Primary object/label created or modified, e.g. 'AngTickets', '@Ang:TicketId'. */
  target?: string;
  /** Plain-language description of what this step does. */
  description: string;
}

export interface ApprovedPlan {
  planId: string;
  summary: string;
  steps: PlanStep[];
  rationale?: string;
  /** epoch ms */
  approvedAt: number;
}

let _approved: ApprovedPlan | null = null;

function ttlMs(): number {
  const raw = parseInt(process.env.PLAN_APPROVAL_TTL_MINUTES ?? '', 10);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return minutes * 60_000;
}

/** Record (or replace) the approved plan for the current session. */
export function setApprovedPlan(
  plan: Omit<ApprovedPlan, 'planId' | 'approvedAt'>
): ApprovedPlan {
  _approved = {
    ...plan,
    planId: `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    approvedAt: Date.now(),
  };
  return _approved;
}

/** Returns the live approval, or null if absent or expired. */
export function getApprovedPlan(): ApprovedPlan | null {
  if (!_approved) return null;
  if (Date.now() - _approved.approvedAt > ttlMs()) {
    _approved = null;
    return null;
  }
  return _approved;
}

export function clearApprovedPlan(): void {
  _approved = null;
}

/** Render a plan as a numbered, human-readable block (shown back to the dev). */
export function describePlan(plan: ApprovedPlan): string {
  const lines: string[] = [];
  lines.push(`PLAN: ${plan.summary}`);
  if (plan.rationale) lines.push(`Rationale: ${plan.rationale}`);
  lines.push('');
  lines.push('Steps:');
  plan.steps.forEach((s, i) => {
    const target = s.target ? ` → ${s.target}` : '';
    lines.push(`  ${i + 1}. [${s.tool}]${target}  ${s.description}`);
  });
  return lines.join('\n');
}
