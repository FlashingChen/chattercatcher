export type SourceType = "message" | "episode" | "file" | "image" | "audio" | "link" | "feishu_doc" | "person_profile";

export interface EvidenceSource {
  type: SourceType;
  label: string;
  timestamp?: string;
  sender?: string;
  senderId?: string;
  personId?: string;
  profileAvailable?: boolean;
  location?: string;
}

export interface EvidenceBlock {
  id: string;
  text: string;
  score: number;
  source: EvidenceSource;
}

export interface Citation {
  marker: string;
  evidenceId: string;
  source: EvidenceSource;
  text: string;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  reasoningContent?: string;
}

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolChatResult {
  content: string;
  toolCalls: ToolCall[];
  reasoningContent?: string;
}

export interface ChatModel {
  complete(messages: ChatMessage[]): Promise<string>;
  completeWithTools?(messages: ChatMessage[], tools: ChatTool[]): Promise<ToolChatResult>;
}
