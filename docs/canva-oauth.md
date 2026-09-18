# Canva connection setup

WebSphere connects Canva accounts with OAuth 2.0 Authorization Code flow and PKCE. It requests only `design:meta:read`, so it can verify linked designs and show their availability without editing any Canva content.

1. In the [Canva Developer Portal](https://www.canva.com/developers/), create a Connect API integration.
2. Enable the `design:meta:read` scope.
3. Add this redirect URI to the integration:

   `https://your-websphere-domain/api/integrations/canva/callback`

4. Add the client ID and client secret to the production API environment as `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET`.
5. Redeploy through GitHub CI/CD, then use **Connect** for Canva in Apps & External Tools.

Canva refresh tokens rotate and can be used only once. WebSphere stores the replacement token encrypted after each refresh. Never put the client secret in a Vite/browser environment or commit it to the repository.
