# Asana connection setup

WebSphere uses Asana OAuth 2.0 with PKCE and requests read-only access to projects and tasks. Linked Asana tasks can then be verified through the standard external-tool sync flow.

1. In [Asana Developer Console](https://app.asana.com/0/my-apps), create an OAuth app.
2. Add this redirect URI:

   `https://your-websphere-domain/api/integrations/asana/callback`

3. Configure the app for the `projects:read` and `tasks:read` scopes.
4. Add its client ID and client secret to the production API environment as `ASANA_CLIENT_ID` and `ASANA_CLIENT_SECRET`, then redeploy the API.

Never put the client secret in a Vite/browser environment or commit it to the repository.
