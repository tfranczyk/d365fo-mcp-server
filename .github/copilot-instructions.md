# D365 Finance & Operations — MCP Tool & Environment Rules

This workspace contains D365FO code. **Always use the specialized MCP tools** — backed by a pre-indexed symbol database with hundreds of thousands of D365FO objects. Built-in file/search tools do not understand X++ syntax or AOT structure.

This file does **NOT** contain X++ coding standards, naming conventions — those live in the `ang-xpp-dev` skill (`SKILL.md`). Read both.

## Before any action:

1. Call `get_workspace_info()` once. Note the model name. If the call errors or shows ⛔ CONFIGURATION PROBLEM, STOP and report.
2. Use MCP tools (NEVER built-in file/edit tools) for any `.xml`, `.xpp`, `.label.txt`, or `.rnrproj` file.
3. Run `modify_d365fo_file` with `dryRun=true` first → show diff → wait for explicit confirmation → re-run with `dryRun=false`.
4. NEVER run terminal commands or PowerShell — they hang in this workspace.
5. NEVER run `build_d365fo_project` autonomously — builds block the user. Wait for "build" / "compile" / "check errors".

Everything below is reference material that supports these five rules.

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

Info tools (`get_class_info`, `get_table_info`, `get_form_info`, `get_view_info`, `get_query_info`, `get_report_info`, `get_table_extension_info`, `find_coc_extensions`, `analyze_extension_points`) resolve in this order:

1. **C# bridge** — live `IMetadataProvider` from the running D365FO instance. Authoritative when available.
2. **SQLite symbol index** — pre-built mirror. Used when bridge is offline (Azure, write-only mode, build agents).
3. **Filesystem parse** — last resort for objects created in the current session and not yet indexed. 3 s budget, 30 s cache. Disable in production with `D365FO_DISABLE_FS_FALLBACK=true`.

Never pick the source manually. If you see ⚠️ "Served from symbol index" or "Not yet in bridge metadata", the tool already fell back.

## 🛡️ Write-Path Safety

All write operations (`modify_d365fo_file`, `create_d365fo_file`) only accept paths under a configured `PackagesLocalDirectory/<Package>/<Model>/Ax<Type>/<Name>.xml`. Arbitrary paths are rejected.

---

## Dry-Run Protocol — `modify_d365fo_file`

VS 2022 has no Keep/Undo for MCP edits. The diff must be reviewed in chat before disk is touched.

Required sequence for **every** modify call:

1. `modify_d365fo_file(..., dryRun=true)` → present diff to user.
2. Wait for explicit confirmation ("apply" / "ok" / "yes" / etc.).
3. `modify_d365fo_file(..., dryRun=false)` with the SAME args.

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

If `modify_d365fo_file` is the correct tool but you feel tempted to try something else, you are wrong. STOP.

```
WRONG SPIRAL (each step is more wrong):
 Step 1: "I'll use replace_string_in_file to patch the XML"
 Step 2: "replace failed — I'll try a different approach"
 Step 3: "I'll read the file with PowerShell first, then overwrite"
 Step 4: "Terminal returns no output — I'll add Write-Output"
 Step 5: "I'll use create_d365fo_file with overwrite=true"

CORRECT (always, immediately):
 modify_d365fo_file(operation="add-field-group" | "add-field" | "add-method" | …)
```

If `modify_d365fo_file` itself errors → STOP and report. Do NOT try PowerShell.

---

## Tool Routing — Request → Tool

| Request | Tool(s) |
|---|---|
| Edit existing object | `modify_d365fo_file` |
| Create new object | `create_d365fo_file` |
| Search | `search`, `batch_search` |
| Read class/table/form/report | `get_class_info`, `get_table_info`, `get_form_info`, `get_report_info` |
| Where is X used? | `find_references(targetName)` |
| What can I extend? | `analyze_extension_points(objectName)` |
| Which extension mechanism? | `recommend_extension_strategy(goal)` |
| CoC extensions of X? | `find_coc_extensions(className)` |
| Event handlers for X? | `find_event_handlers(targetName)` |
| Security coverage | `get_security_coverage_for_object(objectName)` |
| Create SSRS report | `generate_smart_report(name, fieldsHint, ...)` |
| Diagnose X++ error | `get_d365fo_error_help(errorText)` — never guess |
| X++ knowledge / patterns | `get_xpp_knowledge(topic)` → `analyze_code_patterns(scenario)` |
| Create table/form | `generate_smart_table` / `generate_smart_form` |
| Best practices / BP check | `run_bp_check` (NEVER manually iterate `get_method_source`) |
| Build | `build_d365fo_project` (only on explicit user request) |
| Sync DB | `trigger_db_sync` |
| Run tests | `run_systest_class` |
| Verify project | `verify_d365fo_project` |
| Search labels | `search_labels` |
| Create label | `create_label(..., createLabelFileIfMissing: true)` |
| Rename label | `rename_label` |

---

## `modify_d365fo_file` — Operation Inventory

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
TableGroup / TableType / CacheLookup / Label / Extends → modify_d365fo_file(operation="modify-property", propertyPath="...", propertyValue="...")
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

## `create_d365fo_file` — Rules

- ALWAYS pass `projectPath` (or `solutionPath`). The model is auto-extracted from `.rnrproj`.
- `overwrite=true` is **only** for full XML replacement. NEVER for incremental changes — use `modify_d365fo_file`.
- Azure/Linux response containing returned XML: call `create_d365fo_file(xmlContent=..., addToProject=true)`.
- Windows response saying "DO NOT call create_d365fo_file": file is already written — STOP.

## `generate_smart_*` — Required Args

- `generate_smart_table` — pass `fieldsHint` (and `primaryKeyFields` for composite PKs). Pass `methods=["find","exist"]` if needed — don't add later.
- `generate_smart_form` — patterns: `SimpleList`, `SimpleListDetails`, `DetailsMaster`, `DetailsTransaction`, `Dialog`, `TableOfContents`, `Lookup`, `ListPage`, `Workspace`.
- `generate_smart_report` — generates Tmp table + Contract + DP class + Controller + Report.
- NEVER include the model prefix in `name` — it's auto-applied. Pass base name + `modelName`.

## `generate_code` — Patterns

`batch-job`, `sysoperation`, `table-extension`, `class-extension`, `event-handler`, `security-privilege`, `menu-item`, `data-entity`, `ssrs-report-full`, `lookup-form`, `form-handler`, `form-datasource-extension`, `form-control-extension`, `map-extension`, `dialog-box`, `dimension-controller`, `number-seq-handler`, `display-menu-controller`, `data-entity-staging`, `service-class-ais`, `business-event`, `custom-telemetry`, `feature-class`, `composite-entity`, `custom-service`, `er-custom-function`.

**Security types — don't mix:**
- `security-privilege` → `AxSecurityPrivilege`
- `security-duty` → `AxSecurityDuty`
- `security-role` → `AxSecurityRole`

---

## AxClass `sourceCode` Format

When passing `sourceCode` to the modify/create tools, member variables go **inside** the class braces; methods stay at the top level of the string:

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

- `get_class_info` defaults to `compact=true` (signatures only). Max 2 calls per turn.
- Use `get_method_source(class, method)` for full bodies.
- `search_extensions` — max once per turn.

## 📣 Transparency

VS 2022 shows only "ran tool_name" — no output. Always:
- Write 1 sentence BEFORE each tool call ("I'll fetch the SalesTable schema").
- Summarize the result in 1–3 lines AFTER.

## Build / BP / Sync / Test Behavior

`run_bp_check`, `build_d365fo_project`, `trigger_db_sync`, `run_systest_class` auto-detect parameters from `.mcp.json`. If they error about missing binaries, fix `.mcp.json`.

- `build_d365fo_project` BLOCKS the user — never call autonomously. After completing changes: *"Changes applied. Run a build when you're ready to validate."* Only build on explicit request. If build reports X++ errors, fix via `modify_d365fo_file` and rebuild until clean.
- `run_bp_check` is the authoritative BP review. NEVER manually iterate `get_method_source` to do BP review by hand.
- `review_workspace_changes` = git diff code review only. NOT for verifying create/modify success.

---

## Workflow Recipes (Tool Sequences)

The X++ rules behind these recipes (CoC authoring, extension naming, when to use events vs CoC, etc.) live in **`SKILL.md` → ang-xpp-dev**. These are tool sequences only.

### Refactoring

```
1. get_class_info(class, compact=true)         → signatures
2. analyze_class_completeness(class)           → missing standard methods
3. get_method_source(class, method)            → bodies of methods to change
4. find_references(method)                     → callers
5. modify_d365fo_file(..., dryRun=true)        → preview
6. modify_d365fo_file(..., dryRun=false)       → apply (after user confirms)
```

NEVER delete a method without `find_references` first. NEVER guess bodies from signatures.

### CoC Class Extension

```
1. analyze_extension_points(target)
2. get_method_signature(target, method, includeCocTemplate: true)
3. create_d365fo_file(objectType="class-extension", objectName="<Target><Prefix>_Extension", ...)
4. modify_d365fo_file(operation="add-method", sourceCode="<CoC skeleton>")
```

Extension naming: see SKILL.md → Naming and Conventions.

### Table Extension

```
1. get_table_extension_info(table)             → existing extensions
2. create_d365fo_file(objectType="table-extension", objectName="<Table>.<Prefix>Extension", addToProject=true)
3. modify_d365fo_file(operation="add-field" | "add-index" | "add-field-group" | ...)
```

### Form Extension

```
1. get_form_info(form, searchControl="TabName")  → exact control names
2. create_d365fo_file(objectType="form-extension", objectName="<Form>.<Prefix>Extension", addToProject=true)
3. modify_d365fo_file(operation="add-control", parentControl="Tab", controlDataField="Field", ...)
```

### Event Handler (only when CoC is impossible — see SKILL.md)

```
1. find_event_handlers(target)
2. create_d365fo_file(objectType="class", objectName="<Target>EventHandler", ...)
3. Standard data events:  [DataEventHandler(tableStr(T), DataEventType::Inserted)]
   Custom delegates:      [SubscribesTo(classStr(C), delegateStr(C, myDelegate))]
```

### SSRS Report

**Preferred:** `generate_smart_report(name, fieldsHint, caption, contractParams)` — generates all 5 objects.

**Manual order:** Tmp table → Contract → DP class → Controller → Report (`create_d365fo_file(objectType="report", xmlContent=...)`).

### Labels Workflow

```
1. search_labels(query)                        → check existing first
2. create_label(labelId, labelFileId, model, translations, createLabelFileIfMissing: true)
3. rename_label(oldLabelId, newLabelId, ...)   → renames across files
```

Label naming, EDT inheritance, and content rules: see SKILL.md → Labels and Security.

---

## Tool-Specific Gotchas

- NEVER use `get_enum_info` for EDTs — use `get_edt_info`.
- `get_form_info` works for ALL forms (standard + custom). If ⚠️ warning, retry with `filePath=`.
- NEVER guess method signatures before authoring CoC — always `get_method_signature` first.
- NEVER call `[SysObsolete]` methods — read the attribute for the replacement.
- NEVER switch projects autonomously via `get_workspace_info(projectName=...)` — ask the user.
- ALWAYS call `get_d365fo_error_help` for D365FO errors instead of guessing fixes.
