import type { ToolCall } from "./types.js";

export interface QaTrace {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  status?: "answered" | "failed";
  finalAnswer?: string;
  modelTurns?: QaTraceModelTurn[];
  toolResults?: QaTraceToolResult[];
  fallbacks?: QaTraceFallback[];
}

export interface QaTraceModelTurn {
  index: number;
  content: string;
  reasoningContent?: string;
  toolCalls: ToolCall[];
  createdAt: string;
}

export interface QaTraceToolResult {
  toolCallId: string;
  name: string;
  input: unknown;
  content?: string;
  error?: string;
  createdAt: string;
}

export interface QaTraceFallback {
  type: "raw_tool_markup" | "tool_limit" | "salvage_completion" | "answer_generation_failed";
  message: string;
  createdAt: string;
}

export function hasQaTrace(trace: QaTrace): boolean {
  return Object.keys(trace).length > 0;
}
