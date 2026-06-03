import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type DatabaseEngine = "PostgreSQL" | "MySQL" | "SQL Server" | "BigQuery" | "Snowflake" | "SQLite";

type ColumnSchema = {
  name: string;
  type: string;
  nullable: boolean;
  indexed: boolean;
  pii: boolean;
};

type TableSchema = {
  name: string;
  rowEstimate: number;
  columns: ColumnSchema[];
};

type SchemaSnapshot = {
  id: string;
  connectorId: string;
  databaseName: string;
  schemaName: string;
  description?: string;
  tables: TableSchema[];
};

const projectId = process.env.FIREBASE_PROJECT_ID ?? "enterprise-mcp-database-server";
const defaultUserId = process.env.MCP_FIREBASE_USER_ID;

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId
  });
}

const db = getFirestore();
const server = new McpServer({
  name: "enterprise-mcp-database-server",
  version: "1.0.0"
});

server.tool(
  "list_connectors",
  "List saved database connector metadata for one Firebase user.",
  {
    userId: z.string().optional()
  },
  async ({ userId }) => {
    const uid = resolveUserId(userId);
    const snapshot = await db.collection("users").doc(uid).collection("connectors").get();
    const connectors = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        engine: data.engine,
        environment: data.environment,
        maskPolicy: data.maskPolicy,
        status: data.status,
        hostFingerprint: data.hostFingerprint
      };
    });

    return textResponse(connectors);
  }
);

server.tool(
  "read_schema",
  "Read saved schema metadata. This returns column definitions and PII flags, never row values.",
  {
    userId: z.string().optional(),
    schemaId: z.string().optional()
  },
  async ({ userId, schemaId }) => {
    const uid = resolveUserId(userId);
    if (schemaId) {
      const doc = await db.collection("users").doc(uid).collection("schemas").doc(schemaId).get();
      if (!doc.exists) throw new Error(`Schema ${schemaId} was not found.`);
      return textResponse(sanitizeSchema({ id: doc.id, ...doc.data() } as SchemaSnapshot));
    }

    const snapshot = await db.collection("users").doc(uid).collection("schemas").get();
    return textResponse(snapshot.docs.map((doc) => sanitizeSchema({ id: doc.id, ...doc.data() } as SchemaSnapshot)));
  }
);

server.tool(
  "generate_optimized_sql",
  "Generate a privacy-aware SQL draft from a saved schema and natural-language objective.",
  {
    userId: z.string().optional(),
    schemaId: z.string(),
    objective: z.string(),
    dialect: z.enum(["PostgreSQL", "MySQL", "SQL Server", "BigQuery", "Snowflake", "SQLite"]).optional(),
    tableName: z.string().optional()
  },
  async ({ userId, schemaId, objective, dialect, tableName }) => {
    const uid = resolveUserId(userId);
    const schemaDoc = await db.collection("users").doc(uid).collection("schemas").doc(schemaId).get();
    if (!schemaDoc.exists) throw new Error(`Schema ${schemaId} was not found.`);
    const schema = { id: schemaDoc.id, ...schemaDoc.data() } as SchemaSnapshot;
    return textResponse(generateSql(schema, objective, dialect ?? "PostgreSQL", tableName));
  }
);

server.tool(
  "inspect_execution_plan",
  "Inspect an execution plan for risky scans, joins, sorts, and spill behavior.",
  {
    rawPlan: z.string()
  },
  async ({ rawPlan }) => textResponse(inspectPlan(rawPlan))
);

server.tool(
  "explain_data_anomaly",
  "Explain a metric anomaly using aggregate values and analyst notes without requiring raw data samples.",
  {
    metric: z.string(),
    expected: z.number(),
    observed: z.number(),
    timeframe: z.string(),
    notes: z.string().optional()
  },
  async ({ metric, expected, observed, timeframe, notes }) =>
    textResponse(explainAnomaly(metric, expected, observed, timeframe, notes ?? ""))
);

server.tool(
  "list_audit_events",
  "List recent audit events for a Firebase user workspace.",
  {
    userId: z.string().optional(),
    limit: z.number().min(1).max(50).optional()
  },
  async ({ userId, limit }) => {
    const uid = resolveUserId(userId);
    const snapshot = await db
      .collection("users")
      .doc(uid)
      .collection("audit")
      .orderBy("createdAt", "desc")
      .limit(limit ?? 20)
      .get();
    return textResponse(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

function resolveUserId(userId?: string) {
  const uid = userId ?? defaultUserId;
  if (!uid) {
    throw new Error("Set MCP_FIREBASE_USER_ID or pass userId.");
  }
  return uid;
}

function textResponse(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function sanitizeSchema(schema: SchemaSnapshot) {
  return {
    id: schema.id,
    connectorId: schema.connectorId,
    databaseName: schema.databaseName,
    schemaName: schema.schemaName,
    description: schema.description ?? "",
    tables: schema.tables.map((table) => ({
      name: table.name,
      rowEstimate: table.rowEstimate,
      columns: table.columns.map((column) => ({
        name: column.name,
        type: column.type,
        nullable: column.nullable,
        indexed: column.indexed,
        pii: column.pii
      }))
    }))
  };
}

function generateSql(
  schema: SchemaSnapshot,
  objective: string,
  dialect: DatabaseEngine,
  preferredTable?: string
) {
  const table =
    schema.tables.find((candidate) => candidate.name === preferredTable) ??
    schema.tables.slice().sort((a, b) => b.rowEstimate - a.rowEstimate)[0];

  if (!table) throw new Error("Schema has no tables.");

  const safeColumns = table.columns.filter((column) => !column.pii);
  const selectedColumns = (safeColumns.length ? safeColumns : table.columns).slice(0, 8);
  const indexedColumn =
    table.columns.find((column) => column.indexed && !column.pii) ??
    table.columns.find((column) => column.indexed) ??
    selectedColumns[0];
  const numericColumn = selectedColumns.find((column) =>
    /(int|number|decimal|numeric|float|double|bigint|money)/i.test(column.type)
  );
  const dateColumn = table.columns.find((column) =>
    /(date|time|created|updated|timestamp)/i.test(`${column.name} ${column.type}`)
  );
  const wantsAggregate = /(count|total|sum|average|avg|trend|anomal|spike|drop|metric)/i.test(objective);
  const quote = (identifier: string) => quoteIdentifier(identifier, dialect);
  const where = indexedColumn ? `WHERE ${quote(indexedColumn.name)} IS NOT NULL` : "";
  const limit = dialect === "SQL Server" ? "OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY" : "LIMIT 100";

  const sql =
    wantsAggregate && numericColumn
      ? [
          "SELECT",
          `  ${quote(indexedColumn.name)} AS segment_key,`,
          "  COUNT(*) AS row_count,",
          `  AVG(${quote(numericColumn.name)}) AS average_${safeAlias(numericColumn.name)}`,
          `FROM ${quote(table.name)}`,
          where,
          `GROUP BY ${quote(indexedColumn.name)}`,
          "ORDER BY row_count DESC",
          limit
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "SELECT",
          `  ${selectedColumns.map((column) => quote(column.name)).join(",\n  ")}`,
          `FROM ${quote(table.name)}`,
          where,
          dateColumn ? `ORDER BY ${quote(dateColumn.name)} DESC` : `ORDER BY ${quote(indexedColumn.name)} ASC`,
          limit
        ]
          .filter(Boolean)
          .join("\n");

  return {
    sql,
    safetyNotes: [
      `Selected ${selectedColumns.filter((column) => !column.pii).length} non-sensitive column(s).`,
      `PII columns were excluded unless the table has no non-PII columns.`,
      table.rowEstimate > 100000 ? "Run EXPLAIN before production use." : "Estimated table size is in a lower-risk range."
    ],
    estimatedComplexity: table.rowEstimate > 100000 ? "High" : table.rowEstimate > 10000 ? "Medium" : "Low"
  };
}

function quoteIdentifier(identifier: string, dialect: DatabaseEngine) {
  const escaped = identifier.replaceAll('"', '""').replaceAll("`", "``").replaceAll("]", "]]");
  if (dialect === "MySQL" || dialect === "BigQuery") return `\`${escaped}\``;
  if (dialect === "SQL Server") return `[${escaped}]`;
  return `"${escaped}"`;
}

function safeAlias(value: string) {
  return value.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
}

function inspectPlan(rawPlan: string) {
  const trimmed = rawPlan.trim();
  if (!trimmed) throw new Error("rawPlan is required.");

  const risks: Array<{ level: "Low" | "Medium" | "High"; title: string; detail: string }> = [];
  const recommendations = new Set<string>();
  const rowCounts = [...trimmed.matchAll(/(?:rows|Plan Rows|Actual Rows)[":=\s]+([0-9,]+)/gi)].map((match) =>
    Number(match[1].replaceAll(",", ""))
  );
  const largestRowCount = rowCounts.length ? Math.max(...rowCounts) : 0;
  let score = 94;

  if (/(seq scan|table scan|full scan)/i.test(trimmed)) {
    const level = largestRowCount > 50000 ? "High" : "Medium";
    risks.push({
      level,
      title: "Full table scan",
      detail: "Sequential or full table scan detected."
    });
    recommendations.add("Add or validate a selective index for the scan predicate.");
    score -= level === "High" ? 28 : 16;
  }

  if (/nested loop/i.test(trimmed) && largestRowCount > 10000) {
    risks.push({
      level: "High",
      title: "Large nested loop",
      detail: "Nested loop appears with high row estimates."
    });
    recommendations.add("Index join keys or compare with a hash/merge join plan.");
    score -= 24;
  }

  if (/(sort|filesort)/i.test(trimmed) && largestRowCount > 10000) {
    risks.push({
      level: "Medium",
      title: "Expensive sort",
      detail: "Large intermediate sort detected."
    });
    recommendations.add("Consider a composite index that matches filters and ordering.");
    score -= 12;
  }

  if (/(temp|temporary|spill|disk)/i.test(trimmed)) {
    risks.push({
      level: "Medium",
      title: "Temporary storage pressure",
      detail: "Plan references temporary storage or disk spill behavior."
    });
    recommendations.add("Filter earlier and reduce selected columns before raising memory.");
    score -= 10;
  }

  if (risks.length === 0) {
    recommendations.add("Save this plan with the query and compare it after data growth or index changes.");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    summary:
      risks.length === 0
        ? "No major plan risks were detected from the supplied plan text."
        : `${risks.length} plan risk${risks.length === 1 ? "" : "s"} detected.`,
    risks,
    recommendations: [...recommendations]
  };
}

function explainAnomaly(metric: string, expected: number, observed: number, timeframe: string, notes: string) {
  const baseline = expected === 0 ? 1 : Math.abs(expected);
  const deltaPercent = Number((((observed - expected) / baseline) * 100).toFixed(2));
  const direction = observed >= expected ? "above" : "below";
  const likelyCauses = new Set<string>();
  const nextChecks = new Set<string>();

  if (Math.abs(deltaPercent) > 50) {
    likelyCauses.add("Recent deployment, ingestion change, or upstream event shifted the metric sharply.");
    nextChecks.add("Compare the metric against deployment, import, and incident timestamps.");
  }

  if (/null|missing|blank/i.test(notes)) {
    likelyCauses.add("Null or missing values may be changing aggregate behavior.");
    nextChecks.add("Group by null-state and compare affected row counts.");
  }

  if (/join|duplicate|dedupe|double/i.test(notes)) {
    likelyCauses.add("Join cardinality or duplicate records may be inflating the metric.");
    nextChecks.add("Check primary keys, join predicates, and duplicate counts.");
  }

  likelyCauses.add("Segment mix changed between the expected baseline and observed window.");
  nextChecks.add("Break the metric down by an indexed dimension.");

  return {
    deltaPercent,
    explanation: `${metric} is ${Math.abs(deltaPercent).toFixed(2)}% ${direction} expected for ${timeframe}.`,
    likelyCauses: [...likelyCauses],
    nextChecks: [...nextChecks]
  };
}
