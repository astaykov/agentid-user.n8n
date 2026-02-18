import { URLSearchParams } from 'url';
import {
	IExecuteFunctions,
	IDataObject,
	IHttpRequestOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

const DEFAULT_SCOPE = 'api://AzureADTokenExchange/.default';

interface CachedToken {
	token: string;
	expiresAt: number;
}

interface TokenResponse {
	access_token: string;
	expires_in?: number;
}

// Token cache for all three tokens with independent expiration tracking
class TokenCache {
	private cache: Map<string, CachedToken> = new Map();
	// Buffer time in seconds to refresh token before actual expiration
	private readonly EXPIRY_BUFFER = 180;

	private generateKey(prefix: string, params: Record<string, string>): string {
		const sortedParams = Object.keys(params)
			.sort()
			.map(key => `${key}=${params[key]}`)
			.join('&');
		return `${prefix}:${sortedParams}`;
	}

	get(prefix: string, params: Record<string, string>): string | null {
		const key = this.generateKey(prefix, params);
		const cached = this.cache.get(key);
		
		if (!cached) {
			return null;
		}
		
		// Check if token is still valid (with buffer)
		const now = Date.now();
		if (cached.expiresAt <= now) {
			// Token expired, remove from cache
			this.cache.delete(key);
			return null;
		}
		
		return cached.token;
	}

	set(prefix: string, params: Record<string, string>, token: string, expiresIn: number): void {
		const key = this.generateKey(prefix, params);
		// Calculate expiration time with buffer
		const expiresAt = Date.now() + ((expiresIn - this.EXPIRY_BUFFER) * 1000);
		
		this.cache.set(key, {
			token,
			expiresAt,
		});
	}

	clear(): void {
		this.cache.clear();
	}
}

// Global token cache instance
const tokenCache = new TokenCache();

export class AgentIdToken implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AgentID Token',
		name: 'agentIdToken',
		icon: 'fa:key',
		group: ['transform'],
		version: 1,
		description: 'Retrieve AgentID access token using the Entra Agent ID Platform OAuth2 flow',
		defaults: {
			name: 'AgentID Token',
			color: '#1A82E2',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'agentIdOAuth2Api',
				required: true,
			},
		],
		properties: [],
	};

	async execute(this: IExecuteFunctions) {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const cacheStats = { hits: 0, misses: 0, timings: {} as Record<string, number> };

		for (let i = 0; i < items.length; i++) {
			const debugLog: string[] = [];
			const log = (msg: string) => {
				const ts = new Date().toISOString();
				debugLog.push(`[${ts}] ${msg}`);
				this.logger.info(`[AgentIdToken] ${msg}`);
			};

			log(`--- Starting item ${i} ---`);
			const credentials = await this.getCredentials('agentIdOAuth2Api');
			const tokenEndpoint = credentials.tokenEndpoint as string;
			const userScope = (credentials.scope as string | undefined) || DEFAULT_SCOPE;

			log(`Token endpoint: ${tokenEndpoint}`);
			log(`Scope: ${userScope}`);
			log(`Blueprint ID: ${(credentials.blueprintId as string).substring(0, 8)}...`);
			log(`Agent ID: ${(credentials.agentId as string).substring(0, 8)}...`);
			log(`Agent User: ${credentials.agentUser as string}`);

			const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
			const encodeBody = (form: Record<string, string>) => new URLSearchParams(form).toString();

			// Redact sensitive values for debug output
			const redactForm = (form: Record<string, string>): Record<string, string> => {
				const redacted: Record<string, string> = {};
				for (const [k, v] of Object.entries(form)) {
					if (['client_secret', 'client_assertion', 'user_federated_identity_credential'].includes(k)) {
						redacted[k] = v ? `${v.substring(0, 20)}...[${v.length} chars]` : '(empty)';
					} else {
						redacted[k] = v;
					}
				}
				return redacted;
			};

			const request = async (stepName: string, form: Record<string, string>) => {
				const body = encodeBody(form);
				const options: IHttpRequestOptions = {
					method: 'POST',
					url: tokenEndpoint,
					headers,
					body: body,
				};
				log(`[${stepName}] POST ${tokenEndpoint}`);
				log(`[${stepName}] Form params: ${JSON.stringify(redactForm(form))}`);
				try {
					const resp = await (this.helpers.httpRequest(options) as Promise<TokenResponse>);
					log(`[${stepName}] SUCCESS - got access_token (${resp.access_token?.length || 0} chars), expires_in=${resp.expires_in ?? 'N/A'}`);
					return resp;
				} catch (err: unknown) {
					const error = err as Record<string, unknown>;
					const responseBody = (error.response as Record<string, unknown>)?.data
						?? (error.response as Record<string, unknown>)?.body
						?? error.message
						?? 'unknown error';
					const statusCode = (error.response as Record<string, unknown>)?.status
						?? (error.response as Record<string, unknown>)?.statusCode
						?? 'N/A';
					log(`[${stepName}] FAILED - status=${statusCode}`);
					log(`[${stepName}] Error response: ${typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)}`);
					log(`[${stepName}] Full error keys: ${Object.keys(error).join(', ')}`);
					// Rethrow with enriched message
					const enrichedMsg = `[${stepName}] HTTP ${statusCode}: ${typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)}`;
					const newError = new Error(enrichedMsg) as Error & { debugLog: string[] };
					newError.debugLog = debugLog;
					throw newError;
				}
			};

			// Helper function to get or fetch tokens with expiration-based caching
			const getOrFetchToken = async (
				cachePrefix: string,
				form: Record<string, string>,
				defaultExpiry: number = 3600
			): Promise<string> => {
				// Check cache first
				const cachedToken = tokenCache.get(cachePrefix, form);
				if (cachedToken) {
					cacheStats.hits++;
					cacheStats.timings[cachePrefix] = 0; // Cache hit = 0ms
					log(`[${cachePrefix}] Cache HIT`);
					return cachedToken;
				}

				// Fetch new token
				log(`[${cachePrefix}] Cache MISS - fetching...`);
				cacheStats.misses++;
				const startTime = Date.now();
				const response = await request(cachePrefix, form);
				const elapsed = Date.now() - startTime;
				const expiresIn = response.expires_in || defaultExpiry;
				
				cacheStats.timings[cachePrefix] = elapsed;
				log(`[${cachePrefix}] Cached with expiresIn=${expiresIn}s, fetch took ${elapsed}ms`);
				
				// Cache the token
				tokenCache.set(cachePrefix, form, response.access_token, expiresIn);
				
				return response.access_token;
			};

			// 1) Blueprint FIC - cached independently based on its expiration
			const blueprintForm = {
				grant_type: 'client_credentials',
				client_id: credentials.blueprintId as string,
				client_secret: credentials.blueprintSecret as string,
				scope: DEFAULT_SCOPE,
				fmi_path: credentials.agentId as string,
			};
			const blueprintFic = await getOrFetchToken('blueprint', blueprintForm);

			// 2) AgentID FIC - cached independently based on its expiration
			const agentFicForm = {
				grant_type: 'client_credentials',
				client_id: credentials.agentId as string,
				scope: DEFAULT_SCOPE,
				client_assertion: blueprintFic,
				client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
			};
			const agentidFic = await getOrFetchToken('agentFic', agentFicForm);

			// 3) User token - cached independently based on its expiration
			const userTokenForm = {
				grant_type: 'user_fic',
				requested_token_use: 'on_behalf_of',
				client_id: credentials.agentId as string,
				client_assertion: blueprintFic,
				client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
				username: credentials.agentUser as string,
				user_federated_identity_credential: agentidFic,
				scope: userScope,
			};
			let userToken: string;
			try {
				userToken = await getOrFetchToken('userToken', userTokenForm);
			} catch (err: unknown) {
				// On failure, return debug log as output so user can see what happened
				const error = err as Error & { debugLog?: string[] };
				returnData.push({
					error: error.message,
					debug_log: error.debugLog || debugLog,
					cache_info: {
						node_version: '0.1.8',
						cache_hits: cacheStats.hits,
						cache_misses: cacheStats.misses,
						fetch_times_ms: cacheStats.timings,
					},
				});
				throw error;
			}

			log(`--- Completed item ${i} successfully ---`);
			returnData.push({
				access_token: userToken,
				blueprint_token: blueprintFic,
				agent_token: agentidFic,
				scope: userScope,
				debug_log: debugLog,
				cache_info: {
					node_version: '0.1.8',
					cache_hits: cacheStats.hits,
					cache_misses: cacheStats.misses,
					fetch_times_ms: cacheStats.timings,
					total_fetch_time_ms: Object.values(cacheStats.timings).reduce((a, b) => a + b, 0),
				},
			});
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
