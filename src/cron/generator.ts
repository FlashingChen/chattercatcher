import type { RagSearchTool } from "../rag/search-tools.js";
import type { ChatMessage, ChatModel, EvidenceBlock } from "../rag/types.js";

interface GenerateCronJobMessageInput {
  prompt: string;
  model: ChatModel;
  tools: RagSearchTool[];
  now: Date;
  maxModelTurns?: number;
  maxToolCalls?: number;
}

const SYSTEM_PROMPT =
  "你正在为飞书群生成一条定时消息。可以先调用搜索工具检索本地群聊知识库。最终输出必须是可以直接发到群里的纯文本，不要输出工具调用说明。";

function evidenceToText(evidence: EvidenceBlock[]): string {
  if (evidence.length === 0) {
    return "无检索证据。";
  }

  return evidence.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
}

function toolResultContent(results: EvidenceBlock[]): string {
  return JSON.stringify(results.map((item) => ({ id: item.id, text: item.text, score: item.score, source: item.source })));
}

export async function generateCronJobMessage(input: GenerateCronJobMessageInput): Promise<string> {
  if (!input.model.completeWithTools) {
    throw new Error("当前 LLM 客户端不支持工具调用。");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `当前时间：${input.now.toISOString()}\n任务提示词：${input.prompt}` },
  ];
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const evidence: EvidenceBlock[] = [];
  const maxModelTurns = input.maxModelTurns ?? 3;
  const maxToolCalls = input.maxToolCalls ?? 6;
  let toolCallsUsed = 0;

  for (let turn = 0; turn < maxModelTurns; turn += 1) {
    const result = await input.model.completeWithTools(messages, input.tools);
    messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls, reasoningContent: result.reasoningContent });

    if (result.toolCalls.length === 0) {
      break;
    }

    for (const call of result.toolCalls) {
      if (toolCallsUsed >= maxToolCalls) {
        return input.model.complete([
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `当前时间：${input.now.toISOString()}\n任务提示词：${input.prompt}\n\n证据：\n${evidenceToText(evidence)}`,
          },
        ]);
      }

      toolCallsUsed += 1;
      const tool = toolsByName.get(call.name);
      if (!tool) {
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: `未知工具：${call.name}` }) });
        continue;
      }

      try {
        const results = await tool.execute(call.input);
        evidence.push(...results);
        messages.push({ role: "tool", toolCallId: call.id, content: toolResultContent(results) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: message }) });
      }
    }
  }

  return input.model.complete([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `当前时间：${input.now.toISOString()}\n任务提示词：${input.prompt}\n\n证据：\n${evidenceToText(evidence)}`,
    },
  ]);
}
