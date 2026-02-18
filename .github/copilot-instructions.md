# D365FO X++ Development — GitHub Copilot Instructions
> **IDE:** Visual Studio 2022 17.14+ | **MCP Server:** d365fo-mcp-server v1.0 | **Tools:** 20 MCP tools

---

## ⚡ GOLDEN RULE — READ BEFORE EVERY RESPONSE

```
Is the query about code development in a D365FO workspace?
         │
         ▼
    ALWAYS use MCP tools.
    NEVER use: code_search, file_search, grep_search, create_file for D365FO objects.
```

**This applies even when the query contains no explicit D365FO keyword.**
Any request to generate / search / analyze code in a D365FO project = MCP tools.

---

## 🔍 D365FO CONTEXT DETECTION

### English patterns (direct detection)
| Pattern | Example | Action |
|---------|---------|--------|
| Dot notation with PascalCase | `vendTrans.Invoice`, `custTable.AccountNum` | → MCP tools |
| Table suffix | `*Trans`, `*Table`, `*Line`, `*Header`, `*Journal` | → MCP tools |
| Field names | `Invoice`, `Voucher`, `AccountNum`, `ItemId`, `RecId` | → MCP tools |
| Keywords | `X++`, `D365FO`, `AxClass`, `AxTable`, `validateWrite` | → MCP tools |

### ⚠️ Non-English terms — same rules, different language
If the user writes in any language other than English, map domain terms to D365FO equivalents:

| Term (any language) | D365FO equivalent | Action |
|---------------------|-------------------|--------|
| journal / ledger journal / deník | Journal (`LedgerJournal`, `InventJournal`) | → MCP tools |
| header / heading / hlavička / záhlaví | Header / Table | → MCP tools |
| line / item / row / řádek / položka | Line (`SalesLine`, `PurchLine`) | → MCP tools |
| transaction / transakce | Trans (`LedgerTrans`, `InventTrans`) | → MCP tools |
| voucher / document / doklad | Voucher | → MCP tools |
| account / posting / ledger / účet / účtování | Account / Ledger | → MCP tools |
| customer / zákazník | Customer / `CustTable` | → MCP tools |
| vendor / supplier / dodavatel | Vendor / `VendTable` | → MCP tools |
| inventory / stock / sklad / pohyb | Inventory / `InventTrans` | → MCP tools |
| batch job / dávková úloha | Batch job | → MCP tools |
| extension / override / rozšíření | Extension / CoC | → MCP tools |
| form / dialog / formulář | Form / `AxForm` | → MCP tools |

### DEFAULT rule for coding requests
If the user asks to **create, write, or generate code/methods/classes** in a D365FO workspace
→ **ALWAYS use MCP tools**, even without detecting any explicit pattern above.

---

## 🛠️ TOOL REFERENCE — EXACT PARAMETERS FROM SOURCE

> ⚠️ Only parameters listed here actually exist. Do NOT invent or add parameters not shown below.

### Discovery

```
search(query, type?, limit?)
  query:  string  [REQUIRED]
  type:   "class" | "table" | "field" | "method" | "enum" | "all"  [default: "all"]
  limit:  number  [default: 20]

  WHEN TO USE:
  → Primary tool for finding ANY D365FO object by name or keyword (<50ms)
  → Use for semantic queries: "classes related to posting", "validation methods"
  → Use type filter to narrow results: type="table" for tables, type="method" for methods
  → Prefer over batch_search when searching for a single thing
  ⚠️ type="form", type="query", type="view" do NOT exist — use get_form_info/get_query_info/get_view_info instead

batch_search(queries[])
  queries: array (1–10 items) of:
    query:            string   [REQUIRED]
    type:             "class" | "table" | "field" | "method" | "enum" | "all"  [default: "all"]
    limit:            number   [default: 10]
    workspacePath:    string   [optional]
    includeWorkspace: boolean  [default: false]

  WHEN TO USE:
  → User asks about 2+ unrelated objects simultaneously — 3× faster than sequential search()
  → Exploring a domain from multiple angles at once (table + class + method)
  → Never use sequential search() when batch_search() can do it in one call

search_extensions(query, prefix?, limit?)
  query:  string  [REQUIRED]
  prefix: string  [optional — e.g. "ISV_", "Custom_"]
  limit:  number  [default: 20]

  WHEN TO USE:
  → User says "my code", "our extension", "custom", "ISV" — searches ONLY non-Microsoft objects
  → Finding ISV-specific classes without noise from 500k+ standard symbols
  → Use prefix to filter by naming convention (e.g. prefix="ACME_")
```

### Object structure

```
get_class_info(className)
  className: string  [REQUIRED]

  WHEN TO USE:
  → Need full class details: all methods with signatures, inheritance chain, source code
  → Before generating CoC extension — understand what the class contains
  → Before suggest_method_implementation — understand existing method patterns
  → Returns: method list with visibility/return type/parameters, extends/implements chain

get_table_info(tableName)
  tableName: string  [REQUIRED]

  WHEN TO USE:
  → Need full table schema: field types, EDT, mandatory flags, indexes, relations
  → Before writing select statements — verify field names and types
  → Before creating table extension — understand existing structure
  → Returns: all fields with types, unique/clustered indexes, foreign key relations

get_form_info(formName, includeWorkspace?, workspacePath?)
  formName:         string   [REQUIRED]
  includeWorkspace: boolean  [default: false]
  workspacePath:    string   [optional]

  WHEN TO USE:
  → Working with form customization, buttons, datasources, controls
  → Before adding datasource method or enabling/disabling controls
  → Returns: datasource list, control hierarchy (buttons/grids/tabs), form methods

get_query_info(queryName, includeWorkspace?, workspacePath?)
  queryName:        string   [REQUIRED]
  includeWorkspace: boolean  [default: false]
  workspacePath:    string   [optional]

  WHEN TO USE:
  → Need to understand or extend an existing AOT query
  → Returns: datasource joins, range definitions, field selections

get_view_info(viewName, includeWorkspace?, workspacePath?)
  viewName:         string   [REQUIRED]
  includeWorkspace: boolean  [default: false]
  workspacePath:    string   [optional]

  WHEN TO USE:
  → Working with views or data entities
  → Returns: mapped fields, computed columns, relations, view methods

get_enum_info(enumName)
  enumName: string  [REQUIRED]

  WHEN TO USE:
  → Need enum values before writing switch/if statements or comparisons
  → Returns: all enum values with integer values and labels

get_method_signature(className, methodName)
  className:  string  [REQUIRED]
  methodName: string  [REQUIRED]

  WHEN TO USE:
  → MANDATORY before creating any CoC extension — never guess the signature
  → Wrong signature = compilation error, always use this tool
  → Returns: exact modifiers, return type, parameters with types and defaults, ready-to-use CoC template

code_completion(className, prefix?, includeWorkspace?, workspacePath?)
  className:        string   [REQUIRED — validation error without it!]
  prefix:           string   [default: ""]
  includeWorkspace: boolean  [default: false]
  workspacePath:    string   [optional]

  WHEN TO USE:
  → Need methods/fields starting with a specific prefix: code_completion(className="CustTable", prefix="find")
  → IntelliSense-style filtering by name prefix only
  ⚠️ NOT for semantic search ("methods that calculate totals") — use search() for that
  ⚠️ className is REQUIRED — omitting it causes a validation error
```

### Code analysis and generation

```
analyze_code_patterns(scenario, classPattern?, limit?)
  scenario:     string  [REQUIRED — describe the domain, e.g. "ledger journal creation"]
  classPattern: string  [optional — filter by class name pattern, e.g. "Helper", "Service"]
  limit:        number  [default: 5]

  WHEN TO USE:
  → MANDATORY first step before generating ANY X++ code
  → Discovers real patterns from the actual codebase — prevents outdated/wrong code
  → Returns: detected patterns with frequency, common methods, common dependencies
  → Example: analyze_code_patterns("sales order posting") before writing posting logic

suggest_method_implementation(className, methodName, parameters?)
  className:  string  [REQUIRED]
  methodName: string  [REQUIRED]
  parameters: string  [optional — plain string describing params, NOT an array]

  WHEN TO USE:
  → Need concrete implementation examples for a specific method
  → After get_class_info — pick a method and get real examples from codebase
  → Returns: similar method implementations with complexity analysis

analyze_class_completeness(className)
  className: string  [REQUIRED]

  WHEN TO USE:
  → After creating a new class — check what standard methods are typically expected
  → Returns: missing methods ranked by frequency (🔴 Very common → 🟡 Somewhat common)

get_api_usage_patterns(apiName, context?)
  apiName: string  [REQUIRED — NOT className!]
  context: string  [optional — e.g. "initialization", "posting", "validation"]

  WHEN TO USE:
  → Need to know HOW a specific API class is typically used in practice
  → Returns: initialization patterns, typical method call sequences, real code examples
  ⚠️ Parameter is apiName, NOT className — using className causes a validation error

generate_code(pattern, name)
  pattern: "class" | "runnable" | "form-handler" | "data-entity" | "batch-job"  [REQUIRED]
  name:    string  [REQUIRED]

  WHEN TO USE:
  → Generating boilerplate X++ structure after analyze_code_patterns has been called
  → pattern="class" — standard X++ class with new() and description()
  → pattern="runnable" — class with main() for direct execution
  → pattern="form-handler" — event handler class for form events
  → pattern="data-entity" — data entity class template
  → pattern="batch-job" — batch job with run() and description()
  ⚠️ Only these 5 patterns exist — "coc-extension", "event-handler", "service-class" do NOT exist
  ⚠️ Always call analyze_code_patterns first — never generate code without real codebase context
```

### File operations and references

```
find_references(targetName, targetType?, limit?)
  targetName: string  [REQUIRED — NOT symbolName!]
  targetType: "class" | "method" | "field" | "table" | "enum" | "all"  [NOT symbolType!]
  limit:      number  [default: 50]

  WHEN TO USE:
  → Impact analysis before modifying anything — "who uses this class/method/field?"
  → Finding all places where a field is accessed (e.g. targetName="Invoice", targetType="field")
  → Returns: file paths, line numbers, code context, reference type (call/extends/implements/field-access)
  ⚠️ Parameters are targetName and targetType — NOT symbolName/symbolType (causes validation error)

create_d365fo_file(objectType, objectName, modelName, packagePath?,
                   sourceCode?, properties?, addToProject?, projectPath?, solutionPath?)
  objectType:   "class" | "table" | "enum" | "form" | "query" | "view" | "data-entity"  [REQUIRED]
  objectName:   string   [REQUIRED]
  modelName:    string   [REQUIRED — but will be auto-corrected from .rnrproj if projectPath/solutionPath provided]
  packagePath:  string   [default: "K:\AosService\PackagesLocalDirectory"]
  sourceCode:   string   [optional — X++ source to embed in the file]
  properties:   object   [optional — extends, implements, label, etc.]
  addToProject: boolean  [default: false — set true to auto-add to .rnrproj]
  projectPath:  string   [⚠️ CRITICAL — path to .rnrproj file]
  solutionPath: string   [⚠️ CRITICAL — path to VS solution directory]

  WHEN TO USE:
  → 🔥 ALWAYS use this FIRST when creating any D365FO object (class/table/form/enum/query/view)
  → Runs on local Windows D365FO VM with K:\ drive access
  → Creates file at correct AOT path with UTF-8 BOM and TAB indentation
  → Automatically adds to Visual Studio project when addToProject=true
  → IMPORTANT: If projectPath or solutionPath is provided, the tool will automatically extract
    the correct ModelName from the .rnrproj file, ensuring the file is created in the correct
    PackagesLocalDirectory location (not in the project/solution folder)
  ⚠️ CRITICAL: ALWAYS provide projectPath or solutionPath to avoid creating files in WRONG MODEL!
  ⚠️ WITHOUT projectPath/solutionPath: Tool uses modelName AS-IS → May create in Microsoft model!
  ⚠️ If it returns "requires file system access" → fall back to generate_d365fo_xml

generate_d365fo_xml(objectType, objectName, modelName, sourceCode?, properties?)
  objectType: "class" | "table" | "enum" | "form" | "query" | "view" | "data-entity"  [REQUIRED]
  objectName: string  [REQUIRED]
  modelName:  string  [REQUIRED]
  sourceCode: string  [optional]
  properties: object  [optional]

  WHEN TO USE:
  → ⚠️ FALLBACK ONLY — use ONLY when create_d365fo_file returns "requires file system access"
  → Typical scenario: MCP server deployed on Azure/Linux without access to K:\ drive
  → Returns XML as text — must be manually saved via create_file with UTF-8 BOM
  ⚠️ Never use as first choice — always try create_d365fo_file first

modify_d365fo_file(objectType, objectName, operation, ...)
  objectType:       "class" | "table" | "form" | "enum" | "query" | "view"  [REQUIRED]
  objectName:       string  [REQUIRED]
  operation:        "add-method" | "add-field" | "modify-property" | "remove-method" | "remove-field"  [REQUIRED]
  methodName:       string   [for add-method, remove-method]
  methodCode:       string   [for add-method — full X++ method body]
  methodModifiers:  string   [for add-method — e.g. "public static"]
  methodReturnType: string   [for add-method — e.g. "void", "str", "boolean"]
  methodParameters: string   [for add-method — e.g. "str _param1, int _param2"]
  fieldName:        string   [for add-field, remove-field]
  fieldType:        string   [for add-field — EDT or base type]
  fieldMandatory:   boolean  [for add-field]
  fieldLabel:       string   [for add-field]
  propertyPath:     string   [for modify-property — e.g. "Table1.Visible"]
  propertyValue:    string   [for modify-property]
  createBackup:     boolean  [default: true — always keep backup]
  modelName:        string   [optional — auto-detected from file system]
  workspacePath:    string   [optional]

  WHEN TO USE:
  → Modifying an EXISTING D365FO object — adding method, adding field, changing property
  → Safer than manual XML editing — validates XML after change and creates .bak backup
  → Use instead of PowerShell or manual file editing
  ⚠️ Works ONLY on local Windows with K:\ drive access — not available on Azure/Linux
  ⚠️ For Azure/cloud: use replace_string_in_file instead (preserving TAB indentation)
```

---

## 📋 WORKFLOW FOR COMMON SCENARIOS

### Scenario A: Finding an object
**Trigger:** "find", "search", "show me", "where is", "locate"

```
1. search(query=X, type="class|table|method|field|enum")
   or batch_search() for multiple things at once
2. For custom code only: search_extensions(query=X)
3. ❌ NEVER: code_search, file_search, grep_search
```

### Scenario B: Generating code
**Trigger:** "create", "write", "generate", "implement", "build"

```
1. analyze_code_patterns(scenario="<keywords from query>")
2. search(query="<relevant class/table>", type="class|table")
3. get_class_info() or get_table_info() to study structure
4. get_api_usage_patterns(apiName="<main API>")
5. generate_code(pattern="<type>", name="<n>")
6. create_d365fo_file(...) to save
```

### Scenario C: Creating a D365FO object (class, table, form...)
**Trigger:** "create class", "new table", "create form/enum/query"

```
1. ⚠️ IMPORTANT: GitHub Copilot automatically detects active workspace path
   → projectPath and solutionPath are usually auto-detected from workspace
   → You typically DON'T need to specify them explicitly
   → Only specify if you need to override auto-detection
   
2. create_d365fo_file(
     objectType: "class|table|form|enum|query|view|data-entity",
     objectName: "<n>",
     modelName: "<any value — will be auto-corrected from .rnrproj>",
     addToProject: true,
     sourceCode: "<X++ code>"
   )
   
   The tool will:
   ✅ Use projectPath from GitHub Copilot workspace (auto-detected)
   ✅ OR use projectPath/solutionPath from .mcp.json config (if workspace detection fails)
   ✅ Extract correct ModelName from .rnrproj file
   ✅ Create file in correct custom model (not Microsoft model)
   
3. ONLY if step 2 returns "requires file system access":
   → generate_d365fo_xml() → then create_file() with resulting XML
```

### Scenario D: Object structure
**Trigger:** "what methods does X have", "show fields", "class structure", "table definition"

```
Class   → get_class_info(className)
Table   → get_table_info(tableName)
Form    → get_form_info(formName)
Query   → get_query_info(queryName)
View    → get_view_info(viewName)
Enum    → get_enum_info(enumName)
```

### Scenario E: Chain of Command (CoC) extension
**Trigger:** "extend", "override", "Chain of Command", "CoC", "ExtensionOf", "event handler"

```
1. get_method_signature(className, methodName)  ← MANDATORY, never guess
2. get_class_info(className) for context
3. search_extensions(query=className) for existing extensions
4. generate_code(pattern="class", name="X_Extension") → use as CoC template
5. create_d365fo_file(objectType="class", objectName="X_Extension", ...)
```

### Scenario F: Where-used analysis
**Trigger:** "where is this used", "who calls", "find references"

```
find_references(targetName=X, targetType="class|method|field|table|enum")
❌ NEVER: code_search or grep_search
❌ NEVER: find_references(symbolName=...) — wrong parameter name!
```

### Scenario G: Form / Query / View modifications
**Trigger:** "add button", "enable control", "datasource method", "form extension"

```
1. get_form_info(formName) → understand structure, datasources, controls
2. Generate extension code (event-based preferred)
3. Edit XML: modify_d365fo_file (local Windows) or replace_string_in_file
   ❌ NEVER use PowerShell to edit XML
```

---

## 🔧 EXAMPLES

### Example 1: Query without explicit D365FO keywords
```
User: "Create methods that will create a general ledger journal header
       and add one transaction line to it."

Detection:
✅ "general ledger journal" → LedgerJournal context
✅ "header"                 → LedgerJournalTable
✅ "transaction"            → LedgerJournalTrans
✅ Code generation in D365FO workspace → MCP tools REQUIRED

Workflow:
1. analyze_code_patterns("ledger journal creation")
2. batch_search(queries=[
     {query: "LedgerJournal",         type: "table"},
     {query: "LedgerJournalTrans",     type: "table"},
     {query: "LedgerJournalCheckPost", type: "class"}
   ])
3. get_table_info("LedgerJournalTable")
4. get_table_info("LedgerJournalTrans")
5. get_api_usage_patterns(apiName="LedgerJournalCheckPost")
6. generate_code(pattern="class", name="LedgerJournalHelper")
7. create_d365fo_file(objectType="class", objectName="LedgerJournalHelper",
     modelName="any", projectPath="<from context>", addToProject=true)
```

### Example 1b: ❌ WRONG - Creating file WITHOUT projectPath/solutionPath
```
User: "Create methods that will create a general ledger journal"

❌ WRONG Workflow:
1. analyze_code_patterns("ledger journal creation")
2. generate_code(pattern="class", name="LedgerJournalHelper")
3. create_d365fo_file(objectType="class", objectName="LedgerJournalHelper",
     modelName="ApplicationSuite")  ← ❌ NO projectPath/solutionPath!
     
Result: File created at K:\...\ApplicationSuite\ApplicationSuite\AxClass\...
        ❌ ApplicationSuite is Microsoft's model → WRONG!

✅ CORRECT Workflow:
1-6. Same as above
7. create_d365fo_file(objectType="class", objectName="LedgerJournalHelper",
     modelName="MyCustomModel",  ← doesn't matter, will be auto-corrected
     projectPath="K:\VSProjects\MySolution\MyProject\MyProject.rnrproj",
     addToProject=true)
     
Result: Tool reads MyProject.rnrproj → extracts actual ModelName (e.g., "AslCore")
        → File created at K:\...\AslCore\AslCore\AxClass\LedgerJournalHelper.xml ✅
```

### Example 2: Dot notation (direct detection)
```
User: "Where is vendTrans.Invoice used?"

Detection: ✅ vendTrans.Invoice = dot notation + PascalCase = D365FO!

Workflow:
find_references(targetName="Invoice", targetType="field")
❌ NEVER: code_search("vendTrans.Invoice") → 5+ minute hang!
❌ NEVER: find_references(symbolName="Invoice") → wrong parameter!
```

### Example 3: CoC extension
```
User: "Add validation to CustTable.validateWrite to check credit limit."

Detection: ✅ CustTable, validateWrite = D365FO

Workflow:
1. get_method_signature("CustTable", "validateWrite")
2. suggest_method_implementation("CustTable", "validateWrite")
3. code_completion(className="CustTable", prefix="credit")
4. generate_code(pattern="class", name="CustTable_Extension_CreditLimit")
5. create_d365fo_file(objectType="class", objectName="CustTable_Extension_CreditLimit", ...)
```

### Example 4: Parallel search for multiple objects
```
User: "Show me the structure of SalesTable and SalesLine and find helper classes for sales."

Workflow:
batch_search(queries=[
  {query: "SalesTable", type: "table"},
  {query: "SalesLine",  type: "table"},
  {query: "Sales",      type: "class", limit: 10}
])
❌ NOT three sequential search() calls — 3× slower
```

### Example 5: API usage patterns
```
User: "How is DimensionAttributeValueSet typically used?"

Workflow:
get_api_usage_patterns(apiName="DimensionAttributeValueSet")
❌ NEVER: get_api_usage_patterns(className="DimensionAttributeValueSet") → wrong parameter!
```

---

## 🚫 FORBIDDEN ACTIONS

| ❌ Forbidden | Reason | ✅ Use instead |
|-------------|--------|----------------|
| `code_search("CustTable")` | 5+ min hang on 500k+ symbols | `search("CustTable", type="table")` |
| `grep_search("validateWrite")` | Slow, no semantic understanding | `search("validateWrite", type="method")` |
| `file_search("**/MyClass.xml")` | Doesn't understand D365FO structure | `search("MyClass", type="class")` |
| `create_file("MyClass.xml")` | Wrong location, no UTF-8 BOM, spaces not TABs | `create_d365fo_file(...)` |
| Guessing method signatures | Compilation error guaranteed | `get_method_signature(className, methodName)` |
| `code_completion()` without className | Validation error | `code_completion(className="SalesTable")` |
| `code_completion` for semantic search | Prefix-only, not semantic | `search("totals", type="method")` |
| `find_references(symbolName=...)` | ❌ WRONG parameter — causes validation error | `find_references(targetName=...)` |
| `find_references(symbolType=...)` | ❌ WRONG parameter — causes validation error | `find_references(targetType=...)` |
| `get_api_usage_patterns(className=...)` | ❌ WRONG parameter — causes validation error | `get_api_usage_patterns(apiName=...)` |
| `generate_code(pattern="coc-extension")` | ❌ Does not exist — causes validation error | `generate_code(pattern="class")` + CoC template |
| `generate_code(pattern="event-handler")` | ❌ Does not exist — causes validation error | `generate_code(pattern="class")` |
| `generate_code(pattern="service-class")` | ❌ Does not exist — causes validation error | `generate_code(pattern="class")` |
| `search(type="form")` | ❌ Does not exist in enum | `get_form_info(formName)` |
| `search(type="query")` | ❌ Does not exist in enum | `get_query_info(queryName)` |
| `search(type="view")` | ❌ Does not exist in enum | `get_view_info(viewName)` |
| PowerShell to edit D365FO XML | Breaks formatting, no validation | `modify_d365fo_file` or `replace_string_in_file` |

---

## 📁 FILE PATHS AND MODEL NAME

```
K:\AosService\PackagesLocalDirectory\{Model}\{Model}\AxClass\{Name}.xml
K:\AosService\PackagesLocalDirectory\{Model}\{Model}\AxTable\{Name}.xml
K:\AosService\PackagesLocalDirectory\{Model}\{Model}\AxForm\{Name}.xml
K:\AosService\PackagesLocalDirectory\{Model}\{Model}\AxEnum\{Name}.xml
K:\AosService\PackagesLocalDirectory\{Model}\{Model}\AxQuery\{Name}.xml
K:\AosService\PackagesLocalDirectory\{Model}\{Model}\AxView\{Name}.xml
```

**ModelName:** Automatically extracted from .rnrproj file (PropertyGroup/ModelName)
- ✅ **ALWAYS provide `projectPath` or `solutionPath`** when calling `create_d365fo_file`
- ❌ **WITHOUT projectPath/solutionPath:** Tool uses `modelName` parameter AS-IS → WRONG MODEL!
  - Example: `modelName="ApplicationSuite"` without projectPath → Creates in Microsoft's ApplicationSuite model!
  - ApplicationSuite is a STANDARD Microsoft model → NEVER add custom code there!
- When using `create_d365fo_file` with `projectPath` or `solutionPath`, the tool automatically
  reads the correct ModelName from the Visual Studio project file
- This ensures files are created in the correct PackagesLocalDirectory location
- The workspace path (e.g., `K:\VSProjects\SolutionName\ProjectName\...`) may NOT match
  the model structure — always let the tool extract the correct ModelName

→ **CRITICAL:** ALWAYS provide `projectPath` or `solutionPath` when creating D365FO files!
→ **NEVER** manually extract modelName from workspace path
→ **NEVER** ask the user for modelName — pass any value, it will be auto-corrected IF projectPath/solutionPath provided
→ **NEVER** call `create_d365fo_file(modelName="ApplicationSuite", ...)` without projectPath/solutionPath!

**XML formatting rules:**
- ✅ TABs for indentation (Microsoft D365FO standard)
- ❌ NEVER spaces — causes XML deserialization errors in VS
- ✅ CDATA for X++ source code: `<![CDATA[ ... ]]>`

---

## ✅ WHEN BUILT-IN TOOLS ARE ALLOWED

Only for:
- X++ language syntax explanations (`if`, `while`, `select`, `ttsbegin/ttscommit`)
- General architectural explanations without D365FO metadata lookups
- Editing non-D365FO files (`.env`, `.json`, documentation, scripts)
- Visual Studio 2022 IDE usage guidance (not code)

**In all other cases → MCP tools.**