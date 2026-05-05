---
name: ang-xpp-dev
description: 'Enterprise X++ engineering workflow for D365 Finance and Operations. Use for implementing or reviewing customizations with Anegis coding standards: meta-principles, customization strategy (CoC-first), naming conventions, X++ language essentials, traceability, table/form/entity/security rules, best-practice compliance, and DevOps check-in discipline.'
argument-hint: 'Provide work item ID, project/model, artifact type, and expected business behavior.'
user-invocable: true
---

# ANG X++ Development Excellence Workflow

## Purpose

This skill provides a complete, repeatable workflow for implementing or reviewing Microsoft Dynamics 365 Finance and Operations customizations in X++ with production-grade quality and traceability.

Optimized for:
- New feature implementation from work item and design docs
- Refactoring existing customizations to meet standards adn coding principles.
- Stabilization work when quality or maintainability is low

## What This Skill Produces

- A standards-compliant implementation plan before coding
- Correct extension strategy (CoC-first, with events only when CoC is impossible)
- Naming and structure aligned with project prefix and model conventions
- Traceable documentation blocks in class and method-level comments
- Verified build/BP/test/review package

---

## Meta-Principles (Apply to Every X++ Task)

These four principles govern HOW the agent approaches an X++ task. They bias toward caution over speed — for trivial fixes, use judgment, but for any work that touches multiple artifacts or creates new persistent ones, follow them.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple extension paths exist (CoC vs event vs new artifact), present them — don't pick silently. Usually we implement new features through CoC, avoid event handlers unless necessary.
- If a simpler approach exists (e.g. new field vs new code), say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

For X++ specifically:
- Identify the exact target object and model BEFORE writing code. Verify its connections to other objects in the system - are there realted tables, forms, entities, views, EDTs?
- Verify table / method / field names against the live system (via MCP tools), not from memory.
- Confirm the project prefix, label file ID, and configuration key BEFORE generating names.

### 2. Simplicity First

**Minimum X++ that solves the problem. Nothing speculative.**

- No fields, methods, controls, or config beyond what was asked.
- Prefer metadata changes over code; prefer existing extension points over new artifacts.
- No abstractions for single-use code.
- No "flexibility" or "configurability" the spec didn't request.
- No multiple finds on the underlying tables on what could be a single combined SQL query.
- If you wrote 200 lines of CoC and it could be 50, rewrite it.

The test: would a senior X++ developer say this is overcomplicated? If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When modifying existing artifacts:
- Don't "improve" adjacent methods, properties, labels, or layout.
- Don't refactor existing standard code.
- Match existing style and naming and other coding principels on the project, even if you'd do it differently.
- If you notice unrelated dead code or BP warnings, mention them — don't fix them.

When your changes create orphans (unused EDTs, indexes, labels, controls):
- Remove what YOUR changes made unused.
- Don't remove pre-existing dead artifacts unless asked.

The test: every changed line traces directly to the work item.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Reject the bad inputs in BP-clean code, then verify on the form"
- "Fix the bug" → "Reproduce the failure first, then make it pass"
- "Refactor X" → "BP check passes before AND after"

For multi-artifact tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

The X++ verification ladder (run in this order):

1. Compile clean.
2. BP check clean — no new errors, warnings only with documented justification.
3. DB sync if metadata changed. (ran by the user)
4. System user tests pass for the affected scenario in the affected form / batch / entity.

Strong success criteria let the agent loop independently. Weak criteria ("make it work") require constant clarification.

---

## Required Inputs Gate

Collect these before coding. If any input is missing, STOP and request it.

1. Work item ID and short title.
2. Project / model name and project prefix (3-character object prefix) - usually Ang.
3. Target artifact types (class, table, form, data entity, security, labels).
4. Functional requirements and functional design references.
5. Expected user behavior and non-functional constraints.
6. Legal entity enable/disable expectations for the customization - relevant for the modification parameters.

---

## Hard Rules (Never Break)

1. **No overlayering.** Use extensions / customization patterns only.
2. **One work item, one solution, one project**, with aligned naming.
3. **Solution name and project name are identical.**
4. **Zero compile errors and zero new BP errors before check-in.** BP warnings only with documented suppression and justification.
5. **Every change has a traceable work item ID** in code comments.

---

## Customization Strategy

The decision order is **strict**, not advisory.

1. Can the requirement be met by **metadata or configuration alone**? → Stop here.
2. Otherwise, can existing behavior be **wrapped with Chain of Command**? → Use CoC.
3. Otherwise, is the base method `[Hookable(false)]` or `final` without `[Wrappable(true)]`? → Use a standard data event (`[DataEventHandler]`) or existing custom delegate.
4. Otherwise, create a **new artifact** (class, table, form, entity) — prefixed and isolated.

### Why CoC first

CoC has the strongest contract:
- Access to **protected** members of the augmented class (since Platform Update 9).
- Defined execution order with `next`.
- Survives platform updates because the wrapper is bound by metadata, not by name lookup.

Events are broadcasts: no order guarantees, no protected access, no return value influence, fragile if Microsoft renames the underlying delegate.

### Use events ONLY when CoC is impossible

Events are not a "lighter" alternative to CoC. The only valid reasons to skip CoC are:

- The base method is `[Hookable(false)]`.
- The base method is `final` without `[Wrappable(true)]`.
- The intervention point is a standard data event (`Inserted`, `Updated`, `Deleted`, ...) with no equivalent overridable method.
- A custom delegate is the only published extension surface.

If CoC works, use it.

---

## X++ Language Essentials

These are language facts, verified against Microsoft Learn (URLs in the References section). They override habit.

### Classes & Methods

- Default class access is `public`. Use `internal` to limit to the same model, `final` to block inheritance.
- Default field visibility is `protected`. **NEVER make instance fields `public`** — expose via `parmFoo` accessors.
- Method modifier order: `[edit | display] [public | protected | private | internal] [static | abstract | final]`.
- Override visibility may **not** be more restrictive than the base.
- Optional parameters come last. Callers cannot skip an optional parameter to reach a later one. Use `parmIsDefault(_x)` inside a `parmX(_x = x)` accessor to detect "was this passed". Example of a data member in a contract:
```
[DataMember("AngSalesforceId")]
    public AngSalesforceId parmSalesforceId(AngSalesforceId _salesforceId = salesforceId)
    {
        if (!prmIsDefault(_salesforceId))
        {
            salesforceId = _salesforceId;
        }

        return salesforceId;
    }
```
- All parameters are pass-by-value. Mutating a parameter does NOT affect the caller. **NEVER assign to `this`.**
- `this` is required (or qualified) for instance method calls; cannot qualify class-declaration variables; cannot be used in static methods; cannot qualify static methods (use `ClassName::method()`).
- Extension methods (target = Class / Table / View / Map): extension class is `static` (not `final`), name ends `_Extension`, every method is `public static`, first parameter is the target type — caller does NOT pass it.
- Constants over macros. Use `public const str FOO = 'bar';` at class scope, not `#define.FOO('bar')`. Cross-referenced, scoped, IntelliSense-aware.
- `var` for type-inferred locals when the type is obvious from the right-hand side. Skip when readability suffers.
- Declare variables close to first use, in the smallest scope. The compiler rejects shadowing.
- Always place a space after if and before the instantiating bracket (e.g., if (condition)).
- Private helper methods must do exactly what their name implies and nothing else. Side effects (e.g., calling `Custinvoicetrans_ds.research()`) should happen outside the helper method unless the helper is explicitly named to perform that research.
- X++ automatically initializes variables to their empty defaults (e.g., "", 0, dateNull()). Do not explicitly assign empty values upon declaration.

### Chain of Command (CoC) Authoring

1. **Wrapper signature must match base exactly** — same return type, parameter types, parameter names, `static` modifier if applicable.
2. **NEVER copy default parameter values into the wrapper.**
   - Base: `public void salute(str message = "Hi")`
   - Wrapper: `public void salute(str message)` — no `= "Hi"`
3. **`next` is mandatory** at first-level statement scope. CANNOT live inside `if`, `while`, `for`, `do-while`, CANNOT live after `return`, CANNOT live inside a logical expression. Platform Update 21+: `next` is permitted inside `try` / `catch` / `finally`.
4. **`next` cannot be conditionally bypassed for ordinary methods.** The compiler enforces this — there is no legal way to skip `next` in a non-replaceable wrapper. The chain may only be broken in `[Replaceable]` methods, and even there only when the design explicitly requires it.
5. Cannot wrap **constructors**. New parameterless methods on an extension class become the extension's own constructor (must be `public`, no args).
6. **Form-nested wrapping** (`formdatasourcestr`, `formdatafieldstr`, `formControlStr`) can only wrap methods that already exist on the base concept. Cannot add new methods this way.
7. `[Hookable(false)]` blocks CoC AND pre/post handlers. `[Wrappable(false)]` blocks CoC but allows pre/post handlers. `final` methods need `[Wrappable(true)]` to be wrappable.
8. Wrappers may read/call **protected** members of the augmented class. They CANNOT reach `private` members.

Extension class shape:

```
[ExtensionOf(classStr|tableStr|formStr|formDataSourceStr|formDataFieldStr|formControlStr(Target))]
final class <Target><Prefix>_Extension
{
    // wrappers here
}
```

### Event Handlers

Used ONLY when CoC is impossible (see Customization Strategy).

- **Standard data events** use `[DataEventHandler(tableStr(T), DataEventType::Inserted)]` — NOT `SubscribesTo + delegateStr`.
- **Custom delegates** use `[SubscribesTo(classStr(C), delegateStr(C, myDelegate))]`.
- Treat events as broadcast — no call-order guarantees.
- Cast event args to specific types BEFORE consuming event data.
- Keep handlers isolated, deterministic, and testable.

### Delegates

- Delegate return type is `void`.
- Subscriber signature must match the delegate signature exactly.
- Subscriber naming uses `<class>_<delegate>` convention.
- Attribute decoration is mandatory.

### Statements & Types

- `switch` requires explicit `break`. Multiple values into one branch use the **comma list**: `case 13, 17, 21: …; break;` — never empty fall-through.
- Ternary `cond ? a : b`: both branches must have the same type.
- **X++ has NO database null.** Each primitive has a sentinel: `int 0`, `real 0.0`, `str ""`, `date 1900-01-01`, `enum` element value `0`. In SQL `where` these compare false; in plain expressions they compare as values. Write `if (myDate == dateNull())`, NOT `if (myDate == null)`.
- Casting: prefer `as` (returns null on type mismatch) and `is` (boolean test) over hard down-casts. Hard casts on object expressions throw `InvalidCastException`.
- `using` blocks for `IDisposable` resources (Contexts, etc.).
- When calling `selectForUpdate()`, always pass the true parameter (e.g., `buffer.selectForUpdate(true);`) because it is implemented as a parm method under the hood.
- Local functions inside a method can read enclosing-method variables but cannot leak their own variables out.

### Database Queries (`select` / `while select`)

**Statement order (grammar-enforced):**

```
select [FindOption…] [FieldList from] tableBuffer [index…] [order by / group by] [where …] [join … [where …]]
```

**FindOption placement:**
- `crossCompany` belongs on the **OUTER** select (driving buffer), NEVER on a joined buffer. Optional company filter: `select crossCompany : myContainer custTable …` where `myContainer` is a `container` of company codes.
- `forUpdate` may target a specific buffer in a join; other find options stay on the outer select.

**The `in` operator:**
- Grammar: `where Expression in List` where List = X++ `container`.
- Works with **any primitive type** that fits in a container (`str`, `int`, `int64`, `real`, `enum`, `boolean`, `date`, `utcDateTime`, `RecId`) — NOT enum-only.
- Does NOT accept `Set`, `List` (collection class), `Map`, table buffer, or another `select`.
- Empty container = no rows match.
- Only ONE `in` per `where`. For multiple set filters, AND them: `where a in c1 && b in c2`.
- Refactor `field == A || field == B || …` to `field in [A, B, …]`.

**Always:**
- Use a **field list** when you don't need the full row: `select FieldA, FieldB from myTable where …`. Only select the fields you actually need.
- Use **`firstOnly`** when you expect at most one row. Cannot combine with `next`.
- Use **`forUpdate`** before any `.update()` / `.delete()` in the same transaction; pair with `ttsbegin` / `ttscommit`.
- Use **`exists join`** / **`notExists join`** instead of nested `while select` for filter-only joins.
- If a table is joined purely as a "betweener" to reach another table, select ONLY its RecId to save memory (e.g., `join RecId from reasonTableRef`).
- Use **`validTimeState(dateFrom, dateTo)`** on date-effective tables unless you specifically want all history.
- Prefer **set-based** ops: `RecordInsertList`, `insert_recordset`, `update_recordset`, `delete_from`.


❌ WRONG: Slow row-by-row update (generates a separate database call for every single row)
```
SalesLine salesLine;

ttsbegin;

while select forUpdate salesLine
    where salesLine.SalesStatus    == SalesStatus::Invoiced
       && salesLine.AngIsProcessed == NoYes::No
{
    salesLine.AngIsProcessed = NoYes::Yes;
    salesLine.update();
}

ttscommit;
```

✅ CORRECT: Fast set-based update (generates a single SQL update statement)
```
SalesLine salesLine;

// Bypasses the overridden update() method on the table to ensure a pure, fast SQL execution
salesLine.skipDataMethods(true); 

ttsbegin;

update_recordset salesLine
    setting AngIsProcessed = NoYes::Yes
    where salesLine.SalesStatus    == SalesStatus::Invoiced
       && salesLine.AngIsProcessed == NoYes::No;

ttscommit;
```

**Never:**
- **Nested `while select`** — use `join` or pre-load to `Map` / temp table.
- **Function calls in `where`** — assign to a local variable first.
- **`forceLiterals`** — SQL injection risk. Use `forcePlaceholders` (default) or `executeQueryWithParameters` for dynamic queries.
- **`doInsert`** / **`doUpdate`** / **`doDelete`** for normal business logic — they bypass overridden table methods, framework validation, and event handlers. Exception: You MAY use doUpdate() when you are only updating your own isolated custom field and explicitly do not want to trigger the heavy standard update() logic for the entire record.
- **`today()`** — use `DateTimeUtil::getToday(DateTimeUtil::getUserPreferredTimeZone())`.
- **Hardcoded user-facing strings** in `info()` / `warning()` / `error()` / `Box::*` — use `@ModelLabelFile:LabelId`.

**Aggregates:**
- `sum`, `avg`, `count` work only on integer/real fields.
- When `sum` would return null (no matching rows), X++ returns NO row — guard with `if (buffer)` after the select.
- Non-aggregated fields in the select list must appear in `group by`.

**Joins:**
- Only LEFT outer exists (no RIGHT, no `left` keyword). Default values fill non-matching rows — check the joined buffer's `RecId` to distinguish "no match" from "real zero".
- Join criteria use `where`, not `on` (X++ has no `on`).

**Other:**
- `index hint` requires `myTable.allowIndexHint(true)` BEFORE the select. `index` (without `hint`) = sort-only request.
- SQL timeout: 30 min interactive, 3 h batch. Override with `queryTimeout`. Catch `Exception::Timeout` for long-runners.

---

## Implementation Standards by Artifact

### Naming and Conventions

1. Variable names: meaningful, **camelCase**. Example: CustPackingSlipJour custPackingSlipJour;
2. Static variables and constants: **PascalCase**. 
3. Method parameters start with underscore: `_custAccount`.
4. Methods: camelCase, except approved static / delegate patterns. Example of a properly written method:
```
/// <summary>
///     Validates whether a posted packing slip's customer is configured to receive
///      despatch advice.
/// </summary>
/// <param name = "_custPackingSlipJour">
///     The posted packing slip to validate.
/// </param>
/// <returns>
///     True if the customer has the EDI flag enabled; otherwise false.
/// </returns>
private boolean validateSendDespatchAdviceConditions(CustPackingSlipJour _custPackingSlipJour)
{
    boolean   isValid   = false;
    CustTable custTable = CustTable::find(_custPackingSlipJour.OrderAccount);

    if (custTable.AngSendXmlAdvice == NoYes::Yes)
    {
        isValid = true;
    }
    else
    {
        warning(strFmt("@Ang:SendDespatchAdviceValidationFailedCustomerFlag", _custPackingSlipJour.PackingSlipId, custTable.AccountNum));
    }

    return isValid;
}
```
5. New artifacts use the project prefix.
6. Extensions:
   - **Class augmentation:** `<Prefix><Target>_Extension`. NEVER bare `<Target>_Extension` — too high a collision risk per Microsoft Learn. Example of a properly named class: `AngSalesPackingSlipJournalPost_Extension`
   - **Metadata extension** (table / form / view / EDT / enum extension): `<Target>.Extension<Prefix>`, example of a properly named extension table: `SalesTable.ExtensionAng`
7. Use idiomatic method names: `check…`, `exist`, `find`, `validate…`, `parm…`, `initParm…`.

### Tables

1. New table names use the project prefix. Example of a properly named new table: `AngRecordsToExport`
2. Extended elements (fields / indexes / relations / field groups) use the project prefix.
3. Define a proper primary index and a clustered index.
4. Use **EDTs / enums** instead of primitive field types whenever practical.
5. Relation names clearly include the related table intent.
6. Implement standard static methods for lookup patterns where applicable: `checkExist`, `exist`, `find`.
7. For non-temporary tables, ensure a data movement strategy via a data entity.

### Forms

1. New forms use the project prefix.
2. Form extensions follow the metadata-extension naming above.
3. Confirm correct View / Edit default state.
4. Mandatory indication consistent at metadata AND behavior levels.
5. Maintain usable FastTabs / grids / action pane organization.
6. Use modern recommended form patterns for the scenario.
7. In form extensions, use `this.` instead of `element.` when referencing form scope (the base form code uses this).
8. If relevant On a form button, ensure you populate the `DataSource` property so the framework natively knows where to pull the context data from.
9. Remember that when saving a parent header table (e.g., SalesTable), validateWrite fires on the parent, but for the child data source (e.g., SalesLine), it only fires on the specific record where the cursor is currently focused and edited.

### Data Entities

1. New entities use the project prefix and generally include `Entity` suffix. An example of a properly named entity extension: `SalesOrderHeaderV4Entity.ExtensionAng`
2. Public contract is consistent across OData and import / export use.
3. Entity interaction is simple and natural-key friendly.
4. Avoid project prefixes in data entity FIELD names.
5. When extending an entity with a new field, do NOT place the configuration key on the entity extension field itself. Place it on the staging table field instead.

### Configuration and Legal Entity Control

1. Each project / go-live scope uses a dedicated configuration key strategy.
2. Define a legal-entity-level enable / disable parameter for each customization.
3. Apply stable naming for toggle parameters and related field groups.
4. Enablement logic is explicit and testable.

### Labels and Security

**Labels:**
1. Keep labels in label files.
2. Label file ID aligns with model name.
3. Label IDs describe **meaning**, not the model: ✅ `CustomerName` ❌ `MyModelCustomerName`.
4. When adding a field whose EDT already has a label, do **NOT** set a label on the field — it inherits from the EDT. Set a field label only when deliberately overriding.
5. NEVER reference a label in code before creating it in the label file.
6. NEVER use hardcoded user-facing strings in `info()` / `warning()` / `error()` — use `@ModelLabelFile:LabelId`.

**Security:**
1. New security objects use the project prefix.
2. Access to new menu items and entities is controlled via privileges.
3. D365FO security has four access levels: **Read**, **Update**, **Create**, **Delete**. Anegis convention:
   - **Maintain** privilege — grants Delete (full management).
   - **View** privilege — grants Read (read-only).
4. Wire privileges into a duty, then a duty into a role. Never directly attach privileges to roles.
5. Action Menu Items: Create a single privilege granting Delete access (which automatically spans the 4x CRUD). A separate View privilege is not necessary for an action.

### Number Sequences (placeholder — expand with code examples)

1. Reference all sequences from `NumberSeqApplicationModule` or its descendant.
2. Register new sequences via the `NumberSeqApplicationModule_<Module>` extension.
3. Resolve via `NumberSeqReference::findReference()`.
4. Always release the sequence number on form / document cancel.

---

## Documentation and Traceability Templates

### Changleog

Add this static changelog method after the class declaration to every object with xpp code, so classes, views, tables, forms, data entities etc.

```xpp
private static void changeLog()
{
    //++Start: Work item: <WorkItemID> Project: <ProjectName>
   //Developer: <FirstName LastName> Date: <YYYY-MM-DD>
   //<Short summary of change>
   //--End: Work item: <WorkItemID>
    
    exceptionTextFallThrough(); //get rid of BP warning about empty method
}
```

### Method XML Comment Template

Use for public / protected methods.

```xpp
/// <summary>
/// <Business purpose and behavior>.
/// </summary>
/// <param name="_paramName">Meaning of parameter.</param>
/// <returns>Meaning of returned value.</returns>
```

### Legacy Code Modification Block

When modifying older logic, preserve intent history.

```xpp
//Work item: <WorkItemID> Project: <ProjectName>
//Developer: <FirstName LastName> Date: <YYYY-MM-DD>
//<Added or modified code note>
//--End: Work item: <WorkItemID>
```

## Fast Review Checklist

Use for rapid technical review.

1. Any overlayering detected?
2. Any missing work item traceability in changed classes?
3. Any CoC wrapper copying default parameter values into its signature?
4. Any CoC wrapper with `next` not at first-level statement scope?
5. Any event handler used where CoC would have worked?
6. Any method signature / style violating CoC / delegate / event requirements?
7. Any primitive type misuse where EDT / enum is expected?
8. Any table / form / entity naming or extension suffix violations (e.g. bare `<Target>_Extension`)?
9. Any field with a label set when the EDT already has one?
10. Any nested `while select`, used where set-based `update_recordset/insert_recordset` could be used, function call in where, or today() usage?
11. Any `doInsert` / `doUpdate` / `doDelete` outside of when modifying our own extension fields (since then additional update logic is not required) ?
12. Any `crossCompany` on a joined buffer instead of the outer select?
13. Any security privilege gap for new entry points?
14. Any legal-entity enable / disable control missing for scoped customization?
15. Any BP warnings ignored without explicit approval?

---

## Example Prompts

- *Implement work item T06516 for a new table plus data entity using this skill, including changelog and check-in comment draft.*
- *Review my X++ form extension for naming, mandatory field behavior, and action pane compliance using ANG standards.*
- *Decide the precise modification spot for this requirement when using CoC and produce a justified implementation plan.*
- *Generate a pre-check-in quality report for my changes against ANG X++ completion criteria.*

---

## How to Add a New Rule (Maintenance)

This skill is designed to be expanded over time. To add a rule:

1. **Pick the right home.**
   - Language fact (compiler / runtime behavior, MS-documented) → "X++ Language Essentials".
   - Anegis policy (naming, traceability, configuration choices) → "Implementation Standards by Artifact" or "Hard Rules".
   - Approach / mindset → "Meta-Principles".
   - Tool sequence (which MCP tool to call when) → **does NOT belong here**, goes in `copilot-instructions.md` instead.
2. **Keep rules atomic.** One numbered list item = one rule. Easier to review, easier to delete or revise without disturbing surrounding rules.
3. **Code examples are encouraged.** Keep them short, self-contained, and BP-clean.
4. **Update the Fast Review Checklist** if the new rule is something a reviewer should explicitly check.

---
