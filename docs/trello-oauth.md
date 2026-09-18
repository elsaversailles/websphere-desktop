# Trello connection setup

WebSphere uses Trello OAuth 2.0 with PKCE. It requests read-only board and member access, plus `offline_access` so users do not have to reconnect when the one-hour access token expires.

1. In [Trello app administration](https://trello.com/apps/admin), create or open the WebSphere app and add an OAuth 2.0 client.
2. Set the client security type to **confidential**.
3. Add this callback URL to the OAuth 2.0 client:

   `https://your-websphere-domain/api/integrations/trello/callback`

4. Enable the requested scopes: `read:member:trello` and `read:board:trello`.
5. Put the generated client ID and secret in the production API environment as `TRELLO_CLIENT_ID` and `TRELLO_CLIENT_SECRET`, then redeploy the API.

Never put the client secret in the Vite/browser environment or commit it to the repository.
