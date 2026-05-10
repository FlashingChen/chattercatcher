export interface ChatRecord {
  id: string;
  platform: string;
  platformChatId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  platform: string;
  platformMessageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  messageType: string;
  text: string;
  rawPayloadJson: string;
  sentAt: string;
  receivedAt: string;
  createdAt: string;
}

export interface FileRecord {
  messageId: string;
  fileName: string;
  sourcePath?: string;
  storedPath?: string;
  bytes?: number;
  characters: number;
  parser?: string;
  parserWarnings?: string[];
  importedAt: string;
}

export interface IngestMessageInput {
  platform: string;
  platformChatId: string;
  chatName: string;
  platformMessageId: string;
  senderId: string;
  senderName: string;
  messageType: string;
  text: string;
  rawPayload?: unknown;
  sentAt: string;
}

export interface CreateImageSummaryMessageInput {
  sourceMessageId: string;
  imageKey: string;
  imageFileName?: string;
  summary: string;
  reason?: string;
  multimodalModel: string;
  generatedAt: string;
}

export interface MessageSearchScope {
  platform?: string;
  platformChatId?: string;
}

export interface MessageSearchResult {
  chunkId: string;
  messageId: string;
  platform: string;
  text: string;
  score: number;
  messageType: string;
  chatName: string;
  senderName: string;
  sentAt: string;
}
