import { IExecuteFunctions, IDataObject, INodeType, INodeTypeDescription } from 'n8n-workflow';

export class AgentIdPing implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AgentID Ping',
		name: 'agentIdPing',
		icon: 'fa:paper-plane',
		group: ['transform'],
		version: 1,
		description: 'Simple GET request using the AgentID OAuth2 credential',
		defaults: {
			name: 'AgentID Ping',
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
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				description: 'Endpoint to call with the retrieved token',
			},
		],
	};

	async execute(this: IExecuteFunctions) {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const response = await this.helpers.httpRequest({
				method: 'GET',
				url,
			});

			returnData.push({ status: 200, data: response } as IDataObject);
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
