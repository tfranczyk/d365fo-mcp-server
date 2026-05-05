# ang-xpp-dev — Maintenance

This file is for humans who maintain `SKILL.md`. The agent does not load it.

## Purpose of the skill

A complete, repeatable workflow for implementing or reviewing Microsoft Dynamics 365 Finance and Operations customizations in X++ with production-grade quality and traceability.

Optimized for:
- New feature implementation from work item and design docs.
- Refactoring existing customizations to meet standards and coding principles.
- Stabilization work when quality or maintainability is low.

## What the skill produces

- A standards-compliant implementation plan before coding.
- Correct extension strategy (CoC-first, with events only when CoC is impossible).
- Naming and structure aligned with project prefix and model conventions.
- Traceable documentation blocks in class and method-level comments.
- Verified build / BP / test / review package.

## Example user prompts

- *Implement work item T06516 for a new table plus data entity using this skill, including changelog and proper business code logic.*
- *Review my X++ form extension for naming, mandatory field behavior, and action pane compliance using ANG standards.*
- *Decide the precise modification spot for this requirement when using CoC and produce a justified implementation plan.*

## How to add a new rule

1. **Pick the right home.**
   - Language fact (compiler / runtime behavior, MS-documented) → "X++ Language Essentials".
   - Anegis policy (naming, traceability, configuration choices) → "Implementation Standards by Artifact" or "Hard Rules".
   - Approach / mindset → "Meta-Principles".
   - Tool sequence (which MCP tool to call when) → does NOT belong here. Goes in `copilot-instructions.md` instead.
2. **Keep rules atomic.** One numbered list item = one rule. Easier to review, easier to delete or revise without disturbing surrounding rules.
3. **Code examples are encouraged.** Keep them short, self-contained, and BP-clean. Anegis-real names and work item IDs are fine — they make the example feel authoritative.
4. **Update the Fast Review Checklist** if the new rule is something a reviewer should explicitly check.
5. **Cite Microsoft Learn for language facts.** Add the URL to the References section if it's not already there.
6. **Mark Anegis-specific choices.** When a rule is Anegis policy rather than an MS standard, say so in the rule text ("Anegis convention:") so future readers can tell which is which.

## How to remove a rule

The bloat test: would the next generated file change if this rule were removed? If no, the rule is decorative — delete it. The skill costs context per invocation; every line should earn its place by changing agent output.

## Where the skill is loaded from

User-level: `~/.copilot/skills/ang-xpp-dev/SKILL.md`. Edit there directly. Reload VS Code to pick up changes.

## Companion files

- `copilot-instructions.md` (in `.github/` parent of all D365FO solutions) — tool routing, MCP rules, dry-run protocol, terminal prohibition. Do NOT duplicate X++ language or coding-standard content here.
- `SKILL.md` — what the agent writes. Language facts + Anegis standards + meta-principles. No tool routing.
