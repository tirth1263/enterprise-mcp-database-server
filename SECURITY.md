# Security Notes

This repository includes public Firebase client configuration for the web app. Do not commit service account JSON, database credentials, connection strings, private keys, or production `.env` files.

Recommended Firebase settings:

- Keep Google sign-in enabled in Firebase Authentication.
- Keep Firestore and Storage rules deployed from this repository.
- Scope service accounts used by the MCP server to the minimum Firebase permissions required.
- Store only database metadata and execution-plan text that is safe for your organization to retain.
- Rotate any credential that is accidentally committed or pasted into the app.
