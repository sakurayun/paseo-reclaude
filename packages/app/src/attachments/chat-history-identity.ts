export interface ChatHistorySourceIdentity {
  serverId: string;
  agentId: string;
}

/** Stable source identity for maps and sets. */
export function getChatHistorySourceKey(source: ChatHistorySourceIdentity): string {
  return JSON.stringify([source.serverId, source.agentId]);
}

/** Stable draft attachment identity for a source session. */
export function buildChatHistoryAttachmentId(source: ChatHistorySourceIdentity): string {
  return `chat_history:${source.serverId}:${source.agentId}`;
}
