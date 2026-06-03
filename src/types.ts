export type ThemePreference = "default" | "light" | "dark";

export type DatabaseEngine =
  | "PostgreSQL"
  | "MySQL"
  | "SQL Server"
  | "BigQuery"
  | "Snowflake"
  | "SQLite";

export type MaskPolicy = "Strict" | "Balanced" | "Analyst";
export type ConnectorStatus = "Active" | "Paused" | "Draft";

export type TimestampLike = {
  seconds?: number;
  nanoseconds?: number;
  toDate?: () => Date;
};

export type Connector = {
  id: string;
  name: string;
  engine: DatabaseEngine;
  environment: string;
  hostFingerprint: string;
  maskPolicy: MaskPolicy;
  status: ConnectorStatus;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
};

export type ColumnSchema = {
  name: string;
  type: string;
  nullable: boolean;
  indexed: boolean;
  pii: boolean;
};

export type TableSchema = {
  name: string;
  rowEstimate: number;
  columns: ColumnSchema[];
};

export type SchemaSnapshot = {
  id: string;
  connectorId: string;
  databaseName: string;
  schemaName: string;
  description: string;
  tables: TableSchema[];
  storagePath?: string;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
};

export type QueryRun = {
  id: string;
  connectorId: string;
  schemaId: string;
  objective: string;
  dialect: DatabaseEngine;
  sql: string;
  safetyNotes: string[];
  estimatedComplexity: "Low" | "Medium" | "High";
  createdAt?: TimestampLike;
};

export type PlanRisk = {
  level: "Low" | "Medium" | "High";
  title: string;
  detail: string;
};

export type PlanReview = {
  id: string;
  connectorId: string;
  schemaId?: string;
  rawPlanStoragePath?: string;
  score: number;
  summary: string;
  risks: PlanRisk[];
  recommendations: string[];
  createdAt?: TimestampLike;
};

export type AnomalyReport = {
  id: string;
  schemaId?: string;
  metric: string;
  expected: number;
  observed: number;
  timeframe: string;
  notes: string;
  deltaPercent: number;
  explanation: string;
  likelyCauses: string[];
  nextChecks: string[];
  createdAt?: TimestampLike;
};

export type AuditEvent = {
  id: string;
  action: string;
  detail: string;
  createdAt?: TimestampLike;
};

export type UserProfile = {
  theme?: ThemePreference;
  defaultMaskPolicy?: MaskPolicy;
  allowPlanStorage?: boolean;
  allowSchemaStorage?: boolean;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
};

export type GeneratedSql = {
  sql: string;
  safetyNotes: string[];
  estimatedComplexity: "Low" | "Medium" | "High";
};

export type PlanInspection = {
  score: number;
  summary: string;
  risks: PlanRisk[];
  recommendations: string[];
};

export type AnomalyExplanation = {
  deltaPercent: number;
  explanation: string;
  likelyCauses: string[];
  nextChecks: string[];
};
