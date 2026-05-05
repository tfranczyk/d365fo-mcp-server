---
name: ang-xpp-dev
description: 'Enterprise X++ engineering workflow for D365 Finance and Operations. Use for implementing or reviewing customizations with Anegis coding standards: extension-first design, naming conventions, changelog traceability, CoC/events/delegates decisions, table/form/entity/security rules, best-practice compliance, and DevOps check-in discipline.'
argument-hint: 'Provide work item ID, project/model, artifact type, and expected business behavior.'
user-invocable: true
---

# ANG X++ Development Excellence Workflow

## Purpose
This skill provides a complete, repeatable workflow for implementing or reviewing Microsoft Dynamics 365 Finance and Operations customizations in X++ with production-grade quality and traceability.

This skill is optimized for:
- New feature implementation from work item and design docs
- Refactoring existing customizations to meet standards
- Technical review before check-in or pull request
- Stabilization work when quality or maintainability is low

## What This Skill Produces
- A standards-compliant implementation plan before coding
- Correct extension strategy (CoC, delegates, events, or new artifacts)
- Naming and structure aligned with project prefix and model conventions
- Traceable documentation blocks in class and method-level comments
- Verified build/test/review package ready for check-in and UAT

## Required Inputs
Collect these before coding. If any input is missing, stop and request it.

1. Work item ID and short work item title
2. Project/model name and project prefix (3-character object prefix)
3. Target artifact types (class, table, form, data entity, security, labels)
4. Functional requirements and functional design references
5. Expected user behavior and non-functional constraints
6. Legal entity enable/disable expectations for the customization

## Hard Rules (Never Break)
1. No overlayering. Use extensions/customization patterns only.
2. One work item, one solution, one project, with aligned naming.
3. Solution name and project name are identical.
4. Do not ship code with unresolved quality issues.
5. Always preserve change traceability in comments and check-in metadata.

## Workflow

## 1) Design Readiness Gate
Do not start implementation until these are confirmed:

1. Requirements are clear enough to avoid coding assumptions.
2. Functional design is available and reviewed.
3. Technical design covers edge cases and integration impacts.
4. Design choices align with Microsoft best practices and extension model.
5. Prototype validation exists where risk is high.

Exit criteria:
- A concise technical implementation note exists for the work item.
- Open questions are resolved or explicitly accepted as assumptions.

## 2) Work Item Bootstrap

1. Create a dedicated solution/project per task.
2. Use naming pattern: [WorkItemID]_[WorkItemName]
3. Keep solution and project names identical.
4. Confirm source control mappings and expected workspace folders.
5. Ensure best-practice checks are enabled in build options.

Exit criteria:
- Clean workspace state
- Correct project location and source control bindings
- Build options configured for quality checks

## 3) Customization Strategy Decision
Choose the least intrusive extension path that preserves upgradeability.

Decision order:
1. Can requirement be met by metadata/configuration only?
2. If code is required, can existing behavior be wrapped with CoC?
3. If extension points exist, should delegate subscription be used?
4. If event model is preferable, use event handlers with correct event args handling.
5. Create new artifact only when extension of existing artifact is insufficient.

Prefer CoC when all are true:
- Wrapper signature can match base method exactly
- `next` semantics can be honored
- No hookability/final restrictions block wrapping

Prefer delegate/event handlers when:
- Existing delegate/event already models the intervention point
- Broadcast behavior is acceptable
- Explicit access to protected members is not required

## 4) Implementation Standards By Artifact

## 4.1 Global X++ Principles
1. Declare variables as locally as possible.
2. Keep methods small, single-purpose, and clearly named.
3. Use braces for every block.
4. Validate early and fail fast with informative messages.
5. Avoid dead code and duplicated logic.
6. Do not mutate by-value parameters.
7. Never use infolog.add directly; use framework indirection methods.
8. Avoid runtime errors for end users; prefer controlled error paths.
9. Never assign to `this`.

## 4.2 Naming and Conventions
1. All variable names are meaningful and camelCase.
2. Static variables/constants use PascalCase.
3. Method parameters start with underscore (example: _custAccount).
4. Methods are meaningful and camelCase, except approved static/delegate patterns.
5. New artifacts use project prefix.
6. Extensions use expected suffixing conventions:
   - Class augmentation: _Extension
   - Table/Form/Entity/EDT/Enum extensions: .Extension + project suffix where applicable

## 4.3 Classes, CoC, Events, Delegates

Class guidance:
1. Prefer augmentation or inheritance patterns that keep intent explicit.
2. Keep side effects visible in method naming (set/create/update patterns).
3. Use preferred method naming idioms (check, exist, find, validate, parm, initParm).

CoC guidance:
1. Wrapper signature must match base method.
2. Call `next` in supported positions only.
3. Do not conditionally bypass `next` unless method is replaceable and design explicitly requires it.
4. Respect hookable/final/root-level restrictions.

Event handler guidance:
1. Treat events as broadcast with no call order guarantees.
2. Cast event args to specific types before consuming event data.
3. Keep handlers isolated, deterministic, and testable.

Delegate guidance:
1. Delegate return type is void.
2. Subscriber signature matches delegate signature exactly.
3. Subscriber naming uses class_delegate convention.
4. Attribute decoration is mandatory for subscriptions.

## 4.4 Tables
1. New table names use project prefix.
2. Extended table added elements (fields/indexes/relations) use project prefix.
3. Define proper primary and clustered indexes.
4. Use EDTs/enums instead of primitive field types whenever practical.
5. Define relation names that clearly include related table intent.
6. Implement standard static methods for lookup patterns where applicable:
   - checkExist
   - exist
   - find
7. For non-temporary tables, ensure data movement strategy via data entity.

## 4.5 Forms
1. New forms use project prefix.
2. Form extensions follow expected extension naming.
3. Confirm correct View/Edit default state.
4. Keep mandatory indication consistent at metadata and behavior levels.
5. Maintain usable FastTabs/grids/action pane organization.
6. Keep UI actions semantically scoped (entity-wide vs local).
7. Use modern recommended form patterns for scenario type.

## 4.6 Data Entities
1. New entities use project prefix and generally include Entity suffix.
2. Preserve encapsulation across related tables when representing domain objects.
3. Keep public contract consistent across OData/import-export use.
4. Keep entity interaction simple and natural-key friendly.
5. Avoid project prefixes in data entity field names.
6. Use consistent relation naming without redundant suffixes.

## 4.7 Configuration and Legal Entity Control
1. Each project/go-live scope uses dedicated configuration key strategy.
2. Define legal-entity-level enable/disable parameter for each customization.
3. Apply stable naming for toggle parameters and related field groups.
4. Ensure enablement logic is explicit and testable.

## 4.8 Labels and Security
Labels:
1. Keep labels in label files.
2. Label file ID aligns with model name.
3. Label IDs are English-friendly and traceable.

Security:
1. New security objects use project prefix.
2. Access to new menu items/entities is controlled via privileges.
3. Create both privilege types:
   - Maintain (delete-level management)
   - View (read-level access)

## 5) Documentation and Traceability Templates

## 5.1 Class Change Log Block
Use this after class declaration.

```xpp
//-- CHANGE LOG --
//
//++Start: Work item: <WorkItemID> Project: <ProjectName> (<Layer>) [<ModelName>]
//Developer: <FirstName LastName> Date: <YYYY-MM-DD or local standard>
//<Short summary of change>
//--End: Work item: <WorkItemID>
```

## 5.2 Method XML Comment Template
Use for public/protected methods.

```xpp
/// <summary>
/// <Business purpose and behavior>. Work item: <WorkItemID>.
/// </summary>
/// <param name="_paramName">Meaning of parameter.</param>
/// <returns>Meaning of returned value.</returns>
```

## 5.3 Legacy Code Modification Block
When modifying older logic, preserve intent history.

```xpp
//Work item: <WorkItemID> Project: <ProjectName> (<Layer>) [<ModelName>]
//Developer: <FirstName LastName> Date: <YYYY-MM-DD>
//<Added or modified code note>
//--End: Work item: <WorkItemID>
```

## 6) Verification Pipeline
Run this sequence before check-in.

1. Compile with best-practice checks enabled.
2. Resolve warnings/errors (allow only explicitly approved exceptions).
3. Perform database synchronization when required by metadata changes.
4. Run developer tests for modified behavior and edge cases.
5. Run code review against this skill checklist.
6. Confirm automation readiness (scheduled build and automated tests).
7. Validate tester/consultant testability and UAT acceptance criteria.

## 7) Check-in and Work Management Rules
1. Link check-in to related work item.
2. Use association type according to state (Associate vs Resolve only when final).
3. Do not leave check-in comment empty.
4. Use comment pattern:
   - T##### <Project> (Start)
   - T##### <Project> (Part)
   - T##### <Project> (Done)
5. Optionally append concise change note after status.

## 8) Completion Criteria (Definition of Done)
All items must be true.

1. Functional behavior matches requirement and design.
2. Extension approach is upgrade-safe and justified.
3. Naming and structure follow project standards.
4. Traceability comments are present and correct.
5. Best-practice/build pipeline passes with no unapproved issues.
6. Security and configuration toggles are implemented where required.
7. Data movement implications are covered for new persistent tables.
8. Check-in metadata and work item communication are complete.

## 9) Fast Review Checklist
Use this for rapid technical review.

1. Any overlayering detected?
2. Any missing work item traceability in changed classes?
3. Any method signatures/style violating CoC/delegate/event requirements?
4. Any primitive type misuse where EDT/enum is expected?
5. Any table/form/entity naming or extension suffix violations?
6. Any security privilege gap for new entry points?
7. Any legal-entity enable/disable control missing for scoped customization?
8. Any BP warnings ignored without explicit approval?

## 10) Example Prompts
- Implement work item T06516 for a new table plus data entity using this skill, including changelog and check-in comment draft.
- Review my X++ form extension for naming, mandatory field behavior, and action pane compliance using ANG standards.
- Decide whether this requirement should use CoC, delegate, or event handler and produce a justified implementation plan.
- Generate a pre-check-in quality report for my changes against ANG X++ completion criteria.

## Notes
This skill is derived from the Anegis coding standard document (v1.0, 2019) and organized into an actionable engineering workflow. If your project has newer architecture decisions, keep this workflow and update the specific policy points that changed.
