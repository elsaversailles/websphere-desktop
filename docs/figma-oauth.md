# Figma OAuth setup

Create an OAuth app in Figma's developer settings and add this redirect URL:

```text
https://websphere.fun/api/integrations/figma/callback
```

Request only these scopes:

- `current_user:read` — confirms the connected Figma account.
- `file_content:read` — verifies linked Figma files during sync.

Add the generated values to the production environment without committing them:

```text
FIGMA_CLIENT_ID=
FIGMA_CLIENT_SECRET=
```

WebSphere uses OAuth authorization code flow with PKCE (S256), exchanges the code server-side using HTTP Basic authentication, and stores encrypted access and refresh tokens. After deployment, sign in to WebSphere, select **Apps & External Tools**, choose **Figma**, and select **Connect**. A connected user can attach a Figma file URL to a task and use **Sync Files** to verify its access.
