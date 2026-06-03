# Enterprise MCP Database Server

A Firebase-backed web app and MCP SDK server for secure database metadata work. It lets a signed-in user store connector fingerprints, import schema snapshots, generate privacy-aware SQL, inspect execution plans, explain aggregate anomalies, and export a Codex MCP client config without exposing row-level data.

## Live Stack

- React + Vite + TypeScript
- Firebase Authentication with Google sign-in
- Cloud Firestore for authenticated workspace records
- Firebase Storage for schema snapshots and execution-plan artifacts
- Firebase Hosting for production deployment
- Model Context Protocol TypeScript SDK for the local Codex bridge

## Firebase Project

The app is configured for:

```txt
enterprise-mcp-database-server
```

Firebase web config is stored in `src/firebase.ts` and `.env.example`. The web API key is public Firebase client configuration; service account keys and private environment files are intentionally ignored by Git.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

## Firebase Deployment

```bash
firebase use enterprise-mcp-database-server
npm run deploy
```

The deploy script publishes Firebase Hosting plus Firestore and Storage rules.

## MCP Server

Build the MCP stdio server:

```bash
npm run mcp:build
```

Run it with Application Default Credentials or a local service account path:

```bash
set FIREBASE_PROJECT_ID=enterprise-mcp-database-server
set MCP_FIREBASE_USER_ID=<firebase-auth-user-id>
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
npm run mcp:start
```

Available MCP tools:

- `list_connectors`
- `read_schema`
- `generate_optimized_sql`
- `inspect_execution_plan`
- `explain_data_anomaly`
- `list_audit_events`

The MCP server reads schema metadata, connector metadata, plans, and audit records from the signed-in user's Firestore namespace. It does not query or return raw database rows.

## Firestore Shape

```txt
users/{uid}
users/{uid}/connectors/{connectorId}
users/{uid}/schemas/{schemaId}
users/{uid}/queryRuns/{queryRunId}
users/{uid}/planReviews/{planReviewId}
users/{uid}/anomalyReports/{reportId}
users/{uid}/audit/{eventId}
```

## Storage Shape

```txt
users/{uid}/schema-snapshots/*.json
users/{uid}/execution-plans/*.json
```

## Security Model

- Firestore rules restrict all user documents and subcollections to the matching Firebase Auth UID.
- Storage rules restrict files to `users/{uid}/...` and cap uploads at 10 MB.
- The web app stores database host fingerprints and schema metadata, not database passwords.
- MCP access requires Firebase Admin credentials in the local runtime.
