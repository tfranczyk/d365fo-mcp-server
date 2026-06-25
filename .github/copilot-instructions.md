# D365 Finance & Operations — MCP Tool & Environment Rules

This workspace contains D365FO code. **Always use the specialized MCP tools** — backed by a pre-indexed symbol database with hundreds of thousands of D365FO objects. Built-in file/search tools do not understand X++ syntax or AOT structure.

This file does **NOT** contain X++ coding standards, naming conventions — those live in the `ang-xpp-dev` skill (`SKILL.md`). Read both.

> **Tool surface note:** the per-object tools were consolidated into a few
> action-multiplexed tools. Use `d365fo_file` (action=create|modify|generate),
> `labels` (action=search|info|create|rename|update), `get_object_info`
> (objectType=class|table|form|…), `get_method` (include=signature|source|both),
> `generate_object` (mode=pattern|scaffold), `extension_info` (mode=coc|events|
> table-merge|points|strategy), `analyze_code` (mode=patterns|implementations|
> completeness|api-usage), `get_knowledge` (kind=knowledge|error), `security_info`
> (mode=artifact|coverage), `object_patterns` (domain=table|form).

## Before any action:

1. Call `get_workspace_info()` once. Note the model name. If the call errors or shows ⛔ CONFIGURATION PROBLEM, STOP and report.
2. Use MCP tools (NEVER built-in file/edit tools) for any `.xml`, `.xpp`, `.label.txt`, or `.rnrproj` file.
3. Run `d365fo_file(action="modify", ...)` with `dryRun=true` first → show diff → wait for explicit confirmation → re-run with `dryRun=false`.
4. NEVER run terminal commands or PowerShell — they hang in this workspace.
5. NEVER run `build_d365fo_project` autonomously — builds block the user. Wait for "build" / "compile" / "check errors".
6. Before creating or modifying ANY D365FO object, present the COMPLETE plan in chat and get the developer's approval, then record it with `confirm_implementation_plan`. The code-creating tools are gated and refuse to run until you do (see Implementation-Plan Gate below).

Everything below is reference material that supports these rules.

## 📋 Implementation-Plan Gate — present the whole plan, then confirm

Before creating or modifying ANY D365FO object you MUST get the developer's
approval on a COMPLETE plan. The code-creating tool actions are gated and will
refuse to run until you do.

Protocol (in order):
1. Investigate freely. Read/search tools (`search`, `get_object_info`,
   `get_method`, `find_references`, `extension_info`, `analyze_code`,
   `suggest_edt`, …) are never gated — use them to learn exactly what you will
   extend before you plan.
2. Present the COMPLETE plan to the developer in chat as ONE consolidated
   message: every object you will create or modify, the exact tools in execution
   order, the `Ang` prefix, the EDT choices, and every label (`@Ang:…`).
   Do NOT start executing.
3. Wait for approval. The developer may ask you to change it — revise and
   re-present; never proceed on a stale plan.
4. Call `confirm_implementation_plan` with `summary` + the full ordered `steps[]`
   (each step: `tool`, `target`, `description`). This unlocks the gated tools for
   this session.
5. Execute the steps in order. If you must deviate, call
   `confirm_implementation_plan` again with the revised steps BEFORE the change.

Gated actions (blocked until a matching plan is approved): `d365fo_file`
(action="create" / "modify") and `labels` (action="create" / "rename" /
"update"). The read actions of those same tools (`d365fo_file(action="generate")`,
`labels(action="search" | "info")`) and all other read/search tools are never
gated.

Never call `confirm_implementation_plan` before the developer has actually seen
and approved the plan — the gate is for informed sign-off, not a rubber stamp.
This is the TASK-level gate; the per-call `d365fo_file(action="modify")` dry-run
cycle still applies on top of it.

## 🚨 Terminal Prohibition

PowerShell or any terminal command WILL HANG in this workspace. This applies in VS Code, VS 2022, and VS 2026.

- NEVER call `run_in_terminal` or any shell tool.
- NEVER fall back to terminal when an MCP tool fails — STOP and report the error.
- If a tool parameter "seems missing" — re-read the schema; it IS present.

## 🔓 When MCP Is Optional

MCP rules apply **only to D365FO objects** (`.xml`/`.xpp`, AOT objects, labels, `.rnrproj`).

Use built-in tools freely for: `*.cs`, `*.json`, `*.yml`, `*.md`, `*.config`, `*.csproj`, `*.sln`, plain text, or when the user says "skip MCP" / "manual mode".

- `.rnrproj` = D365FO project → managed by MCP (`addToProject=true`). NEVER edit directly.
- `.csproj` = C# project → use built-in tools.

## 🔌 Mandatory First Check

Call `get_workspace_info()` before doing anything.

| Response | Action |
|---|---|
| Call fails | STOP. Tell user the MCP server is not connected. Offer: start server (A) or continue with built-in tools (B). |
| "not available in read-only mode" | Azure mode. Ask user for model name explicitly. Do NOT infer from search results. |
| ⛔ CONFIGURATION PROBLEM | STOP. Relay message. Wait for user. |
| ✅ Configuration looks valid | Note the model name. Use it for create/modify calls. Proceed. |

If a `MyModel` / `MyPackage` placeholder appears mid-task — STOP and notify the user.

## How Reads Are Resolved

Info tools (`get_object_info`, `get_method`, `extension_info`) resolve in this order:

1. **C# bridge** — live `IMetadataProvider` from the running D365FO instance. Authoritative when available.
2. **SQLite symbol index** — pre-built mirror. Used when bridge is offline (Azure, write-only mode, build agents).
3. **Filesystem parse** — last resort for objects created in the current session and not yet indexed. 3 s budget, 30 s cache. Disable in production with `D365FO_DISABLE_FS_FALLBACK=true`.

Never pick the source manually. If you see ⚠️ "Served from symbol index" or "Not yet in bridge metadata", the tool already fell back.

## 🛡️ Write-Path Safety

All write operations (`d365fo_file` action="create" / "modify") only accept paths under a configured `PackagesLocalDirectory/<Package>/<Model>/Ax<Type>/<Name>.xml`. Arbitrary paths are rejected.

---

## Dry-Run Protocol — `d365fo_file(action="modify")`

VS 2022 has no Keep/Undo for MCP edits. The diff must be reviewed in chat before disk is touched.

Required sequence for **every** modify call:

1. `d365fo_file(action="modify", ..., dryRun=true)` → present diff to user.
2. Wait for explicit confirmation ("apply" / "ok" / "yes" / etc.).
3. `d365fo_file(action="modify", ..., dryRun=false)` with the SAME args.

Skip dry-run **only** when the user has explicitly said "skip dryRun" / "apply directly" for the current task. Each modify call in a chain still requires its own dry-run cycle — never apply a chain without per-step confirmation.

## VS 2022 Review Workflow (Git Checkpointing)

VS 2022 has no inline accept/reject for agent edits. Use Git as the review layer:

1. **Before** starting a task — ensure clean tree, then `git switch -c mcp/<short-task-name>` (or commit a checkpoint on the current branch).
2. **During** — dry-run every modify (above).
3. **After** — review via View → Git Changes (per-file/hunk Stage/Discard).
4. Accept = commit + merge. Reject = `git restore <file>` or delete the branch.

If the user is on `main` (or a protected branch) and asks for non-trivial changes, **suggest** creating a feature branch — do NOT create branches autonomously.

---

## ⛔ Escalating-Workarounds Anti-Pattern (STOP at step 0)

If `d365fo_file(action="modify")` is the correct tool but you feel tempted to try something else, you are wrong. STOP.

```
WRONG SPIRAL (each step is more wrong):
 Step 1: "I'll use replace_string_in_file to patch the XML"
 Step 2: "replace failed — I'll try a different approach"
 Step 3: "I'll read the file with PowerShell first, then overwrite"
 Step 4: "Terminal returns no output — I'll add Write-Output"
 Step 5: "I'll use d365fo_file(action=\"create\") with overwrite=true"

CORRECT (always, immediately):
 d365fo_file(action="modify", operation="add-field-group" | "add-field" | "add-method" | …)
```

If `d365fo_file(action="modify")` itself errors → STOP and report. Do NOT try PowerShell.

## ⛔ Tables and Forms — Smart Tools Only

NEVER call `d365fo_file(action="create", objectType="table" | "form", properties={...})`.
Tables and forms have structural requirements (standard methods, PrimaryIndex,
ClusteredIndex, CacheLookup, TitleFields, system field groups) that ONLY
`generate_object(mode="scaffold", objectType="table" | "form")` produces. A bare
`d365fo_file(action="create")` emits a structurally incomplete file that LOOKS
like it succeeded.

✅ generate_object(mode="scaffold", objectType="table", name="Tickets", fieldsHint="TicketId, Description, Price")
❌ d365fo_file(action="create", objectType="table", properties={ fields: [...] })

`d365fo_file(action="create")` is allowed for tables/forms ONLY when forwarding XML that
`generate_object(mode="scaffold")` already returned (Azure/Linux path).

---

`⛔ DO NOT edit the XML before passing it to d365fo_file(action="create").`,
`   If the name/prefix or an EDT looks wrong, call generate_object(mode="scaffold") AGAIN with a corrected modelName or fieldsHint.`,
`   Hand-editing silently strips indexes, field groups, and methods.`

---

## Tool Routing — Request → Tool

| Request | Tool(s) |
|---|---|
| Plan a create/modify change (REQUIRED first) | present plan in chat → `confirm_implementation_plan(summary, steps[])` |
| Edit existing object | `d365fo_file(action="modify", operation=...)` |
| Create new object | `d365fo_file(action="create")` |
| Create new TABLE | `generate_object(mode="scaffold", objectType="table")` (NEVER `d365fo_file(action="create")` for tables) |
| Create new FORM  | `generate_object(mode="scaffold", objectType="form")` (NEVER `d365fo_file(action="create")` for forms) |
| Search | `search` (single, `queries[]` batch, or `scope="extensions"`) |
| Read several objects at once | `batch_get_info` |
| Read class/table/form/report | `get_object_info(objectType="class" \| "table" \| "form" \| "report", name=...)` |
| Where is X used? | `find_references(targetName)` |
| What can I extend? | `extension_info(mode="points", target=objectName)` |
| Which extension mechanism? | `extension_info(mode="strategy", goal=...)` |
| CoC extensions of X? | `extension_info(mode="coc", target=className)` |
| Event handlers for X? | `extension_info(mode="events", target=targetName)` |
| Security coverage | `security_info(mode="coverage", ...)` |
| Create SSRS report | `generate_object(mode="scaffold", objectType="report", fieldsHint=...)` |
| Diagnose X++ error | `get_knowledge(kind="error", ...)` — never guess |
| X++ knowledge / patterns | `get_knowledge(kind="knowledge", topic=...)` → `analyze_code(mode="patterns")` |
| Best practices / BP check | `run_bp_check` (NEVER manually iterate `get_method(include="source")`) |
| Build | `build_d365fo_project` (only on explicit user request) |
| Sync DB | `trigger_db_sync` |
| Run tests | `run_systest_class` |
| Verify project | `verify_d365fo_project` |
| Search labels | `labels(action="search", query=...)` |
| Create label | `labels(action="create", ..., createLabelFileIfMissing: true)` |
| Rename label | `labels(action="rename", ...)` |
| Which EDT should this field use? | `suggest_edt(fieldName)` — prefers `Ang*` customs over standard EDTs |
| Read data entity | `get_object_info(objectType="data-entity", name=...)` |
| Read menu item | `get_object_info(objectType="menu-item", name=...)` |
| Read a label's definition | `labels(action="info", ...)` |
| Check object/extension naming | `validate_object_naming` — enforces the `Ang` prefix conventions |
| Refresh index after create/modify | `update_symbol_index` — so subsequent reads see new objects |
| Roll back the last MCP edit | `undo_last_modification` — MCP-native; preferred over `git restore` |

 The "create"/"edit"/"generate"/label-write rows above require an approved plan first (see Implementation-Plan Gate).
---

## `d365fo_file(action="modify")` — Operation Inventory

| Category | Operations |
|---|---|
| Methods | `add-method`, `remove-method`, `replace-code` |
| Fields | `add-field`, `modify-field`, `rename-field`, `replace-all-fields`, `remove-field` |
| Indexes | `add-index`, `remove-index` |
| Relations | `add-relation`, `remove-relation` |
| Field groups | `add-field-group`, `remove-field-group`, `add-field-to-field-group` |
| Table-ext | `add-field-modification` (override base-table label/mandatory) |
| Form-ext | `add-control`, `add-data-source` |
| Any object | `modify-property` |

`modify-property` works for tables, table-extensions, EDTs, classes, and all object types:

```
TableGroup / TableType / CacheLookup / Label / Extends → d365fo_file(action="modify", operation="modify-property", propertyPath="...", propertyValue="...")
```

**Table-extension property paths** (`objectType="table-extension"`): `Label`, `HelpText`, `TableGroup`, `CacheLookup`, `TitleField1`, `TitleField2`, `ClusteredIndex`, `PrimaryIndex`, `SaveDataPerCompany`, `TableType`, `SystemTable`, `ModifiedDateTime`, `CreatedDateTime`, `ModifiedBy`, `CreatedBy`, `CountryRegionCodes`.

**`rename-field` / `replace-all-fields`:**

```
Rename one field   → rename-field   fieldName="OldName" fieldNewName="NewName"
                     (auto-fixes index DataField refs and TitleField1/2)
                     Repair-only: pass OLD corrupted name → only index refs fixed.

Rewrite ALL fields → replace-all-fields  fields=[{name,edt?,type?,mandatory?,label?},...]
                     (use when field names contain spaces or are otherwise corrupted)
```

### TableGroup vs TableType (the most-violated parameter pair)

- **TableGroup** = business role: `Miscellaneous` / `Main` / `Transaction` / `Parameter` / `Group` / `WorksheetHeader` / `WorksheetLine` / `Reference` / `Framework`.
- **TableType** = storage: `RegularTable` (default) / `TempDB` / `InMemory`.
- ⛔ NEVER pass `tableGroup="TempDB"`. Use `tableType="TempDB"`, `tableGroup="Main"`.

---

## `d365fo_file(action="create")` — Rules

- ALWAYS pass `projectPath` (or `solutionPath`). The model is auto-extracted from `.rnrproj`.
- `overwrite=true` is **only** for full XML replacement. NEVER for incremental changes — use `d365fo_file(action="modify")`.
- Azure/Linux response containing returned XML: call `d365fo_file(action="create", xmlContent=..., addToProject=true)`.
- Windows response saying "DO NOT call create": file is already written — STOP.

## `generate_object(mode="scaffold")` — Required Args

- `objectType="table"` — pass `fieldsHint` (and `primaryKeyFields` for composite PKs). Pass `methods=["find","exist"]` if needed — don't add later.
- `objectType="form"` — patterns: `SimpleList`, `SimpleListDetails`, `DetailsMaster`, `DetailsTransaction`, `Dialog`, `TableOfContents`, `Lookup`, `ListPage`, `Workspace`.
- `objectType="report"` — generates Tmp table + Contract + DP class + Controller + Report.
- NEVER include the model prefix in `name` — it's auto-applied. Pass base name + `modelName`.

## `generate_object(mode="pattern")` — Patterns

`batch-job`, `sysoperation`, `table-extension`, `class-extension`, `event-handler`, `security-privilege`, `menu-item`, `data-entity`, `ssrs-report-full`, `lookup-form`, `form-handler`, `form-datasource-extension`, `form-control-extension`, `map-extension`, `dialog-box`, `dimension-controller`, `number-seq-handler`, `display-menu-controller`, `data-entity-staging`, `service-class-ais`, `business-event`, `custom-telemetry`, `feature-class`, `composite-entity`, `custom-service`, `er-custom-function`.

Call `analyze_code(mode="patterns")` first, then `generate_object(mode="pattern")`, then `d365fo_file(action="create")`.

**Security types — don't mix:**
- `security-privilege` → `AxSecurityPrivilege`
- `security-duty` → `AxSecurityDuty`
- `security-role` → `AxSecurityRole`

---

## AxClass `sourceCode` Format

When passing `sourceCode` to `d365fo_file` (action="create" / "modify"), member variables go **inside** the class braces; methods stay at the top level of the string:

```xpp
public class MyClass extends MyBase
{
    int counter;
}

public void myMethod() { ... }
```

## File Paths (AOT)

`C:\AOSService\PackagesLocalDirectory\{Model}\{Model}\Ax{Type}\{Name}.xml`

---

## Token Budget

- `get_object_info` defaults to `compact=true` (signatures only). Max 2 calls per turn.
- Use `get_method(include="source")` for full bodies.
- `search(scope="extensions")` — max once per turn.

## 📣 Transparency

VS 2022 shows only "ran tool_name" — no output. Always:
- Write 1 sentence BEFORE each tool call ("I'll fetch the SalesTable schema").
- Summarize the result in 1–3 lines AFTER.

## Build / BP / Sync / Test Behavior

`run_bp_check`, `build_d365fo_project`, `trigger_db_sync`, `run_systest_class` auto-detect parameters from `.mcp.json`. If they error about missing binaries, fix `.mcp.json`.

- `build_d365fo_project` BLOCKS the user — never call autonomously. After completing changes: *"Changes applied. Run a build when you're ready to validate."* Only build on explicit request. If build reports X++ errors, fix via `d365fo_file(action="modify")` and rebuild until clean.
- `run_bp_check` is the authoritative BP review. NEVER manually iterate `get_method(include="source")` to do BP review by hand.
- `review_workspace_changes` = git diff code review only. NOT for verifying create/modify success.

---

## Workflow Recipes (Tool Sequences)

The X++ rules behind these recipes (CoC authoring, extension naming, when to use events vs CoC, etc.) live in **`SKILL.md` → ang-xpp-dev**. These are tool sequences only.

### Refactoring

```
1. get_object_info(objectType="class", name=class, compact=true)  → signatures
2. analyze_code(mode="completeness", ...)                         → missing standard methods
3. get_method(class, method, include="source")                   → bodies of methods to change
4. find_references(method)                                       → callers
5. d365fo_file(action="modify", ..., dryRun=true)                → preview
6. d365fo_file(action="modify", ..., dryRun=false)               → apply (after user confirms)
```

NEVER delete a method without `find_references` first. NEVER guess bodies from signatures.

### Recipe discipline (applies to every recipe below)

Every recipe that creates or modifies an object starts with: present the plan → `confirm_implementation_plan`. Only then run the recipe's create/modify steps.

Before any `d365fo_file(action="create")` call, the corresponding "what's already there" call MUST run:
- Table extension → `extension_info(mode="table-merge", target=table)` first
- Form extension → `get_object_info(objectType="form", name=form)` first
- CoC class extension → `extension_info(mode="coc", target=class)` first
- New label → `labels(action="search", query=...)` first

Skipping the check = re-doing work that already exists. NEVER skip.

### CoC Class Extension

```
1. extension_info(mode="points", target=target)
2. get_method(target, method, include="signature", includeCocTemplate: true)
3. d365fo_file(action="create", objectType="class-extension", objectName="<Prefix><Target>_Extension", ...)
4. d365fo_file(action="modify", operation="add-method", sourceCode="<CoC skeleton>")
```

Extension naming: see SKILL.md → Naming and Conventions.

### Table Extension

```
1. extension_info(mode="table-merge", target=table)              → existing extensions
2. d365fo_file(action="create", objectType="table-extension", objectName="<Table>.Extension<Prefix>", addToProject=true)
3. d365fo_file(action="modify", operation="add-field" | "add-index" | "add-field-group" | ...)
```

### Form Extension

```
1. get_object_info(objectType="form", name=form, searchControl="TabName")  → exact control names
2. d365fo_file(action="create", objectType="form-extension", objectName="<Form>.Extension<Prefix>", addToProject=true)
3. d365fo_file(action="modify", operation="add-control", parentControl="Tab", controlDataField="Field", ...)
```

### Event Handler (only when CoC is impossible — see SKILL.md)

```
1. extension_info(mode="events", target=target)
2. d365fo_file(action="create", objectType="class", objectName="<Target>EventHandler", ...)
3. Standard data events:  [DataEventHandler(tableStr(T), DataEventType::Inserted)]
   Custom delegates:      [SubscribesTo(classStr(C), delegateStr(C, myDelegate))]
```

### SSRS Report

**Preferred:** `generate_object(mode="scaffold", objectType="report", name, fieldsHint, caption, contractParams)` — generates all 5 objects.

**Manual order:** Tmp table → Contract → DP class → Controller → Report (`d365fo_file(action="create", objectType="report", xmlContent=...)`).

### Labels Workflow

```
1. labels(action="search", query=...)                          → check existing first
2. labels(action="create", labelId, labelFileId, model, translations, createLabelFileIfMissing: true)
3. labels(action="rename", oldLabelId, newLabelId, ...)        → renames across files
```

Label naming, EDT inheritance, and content rules: see SKILL.md → Labels and Security.

---

## Tool-Specific Gotchas

- For EDTs use `get_object_info(objectType="edt", ...)`, NOT `objectType="enum"`.
- `get_object_info(objectType="form", ...)` works for ALL forms (standard + custom). If ⚠️ warning, retry with `filePath=`.
- NEVER guess method signatures before authoring CoC — always `get_method(include="signature")` first.
- NEVER call `[SysObsolete]` methods — read the attribute for the replacement.
- NEVER switch projects autonomously via `get_workspace_info(projectName=...)` — ask the user.
- ALWAYS call `get_knowledge(kind="error", ...)` for D365FO errors instead of guessing fixes.
