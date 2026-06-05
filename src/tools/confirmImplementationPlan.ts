/**
 * confirm_implementation_plan
 * ---------------------------
 * Records the developer-approved implementation plan for the current session so
 * the code-creating tools (PLAN_GATED_TOOLS) are unlocked. The agent must call
 * this AFTER presenting the complete plan in chat and receiving the developer's
 * approval. It writes nothing to disk — it only flips an in-memory session flag
 * (hence readOnlyHint:true, so VS Code does not prompt for it → zero extra clicks).
 *
 * The full plan is echoed back in the response so the approved plan is visible
 * and recorded in the chat transcript.
 */

import type { XppServerContext } from '../types/context.js';
import { setApprovedPlan, describePlan, type PlanStep } from '../utils/planApproval.js';
import { PLAN_GATED_TOOLS } from '../server/serverMode.js';

export async function handleConfirmImplementationPlan(
  request: any,
  _context: XppServerContext
) {
  const args = (request.params.arguments ?? {}) as {
    summary?: string;
    steps?: PlanStep[];
    rationale?: string;
  };

  const summary = (args.summary ?? '').trim();
  const steps = Array.isArray(args.steps) ? args.steps : [];

  if (!summary) {
    return {
      content: [{ type: 'text', text: '❌ confirm_implementation_plan requires a non-empty `summary` describing the change.' }],
      isError: true,
    };
  }
  if (steps.length === 0) {
    return {
      content: [{ type: 'text', text: '❌ confirm_implementation_plan requires at least one entry in `steps` (the ordered tool calls you will make).' }],
      isError: true,
    };
  }

  const badStep = steps.findIndex(
    s => !s || typeof s.tool !== 'string' || !s.tool.trim() || typeof s.description !== 'string' || !s.description.trim()
  );
  if (badStep !== -1) {
    return {
      content: [{ type: 'text', text: `❌ Step ${badStep + 1} is invalid — every step needs a non-empty \`tool\` and \`description\`.` }],
      isError: true,
    };
  }

  // The plan only matters if it gates at least one code-creating tool. If none
  // of the steps reference a mutating tool there is nothing to confirm.
  const planGated = Array.from(PLAN_GATED_TOOLS);
  const hasMutatingStep = steps.some(s => PLAN_GATED_TOOLS.has(s.tool));
  if (!hasMutatingStep) {
    return {
      content: [{
        type: 'text',
        text:
`⚠️ None of these steps use a code-creating tool (${planGated.join(', ')}).
If your change does not create or modify any D365FO object, you don't need to confirm a plan — just call the read tools directly.
If it does, list those write steps explicitly and confirm again.`,
      }],
      isError: true,
    };
  }

  const plan = setApprovedPlan({
    summary,
    steps,
    rationale: args.rationale?.trim() || undefined,
  });

  return {
    content: [{
      type: 'text',
      text:
`✅ Implementation plan approved and recorded for this session (id: ${plan.planId}).
The code-creating tools are now unlocked for these operations until the plan expires.

${describePlan(plan)}

Execute the steps in order. If you need to deviate, call confirm_implementation_plan again with the revised steps BEFORE making the change.`,
    }],
  };
}
