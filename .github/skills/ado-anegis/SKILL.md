---
name: ado-anegis
description: "Work with Anegis Azure DevOps (org anegis.visualstudio.com) via the ado-remote-mcp tools — query work items, repos, PRs, pipelines, wikis and test plans. Use whenever the user asks about ADO/DevOps work items, user stories (US MOD/INT/PRO/MIG/ORG), tasks, REQs, bugs, sprints, PRs, pipelines, or 'my work' in an Anegis D365 implementation project. Encodes the Anegis process-template taxonomy, query recipes, and tool gotchas that the generic ADO tool manifest does NOT carry."
argument-hint: "Provide: which project, who (email/name or 'me'), and what (work item type / state / id)."
user-invocable: true
---

# Anegis Azure DevOps Workflow

The `ado-remote-mcp` server exposes ~90 generic Azure DevOps tools. The tool **manifest tells you how to call the API; it says nothing about Anegis conventions.** This skill is that missing layer: the custom work-item taxonomy, naming rules, query recipes, and gotchas. Ground every answer in a query — never guess IDs, types, or assignees.

---

## 0. Tooling mechanics (read first)

- **Tools are deferred.** Their names appear in `<system-reminder>` blocks but their schemas are NOT loaded. Load before calling:
  `ToolSearch` with `select:mcp__ado-remote-mcp__<name>[,<name>...]` (exact), or a keyword query.
- **The server disconnects/reconnects.** If a call fails with "permission stream closed" / "MCP server disconnected", re-run `ToolSearch select:...` to reload the schema, then retry. Don't conclude the capability is gone.
- **Reads are safe; writes are outward-facing.** Querying is free. Creating/updating work items, PRs, comments, wiki pages (`wit_create_work_item`, `wit_update_work_item`, `repo_create_pull_request`, `wiki_create_or_update_page`, …) **mutates a shared system other people see — confirm with the user before any write**, even if they implied it.

---

## 1. Org facts

| Fact | Value |
|---|---|
| Organization | `anegis.visualstudio.com` (== `dev.azure.com/anegis`) |
| "My" items | `wit_my_work_items` resolves to the **authenticated user's** ADO identity — you don't name yourself |
| Live project list / GUIDs | call `core_list_projects` (don't hardcode GUIDs — they change per environment) |
| Process-template doc (wiki) — **authoritative** | Anegis maintains a **standard DevOps process-template project** whose wiki documents every work-item type and field. Discover it via `core_list_projects` (the standard/template project) and `wiki_list_wikis` for its id. Per-type pages at `/Obiekty/<TYPE>` (e.g. `/Obiekty/US MOD`); value dictionaries at `/Słowniki DevOps/...`; tree rules at `/Struktura obiektów w DevOps`. ⚠️ Fetch by **path** (`wiki_get_page_content(project, wikiIdentifier, path)`); the page-id URL form (e.g. `/<pageId>/US-MOD`) 404s through the tool. |

The taxonomy below is the **Anegis implementation process template**, shared across Anegis D365 implementation projects — not project-specific.

---

## 2. Two hard rules about the query tools

### Rule A — `wit_query_by_wiql` returns IDs ONLY
Even if you put `[System.Title]`, `[System.State]` etc. in the `SELECT`, the result is just `{id, url}` per row. **Always pair it with `wit_get_work_items_batch_by_ids`** (pass an explicit `fields` list) to read values. (The SELECT columns are echoed as metadata but field values are never in the WIQL result.)

```
1. wit_query_by_wiql        → list of IDs
2. wit_get_work_items_batch_by_ids(ids, fields:[...])  → the actual data
```

### Rule B — prefer `search_workitem` when you can
`search_workitem` returns **content directly** (id, type, title, assignee, state, tags, dates, description) **and facets** (counts by type / state / assignee) in ONE call — no batch-fetch needed. Use it for text search, type/state/assignee filtering, and for enumerating a project's taxonomy via `includeFacets:true`.
- ⚠️ It searches **ALL projects** unless you pass `project:["<PROJECT>"]`. Facets confirm the spill (you'll see other projects listed).
- ⚠️ `assignedTo` / `state` / `workItemType` are arrays; `assignedTo` values use the **display + email** form: `"First Last <user@anegis.com>"`.

Use WIQL when you need precise boolean/relational logic (`IN`, `<>`, parent/child via `[System.Parent]`, `@Me`, date math) or guaranteed-complete result sets.

---

## 3. Tool routing (the ones you actually need)

| Need | Tool |
|---|---|
| My assigned items | `wit_my_work_items` (type `assignedtome` or `myactivity`) — IDs only, batch-fetch after |
| Precise work-item query | `wit_query_by_wiql` → `wit_get_work_items_batch_by_ids` |
| Text / faceted search | `search_workitem` (content + facets, one call) |
| One item + parent/children/PRs/commits | `wit_get_work_item(id, expand:"relations")` |
| Bulk read fields | `wit_get_work_item_type` (type def), `wit_get_work_items_batch_by_ids` |
| Comments | `wit_list_work_item_comments` / `wit_add_work_item_comment` (write) |
| Projects / teams / iterations | `core_list_projects`, `core_list_project_teams`, `work_list_iterations`, `wit_get_work_items_for_iteration` |
| Repos / branches / files | `repo_list_repos_by_project`, `repo_list_branches_by_repo`, `repo_get_file_content`, `repo_list_directory` |
| PRs | `repo_list_pull_requests_by_repo_or_project`, `repo_get_pull_request_by_id`, `repo_get_pull_request_changes`, `repo_list_pull_request_threads` |
| Pipelines / builds | `pipelines_get_builds`, `pipelines_get_build_status`, `pipelines_get_build_log`, `pipelines_list_runs` |
| Wiki | `wiki_list_wikis`, `wiki_list_pages`, `wiki_get_page_content` |
| Test plans | `testplan_list_test_plans`, `testplan_list_test_suites`, `testplan_list_test_cases` |
| Code search | `search_code`, `search_wiki` |

---

## 4. Work-item type taxonomy + hierarchy (Anegis template)

Structural tree (per the wiki `/Struktura obiektów w DevOps` + `/Obiekty/US MOD`,`/US INT`):

```
Epic / Feature                         (grouping; Epic↔Feature may nest freely)
  └─ US PRO | US MOD | US INT | US MIG | US ORG   (the "User Story" level — ALL siblings, each a direct child of a Feature)
       └─ Task CON | Task DEV | Task ADM | Task CUS | Task TST   (execution level)
          + Release Note · Meeting · Bug          (also valid children of a US)
```

**Hierarchy rules (authoritative):**
- A US is **always a child of a `Feature`**. A US **cannot** have another US as a child. Don't skip levels (no Task directly under a Feature).
- `US PRO` is the concept / "to-be" process design. `US MOD/INT/MIG/ORG` link to their concept via the **LinkPRO field** (`Custom.LinkPROC`) — a *field link, NOT parent/child*. So US PRO and US MOD are **siblings**, not parent→child.
- `REQ` / `ChangeReq` relate to a US via the **title code** (e.g. `REQ-<AREA>-<seq>` embedded in the US title) and the **LinkCR** field — not a structural parent. (`REQ` is heavily used but has no `/Obiekty` page in the template wiki.)
- Verify a real tree with `wit_get_work_item(id, expand:"relations")`: `System.Parent` = the Feature; Hierarchy-Forward = the Tasks/Bugs.

| Type | Meaning |
|---|---|
| `Epic` / `Feature` | Top-level grouping; **`Feature` is the structural parent of every US** |
| **`US PRO`** | Process/concept user story — the "to-be" design |
| **`US MOD`** | **Modification** — *any* source-code change. FDD doc; analysis in phase F2, build in F4 |
| **`US INT`** | **Integration / Interface** — technically a modification but its own type; carries integration metadata (entity, source/target/middleware, OData/DMS, volumes) |
| **`US MIG`** | **Migration** — data migration (see `TypeMig`/`TypeDataMig` dictionaries) |
| **`US ORG`** | **Organizational** — config / org-process, often no code |
| `Task CON` | Consultant / functional task (title ends `- CON`) |
| `Task DEV` | Developer task (title ends `- DEV`) |
| `Task ADM` | Administrator task (environment / release mgr) |
| `Task CUS` | Customer-side task |
| `Task TST` | Testing task |
| `REQ` | Requirement (e.g. `REQ-<AREA>-<seq>`) |
| `ChangeReq` | Change request (post-baseline change; CR) |
| `Bug` / `BugInternal` | Customer-found / internally-found defects |
| `Risk` | Risk register (`1-High`/`2-Medium`/`3-Low`) |
| `Meeting` | Meeting + its status (`TypeMeeting`: Training/Analysis/Management/Third Party/Other) |
| `Holiday` | Absence (title = `[date]-[date] [Name]`) |
| `Issue Proj`, `SLA Ticket`, `Release Note` | Project issue / service ticket / release note |
| `Test Case` / `Test Suite` | Test management |

**The "US MOD / US INT" a user asks about = the work-item types named exactly `US MOD` / `US INT`.** There is NO type called "User Story" — `WorkItemType = 'User Story'` returns empty.

---

## 5. States (type-dependent — there is no single state model)

Different types use different state sets. Observed values:
- **Generic (US/Task/REQ):** `New` → `Active` → `In Progress` / `Analysis and Doc` / `Implementation` → `Resolved` → `Closed`; plus `On Hold`.
- **Numbered (Test/CUS flows):** `01 New`, `02 Active`, `02 In progress TS CUS`, `03 Closed`, `05 Accepted TS`, `05 For approval TS CUS`, `11 For rework TS`, `99 Cancelled`.

For the **real lifecycle of a US**, the System.State is coarse; the detailed status lives in custom fields (see §7): `Custom.StateAnalysis*`, `Custom.StateImplementation*`, `Custom.ProjectPhase*` (exact suffix varies by project). To enumerate the exact states a project uses, call `search_workitem(..., includeFacets:true)` and read the `System.State` facet.

---

## 6. Naming & tagging conventions

**Title pattern:** `<USCODE> <REQCODE?> <description>` where codes are `TYPE-AREA-SEQ`.
- `MOD-<AREA>-<seq> <short description>` (US MOD)
- `INT-<seq> <short description>` (US INT / integration)
- `REQ-<AREA>-<seq> …` (requirement)
- Child tasks reuse the parent code + suffix: `… - DEV`, `… - CON`, `… - <note> - Dev`.

**Business-area codes** (in titles & tags): `O2C` (Order-to-Cash) and `S2P` (Source-to-Pay) are high-confidence standard streams; `MAG` = Magazyn (warehouse). Other codes (`I2D`, `ARCH`, …) appear in titles but are **NOT defined in any ADO wiki** (searched org-wide → 0 hits) — they live in the customer's process-architecture / SharePoint docs, not DevOps. The wiki `/Słownik pojęć` is only a *contractual PMO glossary* (SharePoint), not these codes. **Do not assert an expansion for an unconfirmed code — ask the user.** Phase tags `F0x` map to the ProjectPhase dictionary (§8); `Etap`/`Stage` map to ProjectStage (§8).

**Git linkage:** branches/commits follow `T<id> <REQCODE>-<USCODE>` (e.g. branch `feature/<id>-MOD-<nn>`, commit `T<id> REQ-<AREA>-<seq>-MOD-<nn> …`). The `T<number>` is the ADO work-item ID — use it to jump from a branch to its work item. PRs and commits also appear on the work item as `ArtifactLink` relations (`expand:"relations"`).

---

## 7. Useful custom fields (US MOD/INT)

`wit_get_work_item(id, expand:"none"|"fields")` returns these. The ones worth knowing:

| Field | Meaning |
|---|---|
| `System.AssignedTo` | Current owner — **rotates** through analysis→dev→test phases |
| `Custom.AnegisDEV` | **The developer** (group *Responsible*; stays even when AssignedTo moves) |
| `Custom.AnegisUser` / `Custom.CustomerUser` | Anegis consultant / customer contact responsible |
| `Custom.MoSCoW`, `Microsoft.VSTS.Common.Priority`, `Custom.ProjectStage`, `Custom.TypeBudget` | Scope classification (see §8 for values) |
| `Custom.StateAnalysis*`, `Custom.StateImplementation*`, `Custom.ProjectPhase*` | True analysis/impl status (`StateAnalysis` in implementation projects; `StateDiagnosis`/`StateImplementationANG`/`StateImplementationCUS` on US INT for the diagnosis project + Anegis/customer split). The exact suffix (e.g. `_v3`) varies by project. |
| `Custom.StoryPointsCON` / `Custom.StoryPointsDEV` / `StoryPointsAdm` | Estimates (consultant / developer / administrator) |
| `Custom.MODComplexity` (US MOD) · `Custom.INTComplexity` (US INT) | Complexity = estimated deviation from the summed story-point budget (phase F4) |
| `Custom.SumofHours*` | Logged hours (`*Bill*` = billable) |
| `Custom.SignBAReq`, `Custom.SignSAFDD`, `Custom.SignTAFDD` | Sign-offs: Business Architect (customer) / Solution Architect (Anegis) / Technical Architect (Anegis) |
| **Env progression** `Custom.OnTest → ReadytoUAT → MergedtoUAT → OnUAT → ReadytoPROD → OnPROD → OnProdParameterized`, then post-go-live `ReadytoPRODFIX → MergedtoProdfix → OnPRODFIX` | Boolean flags tracking *where the change physically is* (tab "Where is MOD/INT?"). This is the deploy pipeline. |
| `Custom.CODE`, `Custom.GERorSCRIPT` | Is it a code change? Is it a GER (report) / script change? |
| `Custom.LinkFDD` | SharePoint FDD document (html) |
| `Custom.LinkPROC` (a.k.a. LinkPRO) | Field-link to the related **`US PRO`** concept (NOT the structural parent — §4) |
| `Custom.LinkHelpANG` | Wiki page defining this US type (`/Obiekty/<TYPE>`) |
| `Microsoft.VSTS.Scheduling.StartDate` / `Custom.EndDate` | Start / planned end. ⚠️ `EndDate` is **deprecated** for new projects (kept for legacy); prefer the `TargetDate` field. |
| `System.Parent` | Parent (the Feature). Also in `expand:"relations"`. |
| `System.Tags` | `;`-separated: area codes, phase, `P<id>` refs, release tags |

**US INT only** (tab *TA*, for integrations): `Logical Entity` (D365 entity), `Source System`, `Target System`, `Middleware System` (e.g. OPAA, LogicApp), `Interface Model` (OData, DMS), `Sync Mode` (sync/async), `Avg Daily Volume`, `Peak Hour Volume`, `Frequency (per Hour)`, `Initial Sync mechanism`.

---

## 8. Field-value dictionaries (from wiki `/Słowniki DevOps/Klasyfikacja`)

- **ProjectStage** (go-live milestone): `01 Stage I` (at go-live) · `02 Stage II` (after go-live, before 1st month-close) · `03 Stage III` (post-go-live dev) · … `10 Stage X`.
- **MoSCoW**: `01 Must Have` · `02 Should Have` · `03 Could Have` · `04 Won't Have`.
- **Priority**: list `1`–`4`, sprint execution priority.
- **ProjectPhase** (F-codes, budget control per phase — on Tasks): `F01 Project Prep` · `F02 Analysis & Modeling` · `F03 Prototyping` · `F04 Implementation` · `F05 UAT` · `F06 Go-live Prep` · `F07 Go-live` · `HyperCare` · `Maintenance` · `ND`. (So a "F2" tag = analysis, "F4" = build. US MOD/INT: analysis in F2, build in F4.)
- **TypeBudget**: `01 Main Budget` · `02 Additional Budget` (typical for extra MOD/INT/ORG) · `03 Additional paid` · `04 Nonbillable`.
- **TypeMig / TypeDataMig / TypeMigWay** (US MIG): migration kind (Initial/Test/Prod), data class (Parameters/Dictionary/Master/Transaction/Document), and method (Manual CUS/CON, File, Interface, OPAA).
- **Task type sub-classifications** exist too (`TypeTaskCON/DEV/ADM`, `ActivityCON`) — fetch the page if needed.

---

## 9. Query recipes (cookbook)

**"My work items"** (uses your authenticated identity):
```
wit_my_work_items(project:"<PROJECT>", type:"assignedtome")  → IDs
wit_get_work_items_batch_by_ids(ids, fields:["System.WorkItemType","System.Title","System.State"])
```

**"What US MOD / US INT does <person> have?"** — filter by the exact email, NOT a name CONTAINS (a short surname can collide with a longer colleague's name):
```sql
SELECT [System.Id] FROM WorkItems
WHERE [System.TeamProject] = '<PROJECT>'
  AND [System.WorkItemType] IN ('US MOD','US INT')
  AND [System.AssignedTo] = 'user@anegis.com'
ORDER BY [System.WorkItemType], [System.Title]
```
then batch-fetch titles/states. (Or one call: `search_workitem(searchText:"MOD", project:["<PROJECT>"], workItemType:["US MOD","US INT"], assignedTo:["First Last <user@anegis.com>"])`.)

**Enumerate a project's types/states/people** (no batch-fetch needed):
```
search_workitem(searchText:"<broad term, e.g. a common area code>", project:["<PROJECT>"], includeFacets:true, top:3)
→ read facets: System.WorkItemType, System.State, System.AssignedTo
```

**From a git branch/commit to its work item:** parse the `T<id>` → `wit_get_work_item(<id>)`.

**A work item's PRs / commits / children:**
```
wit_get_work_item(id, expand:"relations")
→ Hierarchy-Forward = children; Hierarchy-Reverse = parent;
  ArtifactLink (name "Pull Request" / "Fixed in Commit") = git links
```

**Find by free text across the project:** `search_workitem(searchText:"...", project:["<PROJECT>"])`.

**"Who's the developer on this US?"** read `Custom.AnegisDEV`, not `System.AssignedTo` (which drifts by phase).

**Read the official definition of a type / field:**
```
wiki_get_page_content(project:"<template project>",   # discover via core_list_projects / wiki_list_wikis
  wikiIdentifier:"<id from wiki_list_wikis>",
  path:"/Obiekty/US MOD")          # or "/Słowniki DevOps/Klasyfikacja", "/Struktura obiektów w DevOps"
```

---

## 10. Gotchas checklist

- ❌ `WorkItemType = 'User Story'` → empty. ✅ Use `'US MOD'`, `'US INT'`, `'US PRO'`, `'US MIG'`, `'US ORG'`.
- ❌ `AssignedTo CONTAINS '<surname>'` → collides (a short surname can be a substring of a colleague's name) and returns all types. ✅ Match the exact email in WIQL, or the `Name <email>` facet form in `search_workitem`.
- ❌ Trusting WIQL SELECT columns to contain data → they don't; always batch-fetch.
- ❌ `search_workitem` without `project:[...]` → leaks results from other projects.
- ❌ Concluding a tool is unavailable after a disconnect → reload via `ToolSearch select:...`.
- ❌ Writing to ADO (create/update/comment/PR) without confirming → it's shared & outward-facing; confirm first.
- ❌ Treating `US PRO` as the parent of `US MOD/INT` → they're **siblings under a `Feature`**, joined by the `LinkPRO` field, not parent/child. Don't expect a US under another US.
- ❌ Fetching a wiki page by its page-id URL (e.g. `/<pageId>/US-MOD`) → 404s via the tool; fetch by `path` (`/Obiekty/US MOD`).
- ❌ Inventing an expansion for an area code (`I2D`, …) → only `O2C`/`S2P`/`MAG` are confirmed; the rest aren't in any ADO source. Ask.
- 🏷️ The "current assignee" of a US drifts across analysis→dev→test phases; for "who's the developer" read `Custom.AnegisDEV`.
