import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { ref, uploadString } from "firebase/storage";
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Database,
  FileJson,
  Gauge,
  KeyRound,
  Layers3,
  LockKeyhole,
  LogOut,
  Moon,
  PauseCircle,
  PlayCircle,
  Save,
  Search,
  Settings,
  Shield,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  UploadCloud,
  Wand2,
  XCircle
} from "lucide-react";
import heroImage from "./assets/database-bridge.png";
import { auth, db, enableAnalytics, firebaseConfig, signInWithGoogle, signOutUser, storage } from "./firebase";
import { useUserCollection } from "./hooks/useUserCollection";
import {
  countColumns,
  countSensitiveColumns,
  explainAnomaly,
  generateOptimizedSql,
  inspectPlanText,
  normalizeSchemaInput
} from "./lib/mcpLogic";
import type {
  AnomalyExplanation,
  AnomalyReport,
  AuditEvent,
  Connector,
  ConnectorStatus,
  DatabaseEngine,
  GeneratedSql,
  MaskPolicy,
  PlanInspection,
  PlanReview,
  SchemaSnapshot,
  ThemePreference,
  UserProfile
} from "./types";

type TabId = "bridge" | "schemas" | "sql" | "plans" | "anomalies" | "audit" | "settings";
type Toast = { type: "success" | "error" | "info"; message: string };

const engines: DatabaseEngine[] = ["PostgreSQL", "MySQL", "SQL Server", "BigQuery", "Snowflake", "SQLite"];
const maskPolicies: MaskPolicy[] = ["Strict", "Balanced", "Analyst"];
const statuses: ConnectorStatus[] = ["Active", "Paused", "Draft"];

const navItems = [
  { id: "bridge", label: "Bridge", icon: Shield },
  { id: "schemas", label: "Schemas", icon: Database },
  { id: "sql", label: "SQL Lab", icon: Code2 },
  { id: "plans", label: "Plans", icon: Gauge },
  { id: "anomalies", label: "Anomalies", icon: BrainCircuit },
  { id: "audit", label: "Audit", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings }
] satisfies Array<{ id: TabId; label: string; icon: typeof Shield }>;

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    enableAnalytics().catch(() => undefined);
    return onAuthStateChanged(auth, setUser);
  }, []);

  if (user === undefined) {
    return <LoadingShell />;
  }

  if (!user) {
    return <AuthGate />;
  }

  return <Workspace user={user} />;
}

function AuthGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setBusy(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <div className="brand-lockup">
          <span className="brand-mark">
            <LockKeyhole size={24} />
          </span>
          <span>Enterprise MCP Database Server</span>
        </div>
        <h1>Secure database intelligence for Codex.</h1>
        <p>
          Google sign-in unlocks a Firebase workspace for schemas, optimized SQL, execution plans,
          anomaly explanations, audit history, and MCP server configuration.
        </p>
        <button className="primary-button large" type="button" onClick={handleSignIn} disabled={busy}>
          <KeyRound size={18} />
          {busy ? "Opening Google" : "Continue with Google"}
        </button>
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
      <section className="auth-visual" aria-label="Secure database bridge visual">
        <img src={heroImage} alt="Futuristic secure database bridge" />
      </section>
    </main>
  );
}

function LoadingShell() {
  return (
    <main className="loading-shell">
      <div className="loading-core">
        <Shield size={34} />
        <span>Initializing secure workspace</span>
      </div>
    </main>
  );
}

function Workspace({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<TabId>("bridge");
  const [toast, setToast] = useState<Toast | null>(null);
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    const stored = window.localStorage.getItem("enterprise-mcp-theme");
    return stored === "light" || stored === "dark" || stored === "default" ? stored : "default";
  });
  const [profile, setProfile] = useState<UserProfile>({
    theme,
    defaultMaskPolicy: "Strict",
    allowPlanStorage: true,
    allowSchemaStorage: true
  });

  const connectors = useUserCollection<Connector>(user.uid, "connectors");
  const schemas = useUserCollection<SchemaSnapshot>(user.uid, "schemas");
  const queries = useUserCollection<QueryRunWithId>(user.uid, "queryRuns");
  const plans = useUserCollection<PlanReview>(user.uid, "planReviews");
  const anomalies = useUserCollection<AnomalyReport>(user.uid, "anomalyReports");
  const audit = useUserCollection<AuditEvent>(user.uid, "audit");

  useEffect(() => {
    const profileRef = doc(db, "users", user.uid);
    getDoc(profileRef)
      .then(async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as UserProfile;
          setProfile((current) => ({ ...current, ...data }));
          if (data.theme) setThemeState(data.theme);
          return;
        }

        await setDoc(profileRef, {
          theme,
          defaultMaskPolicy: "Strict",
          allowPlanStorage: true,
          allowSchemaStorage: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      })
      .catch((error) => showToast(setToast, "error", error.message));
  }, [theme, user.uid]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "default" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.themePreference = theme;
    };

    apply();
    media.addEventListener("change", apply);
    window.localStorage.setItem("enterprise-mcp-theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  async function addAudit(action: string, detail: string) {
    await addDoc(collection(db, "users", user.uid, "audit"), {
      action,
      detail,
      createdAt: serverTimestamp()
    });
  }

  async function updateProfile(partial: Partial<UserProfile>) {
    const nextProfile = { ...profile, ...partial };
    setProfile(nextProfile);
    if (partial.theme) setThemeState(partial.theme);
    await setDoc(
      doc(db, "users", user.uid),
      {
        ...partial,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  async function uploadJson(folder: string, fileName: string, payload: unknown) {
    const safeName = fileName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "snapshot";
    const storagePath = `users/${user.uid}/${folder}/${Date.now()}-${safeName}.json`;
    await uploadString(ref(storage, storagePath), JSON.stringify(payload, null, 2), "raw", {
      contentType: "application/json"
    });
    return storagePath;
  }

  async function handleThemeChange(nextTheme: ThemePreference) {
    try {
      await updateProfile({ theme: nextTheme });
      showToast(setToast, "success", `Theme set to ${nextTheme}.`);
      await addAudit("settings.theme", `Theme changed to ${nextTheme}.`);
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "Theme update failed.");
    }
  }

  const stats = useMemo(() => {
    const totalColumns = schemas.data.reduce((sum, schema) => sum + countColumns(schema), 0);
    const sensitiveColumns = schemas.data.reduce((sum, schema) => sum + countSensitiveColumns(schema), 0);
    const highRisks = plans.data.reduce(
      (sum, plan) => sum + plan.risks.filter((risk) => risk.level === "High").length,
      0
    );
    const averageScore =
      plans.data.length === 0
        ? 100
        : Math.round(plans.data.reduce((sum, plan) => sum + plan.score, 0) / plans.data.length);

    return [
      { label: "Connectors", value: connectors.data.length, icon: Cloud },
      { label: "Schema Columns", value: totalColumns, icon: Layers3 },
      { label: "Sensitive Fields", value: sensitiveColumns, icon: Shield },
      { label: "Plan Score", value: averageScore, suffix: "%", icon: Gauge },
      { label: "Open Risks", value: highRisks, icon: AlertTriangle },
      { label: "Anomalies", value: anomalies.data.length, icon: BrainCircuit }
    ];
  }, [anomalies.data.length, connectors.data.length, plans.data, schemas.data]);

  const collectionError =
    connectors.error || schemas.error || queries.error || plans.error || anomalies.error || audit.error;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup compact">
          <span className="brand-mark">
            <Shield size={20} />
          </span>
          <span>MCP Database</span>
        </div>
        <nav className="nav-list" aria-label="Workspace">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeTab === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Firebase Project {firebaseConfig.projectId}</p>
            <h1>{navItems.find((item) => item.id === activeTab)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <ThemeToggle theme={theme} onChange={handleThemeChange} />
            <div className="user-chip">
              {user.photoURL ? <img src={user.photoURL} alt="" /> : <span>{initials(user.displayName ?? user.email)}</span>}
              <span>{user.displayName ?? user.email}</span>
            </div>
            <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={signOutUser}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <section className="stat-grid" aria-label="Workspace stats">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <article className="stat-card" key={stat.label}>
                <Icon size={18} />
                <span>{stat.label}</span>
                <strong>
                  {stat.value}
                  {"suffix" in stat ? stat.suffix : ""}
                </strong>
              </article>
            );
          })}
        </section>

        {collectionError ? (
          <div className="inline-error">
            <AlertTriangle size={18} />
            {collectionError}
          </div>
        ) : null}

        {activeTab === "bridge" ? (
          <ConnectorPanel
            userId={user.uid}
            connectors={connectors.data}
            profile={profile}
            addAudit={addAudit}
            setToast={setToast}
          />
        ) : null}
        {activeTab === "schemas" ? (
          <SchemaPanel
            userId={user.uid}
            connectors={connectors.data}
            schemas={schemas.data}
            profile={profile}
            addAudit={addAudit}
            uploadJson={uploadJson}
            setToast={setToast}
          />
        ) : null}
        {activeTab === "sql" ? (
          <SqlPanel
            userId={user.uid}
            connectors={connectors.data}
            schemas={schemas.data}
            queries={queries.data}
            addAudit={addAudit}
            setToast={setToast}
          />
        ) : null}
        {activeTab === "plans" ? (
          <PlanPanel
            userId={user.uid}
            connectors={connectors.data}
            schemas={schemas.data}
            plans={plans.data}
            profile={profile}
            addAudit={addAudit}
            uploadJson={uploadJson}
            setToast={setToast}
          />
        ) : null}
        {activeTab === "anomalies" ? (
          <AnomalyPanel
            userId={user.uid}
            schemas={schemas.data}
            anomalies={anomalies.data}
            addAudit={addAudit}
            setToast={setToast}
          />
        ) : null}
        {activeTab === "audit" ? <AuditPanel events={audit.data} /> : null}
        {activeTab === "settings" ? (
          <SettingsPanel
            user={user}
            theme={theme}
            profile={profile}
            updateProfile={updateProfile}
            setTheme={handleThemeChange}
            addAudit={addAudit}
            setToast={setToast}
          />
        ) : null}
      </section>

      {toast ? <ToastMessage toast={toast} onClose={() => setToast(null)} /> : null}
    </main>
  );
}

type QueryRunWithId = {
  id: string;
  connectorId: string;
  schemaId: string;
  objective: string;
  dialect: DatabaseEngine;
  sql: string;
  safetyNotes: string[];
  estimatedComplexity: "Low" | "Medium" | "High";
  createdAt?: { toDate?: () => Date; seconds?: number };
};

function ThemeToggle({
  theme,
  onChange
}: {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {(["default", "light", "dark"] as ThemePreference[]).map((item) => {
        const Icon = item === "dark" ? Moon : item === "light" ? Sun : Sparkles;
        return (
          <button
            className={theme === item ? "segmented active" : "segmented"}
            key={item}
            type="button"
            title={`${item} theme`}
            onClick={() => onChange(item)}
          >
            <Icon size={15} />
            <span>{titleCase(item)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ConnectorPanel({
  userId,
  connectors,
  profile,
  addAudit,
  setToast
}: {
  userId: string;
  connectors: Connector[];
  profile: UserProfile;
  addAudit: (action: string, detail: string) => Promise<void>;
  setToast: (toast: Toast | null) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    engine: "PostgreSQL" as DatabaseEngine,
    environment: "",
    hostFingerprint: "",
    maskPolicy: profile.defaultMaskPolicy ?? "Strict",
    status: "Active" as ConnectorStatus
  });
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await addDoc(collection(db, "users", userId, "connectors"), {
        ...form,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await addAudit("connector.create", `Created connector ${form.name}.`);
      setForm({
        name: "",
        engine: form.engine,
        environment: "",
        hostFingerprint: "",
        maskPolicy: profile.defaultMaskPolicy ?? "Strict",
        status: "Active"
      });
      showToast(setToast, "success", "Connector saved.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "Connector save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(connector: Connector, status: ConnectorStatus) {
    await updateDoc(doc(db, "users", userId, "connectors", connector.id), {
      status,
      updatedAt: serverTimestamp()
    });
    await addAudit("connector.status", `${connector.name} set to ${status}.`);
    showToast(setToast, "success", `${connector.name} set to ${status}.`);
  }

  async function removeConnector(connector: Connector) {
    await deleteDoc(doc(db, "users", userId, "connectors", connector.id));
    await addAudit("connector.delete", `Deleted connector ${connector.name}.`);
    showToast(setToast, "success", "Connector deleted.");
  }

  return (
    <section className="content-grid two">
      <form className="tool-panel" onSubmit={handleSubmit}>
        <PanelHeading icon={Shield} title="Secure Bridge" />
        <label>
          Connector name
          <input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Production read replica"
          />
        </label>
        <div className="form-grid">
          <label>
            Engine
            <select
              value={form.engine}
              onChange={(event) =>
                setForm((current) => ({ ...current, engine: event.target.value as DatabaseEngine }))
              }
            >
              {engines.map((engine) => (
                <option key={engine}>{engine}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as ConnectorStatus }))
              }
            >
              {statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Environment
          <input
            required
            value={form.environment}
            onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
            placeholder="Production, staging, analytics"
          />
        </label>
        <label>
          Host fingerprint
          <input
            required
            value={form.hostFingerprint}
            onChange={(event) => setForm((current) => ({ ...current, hostFingerprint: event.target.value }))}
            placeholder="sha256:..."
          />
        </label>
        <label>
          Mask policy
          <select
            value={form.maskPolicy}
            onChange={(event) => setForm((current) => ({ ...current, maskPolicy: event.target.value as MaskPolicy }))}
          >
            {maskPolicies.map((policy) => (
              <option key={policy}>{policy}</option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          <Save size={17} />
          {busy ? "Saving" : "Save Connector"}
        </button>
      </form>

      <section className="records-panel">
        <PanelHeading icon={Cloud} title="Live Connectors" />
        {connectors.length === 0 ? <EmptyState icon={Database} text="No connectors saved yet." /> : null}
        <div className="record-grid">
          {connectors.map((connector) => (
            <article className="record-card" key={connector.id}>
              <div className="record-topline">
                <strong>{connector.name}</strong>
                <span className={`status-pill ${connector.status.toLowerCase()}`}>{connector.status}</span>
              </div>
              <p>{connector.engine}</p>
              <dl>
                <div>
                  <dt>Environment</dt>
                  <dd>{connector.environment}</dd>
                </div>
                <div>
                  <dt>Mask</dt>
                  <dd>{connector.maskPolicy}</dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd>{connector.hostFingerprint}</dd>
                </div>
              </dl>
              <div className="card-actions">
                {connector.status === "Active" ? (
                  <button type="button" onClick={() => updateStatus(connector, "Paused")}>
                    <PauseCircle size={16} />
                    Pause
                  </button>
                ) : (
                  <button type="button" onClick={() => updateStatus(connector, "Active")}>
                    <PlayCircle size={16} />
                    Activate
                  </button>
                )}
                <button className="danger-button" type="button" onClick={() => removeConnector(connector)}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function SchemaPanel({
  userId,
  connectors,
  schemas,
  profile,
  addAudit,
  uploadJson,
  setToast
}: {
  userId: string;
  connectors: Connector[];
  schemas: SchemaSnapshot[];
  profile: UserProfile;
  addAudit: (action: string, detail: string) => Promise<void>;
  uploadJson: (folder: string, fileName: string, payload: unknown) => Promise<string>;
  setToast: (toast: Toast | null) => void;
}) {
  const [connectorId, setConnectorId] = useState("");
  const [databaseName, setDatabaseName] = useState("");
  const [schemaName, setSchemaName] = useState("");
  const [description, setDescription] = useState("");
  const [schemaText, setSchemaText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connectorId && connectors[0]) setConnectorId(connectors[0].id);
  }, [connectorId, connectors]);

  async function handleImport(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const tables = normalizeSchemaInput(schemaText);
      const payload = {
        connectorId,
        databaseName,
        schemaName,
        description,
        tables
      };
      const { path: storagePath, warning } = profile.allowSchemaStorage
        ? await tryUploadJson(uploadJson, "schema-snapshots", `${databaseName}-${schemaName}`, payload)
        : { path: undefined, warning: "" };
      await addDoc(collection(db, "users", userId, "schemas"), {
        ...payload,
        storagePath,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await addAudit("schema.import", `Imported ${schemaName} with ${tables.length} table(s).`);
      setDatabaseName("");
      setSchemaName("");
      setDescription("");
      setSchemaText("");
      showToast(setToast, warning ? "info" : "success", warning || "Schema imported.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "Schema import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSchema(schema: SchemaSnapshot) {
    await deleteDoc(doc(db, "users", userId, "schemas", schema.id));
    await addAudit("schema.delete", `Deleted schema ${schema.schemaName}.`);
    showToast(setToast, "success", "Schema deleted.");
  }

  return (
    <section className="content-grid two">
      <form className="tool-panel" onSubmit={handleImport}>
        <PanelHeading icon={UploadCloud} title="Schema Vault" />
        <label>
          Connector
          <select required value={connectorId} onChange={(event) => setConnectorId(event.target.value)}>
            <option value="" disabled>
              Select connector
            </option>
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Database
            <input required value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
          </label>
          <label>
            Schema
            <input required value={schemaName} onChange={(event) => setSchemaName(event.target.value)} />
          </label>
        </div>
        <label>
          Snapshot note
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Schema JSON
          <textarea
            required
            className="code-input"
            value={schemaText}
            onChange={(event) => setSchemaText(event.target.value)}
            placeholder='{"tables":[{"name":"orders","rowEstimate":120000,"columns":[{"name":"id","type":"uuid","indexed":true},{"name":"amount","type":"numeric"},{"name":"customer_email","type":"text","pii":true}]}]}'
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy || connectors.length === 0}>
          <FileJson size={17} />
          {busy ? "Importing" : "Import Schema"}
        </button>
      </form>

      <section className="records-panel">
        <PanelHeading icon={Database} title="Stored Schemas" />
        {schemas.length === 0 ? <EmptyState icon={FileJson} text="No schema snapshots stored yet." /> : null}
        <div className="record-grid">
          {schemas.map((schema) => {
            const connector = connectors.find((candidate) => candidate.id === schema.connectorId);
            return (
              <article className="record-card" key={schema.id}>
                <div className="record-topline">
                  <strong>{schema.databaseName}.{schema.schemaName}</strong>
                  <span className="status-pill active">{schema.tables.length} tables</span>
                </div>
                <p>{connector?.name ?? "Unknown connector"}</p>
                <dl>
                  <div>
                    <dt>Columns</dt>
                    <dd>{countColumns(schema)}</dd>
                  </div>
                  <div>
                    <dt>Sensitive</dt>
                    <dd>{countSensitiveColumns(schema)}</dd>
                  </div>
                  <div>
                    <dt>Storage</dt>
                    <dd>{schema.storagePath ? "Enabled" : "Off"}</dd>
                  </div>
                </dl>
                <div className="table-chip-row">
                  {schema.tables.slice(0, 6).map((table) => (
                    <span key={table.name}>{table.name}</span>
                  ))}
                </div>
                <div className="card-actions">
                  <button className="danger-button" type="button" onClick={() => removeSchema(schema)}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function SqlPanel({
  userId,
  connectors,
  schemas,
  queries,
  addAudit,
  setToast
}: {
  userId: string;
  connectors: Connector[];
  schemas: SchemaSnapshot[];
  queries: QueryRunWithId[];
  addAudit: (action: string, detail: string) => Promise<void>;
  setToast: (toast: Toast | null) => void;
}) {
  const [schemaId, setSchemaId] = useState("");
  const [objective, setObjective] = useState("");
  const [preferredTable, setPreferredTable] = useState("");
  const [generated, setGenerated] = useState<GeneratedSql | null>(null);
  const [sqlDraft, setSqlDraft] = useState("");
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const selectedConnector = connectors.find((connector) => connector.id === selectedSchema?.connectorId);

  useEffect(() => {
    if (!schemaId && schemas[0]) setSchemaId(schemas[0].id);
  }, [schemaId, schemas]);

  useEffect(() => {
    setPreferredTable(selectedSchema?.tables[0]?.name ?? "");
  }, [selectedSchema?.id]);

  function handleGenerate() {
    try {
      if (!selectedSchema) throw new Error("Select a schema first.");
      const result = generateOptimizedSql(
        selectedSchema,
        objective || "Review recent operational records",
        selectedConnector?.engine ?? "PostgreSQL",
        preferredTable
      );
      setGenerated(result);
      setSqlDraft(result.sql);
      showToast(setToast, "success", "SQL generated.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "SQL generation failed.");
    }
  }

  async function handleSave() {
    try {
      if (!selectedSchema || !selectedConnector || !sqlDraft.trim()) {
        throw new Error("Generate or enter SQL before saving.");
      }
      await addDoc(collection(db, "users", userId, "queryRuns"), {
        connectorId: selectedConnector.id,
        schemaId: selectedSchema.id,
        objective: objective || "Manual SQL review",
        dialect: selectedConnector.engine,
        sql: sqlDraft,
        safetyNotes: generated?.safetyNotes ?? ["Manual SQL saved for review."],
        estimatedComplexity: generated?.estimatedComplexity ?? "Medium",
        createdAt: serverTimestamp()
      });
      await addAudit("sql.save", `Saved SQL for ${selectedSchema.schemaName}.`);
      showToast(setToast, "success", "SQL saved.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "SQL save failed.");
    }
  }

  return (
    <section className="content-grid two">
      <section className="tool-panel">
        <PanelHeading icon={Wand2} title="Optimized SQL" />
        <label>
          Schema
          <select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
            <option value="" disabled>
              Select schema
            </option>
            {schemas.map((schema) => (
              <option key={schema.id} value={schema.id}>
                {schema.databaseName}.{schema.schemaName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target table
          <select value={preferredTable} onChange={(event) => setPreferredTable(event.target.value)}>
            {selectedSchema?.tables.map((table) => (
              <option key={table.name}>{table.name}</option>
            ))}
          </select>
        </label>
        <label>
          Objective
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Find recent revenue anomalies by segment"
          />
        </label>
        <div className="button-row">
          <button className="primary-button" type="button" onClick={handleGenerate} disabled={!selectedSchema}>
            <Sparkles size={17} />
            Generate
          </button>
          <button type="button" onClick={handleSave} disabled={!sqlDraft.trim()}>
            <Save size={17} />
            Save
          </button>
          <button type="button" onClick={() => copyText(sqlDraft, setToast)} disabled={!sqlDraft.trim()}>
            <Copy size={17} />
            Copy
          </button>
        </div>
        <label>
          SQL
          <textarea
            className="code-input sql-editor"
            value={sqlDraft}
            onChange={(event) => setSqlDraft(event.target.value)}
          />
        </label>
        {generated ? (
          <div className="analysis-block">
            <strong>Complexity: {generated.estimatedComplexity}</strong>
            <ul>
              {generated.safetyNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="records-panel">
        <PanelHeading icon={TerminalSquare} title="Saved SQL" />
        {queries.length === 0 ? <EmptyState icon={Code2} text="No saved SQL yet." /> : null}
        <div className="record-grid">
          {queries.map((queryRun) => {
            const schema = schemas.find((candidate) => candidate.id === queryRun.schemaId);
            return (
              <article className="record-card query-card" key={queryRun.id}>
                <div className="record-topline">
                  <strong>{queryRun.objective}</strong>
                  <span className={`status-pill ${queryRun.estimatedComplexity.toLowerCase()}`}>
                    {queryRun.estimatedComplexity}
                  </span>
                </div>
                <p>{schema ? `${schema.databaseName}.${schema.schemaName}` : queryRun.dialect}</p>
                <pre>{queryRun.sql}</pre>
                <div className="card-actions">
                  <button type="button" onClick={() => copyText(queryRun.sql, setToast)}>
                    <Copy size={16} />
                    Copy
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function PlanPanel({
  userId,
  connectors,
  schemas,
  plans,
  profile,
  addAudit,
  uploadJson,
  setToast
}: {
  userId: string;
  connectors: Connector[];
  schemas: SchemaSnapshot[];
  plans: PlanReview[];
  profile: UserProfile;
  addAudit: (action: string, detail: string) => Promise<void>;
  uploadJson: (folder: string, fileName: string, payload: unknown) => Promise<string>;
  setToast: (toast: Toast | null) => void;
}) {
  const [connectorId, setConnectorId] = useState("");
  const [schemaId, setSchemaId] = useState("");
  const [rawPlan, setRawPlan] = useState("");
  const [inspection, setInspection] = useState<PlanInspection | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connectorId && connectors[0]) setConnectorId(connectors[0].id);
    if (!schemaId && schemas[0]) setSchemaId(schemas[0].id);
  }, [connectorId, connectors, schemaId, schemas]);

  async function handleInspect() {
    setBusy(true);
    try {
      const result = inspectPlanText(rawPlan);
      const { path: storagePath, warning } = profile.allowPlanStorage
        ? await tryUploadJson(uploadJson, "execution-plans", `plan-${connectorId}`, { rawPlan, result })
        : { path: undefined, warning: "" };
      await addDoc(collection(db, "users", userId, "planReviews"), {
        connectorId,
        schemaId: schemaId || null,
        rawPlanStoragePath: storagePath,
        ...result,
        createdAt: serverTimestamp()
      });
      setInspection(result);
      await addAudit("plan.inspect", `Reviewed plan with score ${result.score}.`);
      showToast(setToast, warning ? "info" : "success", warning || "Plan inspected.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "Plan inspection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-grid two">
      <section className="tool-panel">
        <PanelHeading icon={Search} title="Execution Plan" />
        <div className="form-grid">
          <label>
            Connector
            <select required value={connectorId} onChange={(event) => setConnectorId(event.target.value)}>
              <option value="" disabled>
                Select connector
              </option>
              {connectors.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Schema
            <select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
              <option value="">None</option>
              {schemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.databaseName}.{schema.schemaName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Plan text or JSON
          <textarea
            required
            className="code-input sql-editor"
            value={rawPlan}
            onChange={(event) => setRawPlan(event.target.value)}
            placeholder='{"Plan":{"Node Type":"Seq Scan","Relation Name":"orders","Plan Rows":120000}}'
          />
        </label>
        <button className="primary-button" type="button" onClick={handleInspect} disabled={busy || !rawPlan.trim()}>
          <Gauge size={17} />
          {busy ? "Inspecting" : "Inspect Plan"}
        </button>
        {inspection ? <PlanInspectionView inspection={inspection} /> : null}
      </section>

      <section className="records-panel">
        <PanelHeading icon={Gauge} title="Plan Reviews" />
        {plans.length === 0 ? <EmptyState icon={Gauge} text="No plan reviews stored yet." /> : null}
        <div className="record-grid">
          {plans.map((plan) => (
            <article className="record-card" key={plan.id}>
              <div className="record-topline">
                <strong>Score {plan.score}%</strong>
                <span className={`status-pill ${plan.score > 85 ? "active" : plan.score > 65 ? "medium" : "high"}`}>
                  {plan.risks.length} risks
                </span>
              </div>
              <p>{plan.summary}</p>
              <ul className="compact-list">
                {plan.recommendations.slice(0, 3).map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function PlanInspectionView({ inspection }: { inspection: PlanInspection }) {
  return (
    <div className="analysis-block">
      <strong>Score: {inspection.score}%</strong>
      <p>{inspection.summary}</p>
      {inspection.risks.length ? (
        <ul>
          {inspection.risks.map((risk) => (
            <li key={`${risk.level}-${risk.title}`}>
              {risk.level}: {risk.title} - {risk.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <ul>
        {inspection.recommendations.map((recommendation) => (
          <li key={recommendation}>{recommendation}</li>
        ))}
      </ul>
    </div>
  );
}

function AnomalyPanel({
  userId,
  schemas,
  anomalies,
  addAudit,
  setToast
}: {
  userId: string;
  schemas: SchemaSnapshot[];
  anomalies: AnomalyReport[];
  addAudit: (action: string, detail: string) => Promise<void>;
  setToast: (toast: Toast | null) => void;
}) {
  const [schemaId, setSchemaId] = useState("");
  const [metric, setMetric] = useState("");
  const [expected, setExpected] = useState("");
  const [observed, setObserved] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<AnomalyExplanation | null>(null);

  useEffect(() => {
    if (!schemaId && schemas[0]) setSchemaId(schemas[0].id);
  }, [schemaId, schemas]);

  async function handleExplain(event: FormEvent) {
    event.preventDefault();
    try {
      const explanation = explainAnomaly(metric, Number(expected), Number(observed), timeframe, notes);
      await addDoc(collection(db, "users", userId, "anomalyReports"), {
        schemaId: schemaId || null,
        metric,
        expected: Number(expected),
        observed: Number(observed),
        timeframe,
        notes,
        ...explanation,
        createdAt: serverTimestamp()
      });
      setResult(explanation);
      await addAudit("anomaly.explain", `Explained anomaly for ${metric}.`);
      showToast(setToast, "success", "Anomaly explanation saved.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "Anomaly explanation failed.");
    }
  }

  return (
    <section className="content-grid two">
      <form className="tool-panel" onSubmit={handleExplain}>
        <PanelHeading icon={BrainCircuit} title="Anomaly Explanation" />
        <label>
          Schema
          <select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
            <option value="">None</option>
            {schemas.map((schema) => (
              <option key={schema.id} value={schema.id}>
                {schema.databaseName}.{schema.schemaName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Metric
          <input required value={metric} onChange={(event) => setMetric(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Expected
            <input required type="number" value={expected} onChange={(event) => setExpected(event.target.value)} />
          </label>
          <label>
            Observed
            <input required type="number" value={observed} onChange={(event) => setObserved(event.target.value)} />
          </label>
        </div>
        <label>
          Timeframe
          <input required value={timeframe} onChange={(event) => setTimeframe(event.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <button className="primary-button" type="submit">
          <Bot size={17} />
          Explain
        </button>
        {result ? <AnomalyResult result={result} /> : null}
      </form>

      <section className="records-panel">
        <PanelHeading icon={AlertTriangle} title="Saved Reports" />
        {anomalies.length === 0 ? <EmptyState icon={BrainCircuit} text="No anomaly reports stored yet." /> : null}
        <div className="record-grid">
          {anomalies.map((anomaly) => (
            <article className="record-card" key={anomaly.id}>
              <div className="record-topline">
                <strong>{anomaly.metric}</strong>
                <span className={`status-pill ${Math.abs(anomaly.deltaPercent) > 50 ? "high" : "medium"}`}>
                  {anomaly.deltaPercent}%
                </span>
              </div>
              <p>{anomaly.explanation}</p>
              <ul className="compact-list">
                {anomaly.nextChecks.slice(0, 3).map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function AnomalyResult({ result }: { result: AnomalyExplanation }) {
  return (
    <div className="analysis-block">
      <strong>{result.explanation}</strong>
      <ul>
        {result.likelyCauses.map((cause) => (
          <li key={cause}>{cause}</li>
        ))}
      </ul>
      <ul>
        {result.nextChecks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
    </div>
  );
}

function AuditPanel({ events }: { events: AuditEvent[] }) {
  return (
    <section className="records-panel full">
      <PanelHeading icon={Activity} title="Audit Trail" />
      {events.length === 0 ? <EmptyState icon={Activity} text="No audit events yet." /> : null}
      <div className="timeline">
        {events.map((event) => (
          <article className="timeline-item" key={event.id}>
            <span className="timeline-dot" />
            <div>
              <strong>{event.action}</strong>
              <p>{event.detail}</p>
              <time>{formatDate(event.createdAt)}</time>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({
  user,
  theme,
  profile,
  updateProfile,
  setTheme,
  addAudit,
  setToast
}: {
  user: User;
  theme: ThemePreference;
  profile: UserProfile;
  updateProfile: (partial: Partial<UserProfile>) => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  addAudit: (action: string, detail: string) => Promise<void>;
  setToast: (toast: Toast | null) => void;
}) {
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        enterpriseDatabase: {
          command: "node",
          args: ["mcp-server/dist/index.js"],
          env: {
            FIREBASE_PROJECT_ID: firebaseConfig.projectId,
            MCP_FIREBASE_USER_ID: user.uid
          }
        }
      }
    },
    null,
    2
  );

  async function handleProfileUpdate(partial: Partial<UserProfile>, action: string) {
    try {
      await updateProfile(partial);
      await addAudit("settings.update", action);
      showToast(setToast, "success", "Settings saved.");
    } catch (error) {
      showToast(setToast, "error", error instanceof Error ? error.message : "Settings update failed.");
    }
  }

  return (
    <section className="content-grid two">
      <section className="tool-panel">
        <PanelHeading icon={Settings} title="Preferences" />
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as ThemePreference)}>
            <option value="default">Default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Default mask policy
          <select
            value={profile.defaultMaskPolicy ?? "Strict"}
            onChange={(event) =>
              handleProfileUpdate(
                { defaultMaskPolicy: event.target.value as MaskPolicy },
                `Default mask policy set to ${event.target.value}.`
              )
            }
          >
            {maskPolicies.map((policy) => (
              <option key={policy}>{policy}</option>
            ))}
          </select>
        </label>
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={profile.allowSchemaStorage ?? true}
            onChange={(event) =>
              handleProfileUpdate({ allowSchemaStorage: event.target.checked }, "Schema storage preference changed.")
            }
          />
          Store schema snapshots in Firebase Storage
        </label>
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={profile.allowPlanStorage ?? true}
            onChange={(event) =>
              handleProfileUpdate({ allowPlanStorage: event.target.checked }, "Plan storage preference changed.")
            }
          />
          Store raw plans in Firebase Storage
        </label>
      </section>

      <section className="records-panel">
        <PanelHeading icon={TerminalSquare} title="MCP Client Config" />
        <pre className="config-block">{mcpConfig}</pre>
        <button type="button" onClick={() => copyText(mcpConfig, setToast)}>
          <Clipboard size={17} />
          Copy Config
        </button>
      </section>
    </section>
  );
}

function PanelHeading({ icon: Icon, title }: { icon: typeof Shield; title: string }) {
  return (
    <div className="panel-heading">
      <Icon size={19} />
      <h2>{title}</h2>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Shield; text: string }) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <span>{text}</span>
    </div>
  );
}

function ToastMessage({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`toast ${toast.type}`} role="status">
      {toast.type === "success" ? <CheckCircle2 size={18} /> : null}
      {toast.type === "error" ? <XCircle size={18} /> : null}
      {toast.type === "info" ? <Sparkles size={18} /> : null}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">
        <XCircle size={16} />
      </button>
    </div>
  );
}

function showToast(setToast: (toast: Toast | null) => void, type: Toast["type"], message: string) {
  setToast({ type, message });
  window.setTimeout(() => setToast(null), 4200);
}

async function copyText(text: string, setToast: (toast: Toast | null) => void) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(setToast, "success", "Copied.");
  } catch (error) {
    showToast(setToast, "error", error instanceof Error ? error.message : "Copy failed.");
  }
}

async function tryUploadJson(
  uploadJson: (folder: string, fileName: string, payload: unknown) => Promise<string>,
  folder: string,
  fileName: string,
  payload: unknown
) {
  try {
    return {
      path: await uploadJson(folder, fileName, payload),
      warning: ""
    };
  } catch {
    return {
      path: undefined,
      warning: "Saved to Firestore. Firebase Storage is not initialized for this project yet."
    };
  }
}

function initials(value: string | null | undefined) {
  if (!value) return "U";
  return value
    .split(/[ @._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatDate(value: { toDate?: () => Date; seconds?: number } | undefined) {
  if (!value) return "Pending";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : null;
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "Pending";
}

export default App;
