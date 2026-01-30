import { AgentIdOAuth2Api } from './credentials/AgentIdOAuth2Api.credentials';
import { AgentIdPing } from './nodes/AgentIdPing.node';
import { AgentIdToken } from './nodes/AgentIdToken.node';

export const credentials = [AgentIdOAuth2Api];
export const nodes = [AgentIdPing, AgentIdToken];
