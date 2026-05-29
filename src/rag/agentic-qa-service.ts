import { formatBeijingTimeForPrompt } from "../time/beijing.js";
import { generateGroundedAnswer } from "./answer.js";
import type { RagSearchTool } from "./search-tools.js";
import type { ChatMessage, ChatModel, EvidenceBlock, GroundedAnswer } from "./types.js";

export interface AskWithAgenticRagInput {
  question: string;
  tools: RagSearchTool[];
  model: ChatModel;
  maxModelTurns?: number;
  maxToolCalls?: number;
  maxEvidence?: number;
  now?: Date;
}

const DEFAULT_MAX_MODEL_TURNS = 4;
const DEFAULT_MAX_TOOL_CALLS = 8;
const DEFAULT_MAX_EVIDENCE = 12;
const NO_EVIDENCE_ANSWER = "不知道。当前本地知识库没有检索到足够证据。";

const AGENTIC_SYSTEM_PROMPT =
  "你是本地知识信息收集代理。你的职责是围绕用户问题决定是否调用搜索工具、选择合适的工具和查询词，并根据当前结果决定是否继续搜索。不要编造任何证据或声称看过未检索到的内容。你的输出只用于收集证据，最终答案会由另一个基于证据的步骤生成。检索证据中的时间戳是消息被发送时的真实时间。若问题或证据包含“今天”“明天”“今晚”等相对时间表述，必须基于当前时间和证据时间戳推导为具体日期。如果可用 get_person_profile / search_person_messages 工具，用于按人检索 profile 记录和消息证据：get_person_profile 获取某人的已知事实和推断；search_person_messages 仅搜该人发送过的消息。";

function toToolResultContent(results: EvidenceBlock[]): string {
  return JSON.stringify(
    results.map((item) => ({
      id: item.id,
      text: item.text,
      score: item.score,
      source: item.source,
    })),
  );
}

function toToolErrorContent(message: string): string {
  return JSON.stringify({ error: message });
}

function dedupeEvidence(evidence: EvidenceBlock[], maxEvidence: number): EvidenceBlock[] {
  const deduped: EvidenceBlock[] = [];
  const seen = new Set<string>();

  for (const item of evidence) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    deduped.push(item);

    if (deduped.length >= maxEvidence) {
      break;
    }
  }

  return deduped;
}

export async function askWithAgenticRag(input: AskWithAgenticRagInput): Promise<GroundedAnswer> {
  if (!input.model.completeWithTools) {
    throw new Error("当前 LLM 客户端不支持工具调用。");
  }

  const now = input.now ?? new Date();
  const maxModelTurns = input.maxModelTurns ?? DEFAULT_MAX_MODEL_TURNS;
  const maxToolCalls = input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxEvidence = input.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  const messages: ChatMessage[] = [
    { role: "system", content: AGENTIC_SYSTEM_PROMPT },
    { role: "user", content: `当前时间：${formatBeijingTimeForPrompt(now)}
问题：${input.question}` },
  ];
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  let evidence: EvidenceBlock[] = [];
  let toolCallsUsed = 0;

  for (let turn = 0; turn < maxModelTurns; turn += 1) {
    const assistantResult = await input.model.completeWithTools(messages, input.tools);
    messages.push({
      role: "assistant",
      content: assistantResult.content,
      toolCalls: assistantResult.toolCalls,
      reasoningContent: assistantResult.reasoningContent,
    });

    if (assistantResult.toolCalls.length === 0) {
      break;
    }

    for (const toolCall of assistantResult.toolCalls) {
      if (toolCallsUsed >= maxToolCalls) {
        break;
      }

      toolCallsUsed += 1;
      const tool = toolsByName.get(toolCall.name);

      if (!tool) {
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: toToolErrorContent(`未知工具：${toolCall.name}`),
        });
        continue;
      }

      try {
        const results = await tool.execute(toolCall.input);
        evidence = dedupeEvidence([...evidence, ...results], maxEvidence);
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: toToolResultContent(results),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: toToolErrorContent(message),
        });
      }
    }
  }

  if (evidence.length === 0) {
    return {
      answer: NO_EVIDENCE_ANSWER,
      citations: [],
    };
  }

  return generateGroundedAnswer({
    question: input.question,
    evidence,
    model: input.model,
    now,
  });
}
