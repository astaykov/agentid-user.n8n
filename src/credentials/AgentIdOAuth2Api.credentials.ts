import { URLSearchParams } from 'url';
import {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

interface TokenResponse {
	access_token: string;
	expires_in?: number;
	token_type?: string;
}

const DEFAULT_SCOPE = 'api://AzureADTokenExchange/.default';

export class AgentIdOAuth2Api implements ICredentialType {
	name = 'agentIdOAuth2Api';
	// Visible label in the UI
	displayName = 'AgentID OAuth2 API';
	documentationUrl = '';

	properties: INodeProperties[] = [
		{
			displayName: 'Token Endpoint',
			name: 'tokenEndpoint',
			type: 'string',
			default: '',
			required: true,
			description: 'OAuth2 token endpoint URL',
		},
		{
			displayName: 'Blueprint ID (client_id of the Agent Blueprint)',
			name: 'blueprintId',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Blueprint Secret (client_secret)',
			name: 'blueprintSecret',
			type: 'string',
			default: '',
			required: true,
			typeOptions: {
				password: true,
			},
		},
		{
			displayName: 'Agent ID',
			name: 'agentId',
			type: 'string',
			default: '',
			required: true,
			description: 'This is the object id of the Agent Identity',
		},
		{
			displayName: 'Agent User',
			name: 'agentUser',
			type: 'string',
			default: '',
			required: true,
			description: 'Username of the Agent User to impersonate. This is used in the Digital Worker / Digital Employee scenario.',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'string',
			default: DEFAULT_SCOPE,
			required: false,
			description: 'Provide the scope for the requested resource access.',
		},
	];

	// Fetches tokens before each node run; final accessToken will be injected automatically.
	// n8n caches the result of this method, so tokens are reused between executions
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const tokenEndpoint = credentials.tokenEndpoint as string;
		const userScope = (credentials.scope as string | undefined) || DEFAULT_SCOPE;
		const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

		const encodeBody = (form: Record<string, string>) => new URLSearchParams(form).toString();

		const request = async (form: Record<string, string>): Promise<TokenResponse> => {
			const options: IHttpRequestOptions = {
				method: 'POST',
				url: tokenEndpoint,
				headers,
				body: encodeBody(form),
			};
			return this.helpers.httpRequest(options) as Promise<TokenResponse>;
		};

		// 1) Blueprint FIC
		const blueprintForm = {
			grant_type: 'client_credentials',
			client_id: credentials.blueprintId as string,
			client_secret: credentials.blueprintSecret as string,
			scope: DEFAULT_SCOPE,
			fmi_path: credentials.agentId as string,
		};
		const blueprintToken = await request(blueprintForm);
		const blueprintFic = blueprintToken.access_token;

		// 2) AgentID FIC with client assertion
		const agentFicForm = {
			grant_type: 'client_credentials',
			client_id: credentials.agentId as string,
			scope: DEFAULT_SCOPE,
			client_assertion: blueprintFic,
			client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		};
		const agentFicToken = await request(agentFicForm);
		const agentidFic = agentFicToken.access_token;

		// 3) User token (OBO style)
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
		const userToken = await request(userTokenForm);

		return {
			accessToken: userToken.access_token,
			blueprintFic,
			agentidFic,
		};
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{"Bearer " + $authentication.accessToken}}',
			},
		},
	};

	test = {
		request: {
			method: 'POST' as const,
			url: '={{$credentials.tokenEndpoint}}',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body:
				'grant_type=client_credentials&client_id={{$credentials.blueprintId}}&client_secret={{$credentials.blueprintSecret}}&scope=' +
				DEFAULT_SCOPE +
				'&fmi_path={{$credentials.agentId}}',
		},
	};
}
