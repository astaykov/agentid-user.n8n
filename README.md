# AgentID Custom OAuth2 Credential for n8n

This package adds a custom three-step OAuth2 credential to n8n for AgentID/blueprint flows. It produces a final access token suitable for downstream HTTP calls (including HTTP Request or MCP Client nodes).

## OAuth2 sequence
1. **Blueprint FIC** – client credentials with extra `fmi_path` (agent_id). Saves `blueprint_fic`.
2. **AgentID FIC** – client credentials using `blueprint_fic` as `client_assertion`. Saves `agentid_fic`.
3. **User token** – on-behalf-of style request with `grant_type=user_fic`, `client_assertion=blueprint_fic`, and `user_federated_identity_credential=agentid_fic`. The returned access token is injected as `Authorization: Bearer <token>` in subsequent requests.

## Project layout
- dist/ (build output)
- src/index.ts (exports the credential and nodes)
- src/credentials/AgentIdOAuth2Api.credentials.ts (credential implementation)
- src/nodes/AgentIdPing.node.ts (minimal node for quick validation)
- src/nodes/AgentIdToken.node.ts (produces a bearer token for downstream nodes)

## Build and publish
1. Install deps: `npm install`
2. Build: `npm run build` (emits `dist/`)
3. Package: `npm run pack` (produces `n8n-nodes-agentid-<version>.tgz`)
4. Publish options:
   - **Local/self-hosted n8n**: copy the `.tgz` into the n8n container/host and run `n8n install /path/to/n8n-nodes-agentid-<version>.tgz`, then restart n8n.
   - **Custom npm feed**: `npm publish` (or `npm publish --registry <url>`) and then `n8n install n8n-nodes-agentid`.

## Use pattern (works with any node that supports Bearer token via expression)
1. Add **AgentID Token** node; select the **AgentID OAuth2 API** credential.
2. Downstream node (e.g., HTTP Request, MCP Client, etc.): choose Bearer Auth (or set header) and set token to `{{$json.token}}` from the previous item.
3. Optional: also expose `{{$json.blueprintFic}}` and `{{$json.agentidFic}}` if needed for debugging.

## Use in n8n
1. In n8n, go to *Credentials* → *Create* → select **AgentID OAuth2 API**.
2. Fill fields:
   - Token Endpoint
   - Blueprint ID (client_id)
   - Blueprint Secret (client_secret)
   - Agent ID (fmi_path and later client_id)
   - Agent User (username in final step)
3. Save. n8n will run the three-step flow and cache the final token for the node.
4. In a node (HTTP Request, MCP Client, etc.), pick **AgentID OAuth2 API** as the authentication. The node will automatically send `Authorization: Bearer <token>`.

## Testing inside n8n
- Add the sample **AgentID Ping** node from this package. Provide a test URL (e.g., an echo endpoint). It uses the credential to fetch a token and performs a GET with the `Authorization` header attached.
- Alternatively, use a standard **HTTP Request** node with method/URL of your downstream API and select this credential.

## Notes
- Scope is hard-wired to `api://AzureADTokenExchange/.default` per requirements.
- Requests are form-url-encoded. The first call adds `fmi_path` as `agent_id`.
- `blueprint_fic` and `agentid_fic` are returned from pre-auth; the final token is used for Authorization.
