# Token Caching Implementation

## Overview
Implemented a hybrid token caching strategy that leverages n8n's built-in credential caching where possible, and adds custom expiration-based caching for intermediate tokens.

## Architecture

### 1. **n8n Built-in Credential Caching**
The credentials file (`AgentIdOAuth2Api.credentials.ts`) relies on n8n's native caching:
- The `preAuthentication` method returns all three tokens
- n8n automatically caches the entire result object
- Cache persists until workflow restart or credential modification
- No custom expiration logic needed here

### 2. **Custom Per-Token Expiration Cache**
The AgentIdToken node implements expiration-based caching for all three tokens:
- **Blueprint FIC Token** - Cached independently with its own expiration
- **AgentID FIC Token** - Cached independently with its own expiration
- **User Token** - Cached independently with its own expiration

### Why This Approach?

**Credentials File**: Uses n8n's built-in caching for simplicity and reliability
- Benefit: Leverages n8n's infrastructure
- Trade-off: No per-token expiration awareness
- Good for: Nodes using the credential for authentication

**AgentIdToken Node**: Implements custom caching with per-token expiration tracking
- Benefit: Each token expires based on its own `expires_in` value
- Benefit: Avoids unnecessary API calls when tokens are still valid
- Benefit: Optimal - only fetches tokens that have actually expired
- Good for: When you need explicit access to all three tokens with maximum efficiency

## Key Features

### TokenCache Class
- In-memory caching for all three tokens
- Generates unique cache keys based on request parameters
- Validates token expiration before returning cached tokens
- 60-second expiry buffer to refresh tokens before they expire

### Expiration Handling
- Uses `expires_in` value from token response
- Fallback to 3600 seconds (1 hour) if not provided
- Automatically removes expired tokens from cache
- 60-second buffer to avoid using tokens near expiration

### Cache Key Generation
Cache keys are generated from:
- Cache prefix (token type: `blueprint`, `agentFic`, or `userToken`)
- Sorted request parameters
- Example: `blueprint:client_id=xxx&grant_type=client_credentials&scope=...`

## Files Modified

### AgentIdOAuth2Api.credentials.ts
- Removed custom caching implementation
- Relies on n8n's native credential caching
- Fetches all three tokens in `preAuthentication`

### AgentIdToken.node.ts
- Added `TokenCache` class
- Caches all three tokens (Blueprint FIC, AgentID FIC, and User Token)
- Each token expires independently based on its own `expires_in` value

## Benefits

- **Reduced API Calls**: Reuses valid intermediate tokens
- **Better Performance**: Faster execution by avoiding redundant network requests
- **Lower Rate Limit Risk**: Fewer token endpoint calls
- **Automatic Expiration**: Tokens refresh when they expire
- **Hybrid Approach**: Leverages n8n built-ins while adding custom logic where needed

## Usage

### For Credential-based Authentication
Use the AgentID OAuth2 credential with any node - n8n handles token caching automatically.

### For Explicit Token Access
Use the AgentIdToken node:
1. Checks cache for Blueprint FIC (uses cached if valid, fetches if expired)
2. Checks cache for AgentID FIC (uses cached if valid, fetches if expired)
3. Checks cache for User Token (uses cached if valid, fetches if expired)
4. Returns all three tokens

## Notes

- Token cache is in-memory and clears on n8n restart
- Each token type maintains its own cache entries with independent expiration
- Cache keys are unique per credential set
- All tokens are cached and only re-fetched when they expire
