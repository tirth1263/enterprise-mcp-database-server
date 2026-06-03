import type {
  AnomalyExplanation,
  ColumnSchema,
  DatabaseEngine,
  GeneratedSql,
  PlanInspection,
  PlanRisk,
  SchemaSnapshot,
  TableSchema
} from "../types";

const piiHints = [
  "email",
  "phone",
  "address",
  "name",
  "token",
  "secret",
  "password",
  "ssn",
  "dob",
  "birth",
  "ip"
];

const numericTypes = ["int", "number", "decimal", "numeric", "float", "double", "bigint", "money"];

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "yes", "1"].includes(value.toLowerCase());
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function objectValue(record: Record<string, unknown>, keys: string[], fallback: unknown = undefined): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return fallback;
}

export function detectPii(name: string, explicit?: unknown): boolean {
  if (explicit !== undefined) return asBoolean(explicit);
  const lower = name.toLowerCase();
  return piiHints.some((hint) => lower.includes(hint));
}

export function normalizeSchemaInput(input: string): TableSchema[] {
  const parsed = JSON.parse(input) as unknown;
  const root = Array.isArray(parsed) ? { tables: parsed } : parsed;

  if (!root || typeof root !== "object") {
    throw new Error("Schema JSON must be an object or an array of tables.");
  }

  const record = root as Record<string, unknown>;
  const tablesInput = record.tables ?? record.Tables ?? record.relations;

  if (Array.isArray(tablesInput)) {
    return tablesInput.map((table, index) => normalizeTable(table, `table_${index + 1}`));
  }

  const tableEntries = Object.entries(record).filter(([, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return true;
  });

  if (tableEntries.length > 0) {
    return tableEntries.map(([name, value]) => {
      const tableRecord = value as Record<string, unknown>;
      if (Array.isArray(tableRecord.columns)) {
        return normalizeTable({ ...tableRecord, name }, name);
      }

      const columns = Object.entries(tableRecord).map(([columnName, type]) => ({
        name: columnName,
        type: typeof type === "string" ? type : "unknown",
        nullable: true,
        indexed: columnName.toLowerCase().endsWith("_id") || columnName.toLowerCase() === "id",
        pii: detectPii(columnName)
      }));

      return {
        name,
        rowEstimate: 0,
        columns
      };
    });
  }

  throw new Error("Schema JSON needs a tables array or a table-name object map.");
}

function normalizeTable(table: unknown, fallbackName: string): TableSchema {
  if (!table || typeof table !== "object") {
    throw new Error("Every table entry must be an object.");
  }

  const record = table as Record<string, unknown>;
  const name = String(objectValue(record, ["name", "table", "tableName"], fallbackName)).trim();
  const columnsInput = objectValue(record, ["columns", "fields"], []);
  const columns = Array.isArray(columnsInput)
    ? columnsInput.map((column, index) => normalizeColumn(column, `column_${index + 1}`))
    : Object.entries((columnsInput ?? {}) as Record<string, unknown>).map(([columnName, type]) =>
        normalizeColumn({ name: columnName, type }, columnName)
      );

  if (!name || columns.length === 0) {
    throw new Error("Every table needs a name and at least one column.");
  }

  return {
    name,
    rowEstimate: asNumber(objectValue(record, ["rowEstimate", "rows", "estimatedRows"], 0)),
    columns
  };
}

function normalizeColumn(column: unknown, fallbackName: string): ColumnSchema {
  if (typeof column === "string") {
    return {
      name: column,
      type: "unknown",
      nullable: true,
      indexed: column.toLowerCase().endsWith("_id") || column.toLowerCase() === "id",
      pii: detectPii(column)
    };
  }

  if (!column || typeof column !== "object") {
    throw new Error("Every column entry must be an object or a string.");
  }

  const record = column as Record<string, unknown>;
  const name = String(objectValue(record, ["name", "column", "columnName"], fallbackName)).trim();

  return {
    name,
    type: String(objectValue(record, ["type", "dataType"], "unknown")),
    nullable: asBoolean(objectValue(record, ["nullable", "isNullable"], true), true),
    indexed: asBoolean(objectValue(record, ["indexed", "isIndexed", "primaryKey"], false)),
    pii: detectPii(name, objectValue(record, ["pii", "sensitive"]))
  };
}

export function countSensitiveColumns(schema: SchemaSnapshot): number {
  return schema.tables.reduce(
    (sum, table) => sum + table.columns.filter((column) => column.pii).length,
    0
  );
}

export function countColumns(schema: SchemaSnapshot): number {
  return schema.tables.reduce((sum, table) => sum + table.columns.length, 0);
}

export function generateOptimizedSql(
  schema: SchemaSnapshot,
  objective: string,
  dialect: DatabaseEngine,
  preferredTable?: string
): GeneratedSql {
  const table =
    schema.tables.find((candidate) => candidate.name === preferredTable) ??
    schema.tables.slice().sort((a, b) => b.rowEstimate - a.rowEstimate)[0];

  if (!table) {
    throw new Error("Select a schema with at least one table before generating SQL.");
  }

  const safeColumns = table.columns.filter((column) => !column.pii);
  const selectedColumns = (safeColumns.length ? safeColumns : table.columns).slice(0, 8);
  const numericColumn = selectedColumns.find((column) =>
    numericTypes.some((type) => column.type.toLowerCase().includes(type))
  );
  const indexedColumn =
    table.columns.find((column) => column.indexed && !column.pii) ??
    table.columns.find((column) => column.indexed) ??
    selectedColumns[0];
  const dateColumn = table.columns.find((column) =>
    /(date|time|created|updated|timestamp)/i.test(`${column.name} ${column.type}`)
  );

  const wantsAggregate = /(count|total|sum|average|avg|trend|anomal|spike|drop|metric)/i.test(objective);
  const wantsRecent = /(recent|latest|last|fresh|new)/i.test(objective);
  const quote = (identifier: string) => quoteIdentifier(identifier, dialect);
  const limit = limitClause(dialect, wantsAggregate ? 100 : 250);
  const whereParts = [
    indexedColumn ? `${quote(indexedColumn.name)} IS NOT NULL` : "",
    wantsRecent && dateColumn ? `${quote(dateColumn.name)} >= ${dateWindowExpression(dialect)}` : ""
  ].filter(Boolean);

  let sql: string;

  if (wantsAggregate && numericColumn) {
    sql = [
      `SELECT`,
      `  ${quote(indexedColumn.name)} AS segment_key,`,
      `  COUNT(*) AS row_count,`,
      `  AVG(${quote(numericColumn.name)}) AS average_${safeAlias(numericColumn.name)},`,
      `  MIN(${quote(numericColumn.name)}) AS minimum_${safeAlias(numericColumn.name)},`,
      `  MAX(${quote(numericColumn.name)}) AS maximum_${safeAlias(numericColumn.name)}`,
      `FROM ${quote(table.name)}`,
      whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
      `GROUP BY ${quote(indexedColumn.name)}`,
      `ORDER BY row_count DESC`,
      limit
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    sql = [
      `SELECT`,
      `  ${selectedColumns.map((column) => quote(column.name)).join(",\n  ")}`,
      `FROM ${quote(table.name)}`,
      whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
      dateColumn ? `ORDER BY ${quote(dateColumn.name)} DESC` : `ORDER BY ${quote(indexedColumn.name)} ASC`,
      limit
    ]
      .filter(Boolean)
      .join("\n");
  }

  const safetyNotes = [
    `Uses ${selectedColumns.filter((column) => !column.pii).length} non-sensitive selected columns.`,
    indexedColumn ? `Anchors filtering or ordering on indexed column ${indexedColumn.name}.` : "No indexed column was available.",
    table.rowEstimate > 100000 ? "Large table: validate the filter with EXPLAIN before production use." : "Table size is within a low-risk review band."
  ];

  return {
    sql,
    safetyNotes,
    estimatedComplexity: table.rowEstimate > 100000 ? "High" : table.rowEstimate > 10000 ? "Medium" : "Low"
  };
}

function quoteIdentifier(identifier: string, dialect: DatabaseEngine): string {
  const escaped = identifier.replaceAll('"', '""').replaceAll("`", "``").replaceAll("]", "]]");
  if (dialect === "MySQL" || dialect === "BigQuery") return `\`${escaped}\``;
  if (dialect === "SQL Server") return `[${escaped}]`;
  return `"${escaped}"`;
}

function limitClause(dialect: DatabaseEngine, rows: number): string {
  if (dialect === "SQL Server") return `OFFSET 0 ROWS FETCH NEXT ${rows} ROWS ONLY`;
  return `LIMIT ${rows}`;
}

function dateWindowExpression(dialect: DatabaseEngine): string {
  if (dialect === "SQL Server") return "DATEADD(day, -30, SYSUTCDATETIME())";
  if (dialect === "MySQL") return "DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)";
  if (dialect === "BigQuery") return "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)";
  if (dialect === "Snowflake") return "DATEADD(day, -30, CURRENT_TIMESTAMP())";
  if (dialect === "SQLite") return "datetime('now', '-30 days')";
  return "NOW() - INTERVAL '30 days'";
}

function safeAlias(value: string): string {
  return value.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
}

export function inspectPlanText(rawPlan: string): PlanInspection {
  const trimmed = rawPlan.trim();
  const risks: PlanRisk[] = [];
  const recommendations = new Set<string>();
  let score = 94;

  if (!trimmed) {
    throw new Error("Paste an execution plan before inspection.");
  }

  const lower = trimmed.toLowerCase();
  const numericValues = [...trimmed.matchAll(/(?:rows|Plan Rows|Actual Rows)[":=\s]+([0-9,]+)/gi)].map((match) =>
    Number(match[1].replaceAll(",", ""))
  );
  const largestRowCount = numericValues.length ? Math.max(...numericValues) : 0;

  if (/(seq scan|table scan|full scan)/i.test(trimmed)) {
    const level = largestRowCount > 50000 ? "High" : "Medium";
    risks.push({
      level,
      title: "Full table scan",
      detail: "The plan includes a sequential or full table scan that can become expensive on growing tables."
    });
    recommendations.add("Add or validate a selective index for the scan predicate.");
    score -= level === "High" ? 28 : 16;
  }

  if (/nested loop/i.test(trimmed) && largestRowCount > 10000) {
    risks.push({
      level: "High",
      title: "Large nested loop",
      detail: "A nested loop appears with high row estimates, which can amplify latency across joins."
    });
    recommendations.add("Check join keys, index both sides, or compare with a hash/merge join plan.");
    score -= 24;
  }

  if (/(sort|filesort)/i.test(trimmed) && largestRowCount > 10000) {
    risks.push({
      level: "Medium",
      title: "Expensive sort",
      detail: "The plan sorts a large intermediate result."
    });
    recommendations.add("Consider a composite index that matches the filter and ordering columns.");
    score -= 12;
  }

  if (/(temp|temporary|spill|disk)/i.test(lower)) {
    risks.push({
      level: "Medium",
      title: "Temporary storage pressure",
      detail: "The plan references temporary storage or disk spill behavior."
    });
    recommendations.add("Reduce selected columns, pre-filter earlier, or raise work memory only after query tuning.");
    score -= 10;
  }

  if (/cross join/i.test(trimmed)) {
    risks.push({
      level: "High",
      title: "Cross join",
      detail: "A cross join can multiply rows unexpectedly."
    });
    recommendations.add("Confirm join predicates and expected cardinality before running against production data.");
    score -= 22;
  }

  if (risks.length === 0) {
    recommendations.add("Keep the plan with the saved query so regressions are easier to compare later.");
    recommendations.add("Run the same plan after major data growth or index changes.");
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const summary =
    risks.length === 0
      ? "No major plan risks were detected from the supplied plan text."
      : `${risks.length} plan risk${risks.length === 1 ? "" : "s"} detected; review the highest severity item before production use.`;

  return {
    score: boundedScore,
    summary,
    risks,
    recommendations: [...recommendations]
  };
}

export function explainAnomaly(
  metric: string,
  expected: number,
  observed: number,
  timeframe: string,
  notes: string
): AnomalyExplanation {
  if (!Number.isFinite(expected) || !Number.isFinite(observed)) {
    throw new Error("Expected and observed values must be valid numbers.");
  }

  const baseline = expected === 0 ? 1 : Math.abs(expected);
  const deltaPercent = Number((((observed - expected) / baseline) * 100).toFixed(2));
  const direction = observed >= expected ? "above" : "below";
  const magnitude = Math.abs(deltaPercent);

  const likelyCauses = new Set<string>();
  const nextChecks = new Set<string>();

  if (magnitude > 50) {
    likelyCauses.add("Recent deployment, ingestion change, or upstream event shifted the metric sharply.");
    nextChecks.add("Compare the metric against deployment, import, and incident timestamps.");
  }

  if (/null|missing|blank/i.test(notes)) {
    likelyCauses.add("Null or missing values may be changing aggregate behavior.");
    nextChecks.add("Group by null-state and compare affected row counts.");
  }

  if (/join|duplicate|dedupe|double/i.test(notes)) {
    likelyCauses.add("Join cardinality or duplicate records may be inflating the metric.");
    nextChecks.add("Check primary keys, join predicates, and duplicate counts in the source table.");
  }

  if (/delay|late|lag|batch/i.test(notes)) {
    likelyCauses.add("Late arriving data or delayed batch processing may explain the difference.");
    nextChecks.add("Compare ingestion lag and source freshness for the selected timeframe.");
  }

  likelyCauses.add("Segment mix changed between the expected baseline and observed window.");
  nextChecks.add("Break the metric down by the highest-cardinality indexed dimension.");
  nextChecks.add("Review the saved schema for newly sensitive columns before exposing examples.");

  return {
    deltaPercent,
    explanation: `${metric} is ${Math.abs(deltaPercent).toFixed(2)}% ${direction} expected for ${timeframe}.`,
    likelyCauses: [...likelyCauses],
    nextChecks: [...nextChecks]
  };
}
