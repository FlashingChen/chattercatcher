import type { AppConfig, AppSecrets } from "../config/schema.js";
import { CronJobRepository } from "../cron/jobs.js";
import type { CronJobTool } from "../cron/tools.js";
import { createCronJobTools } from "../cron/tools.js";
import type { SqliteDatabase } from "../db/database.js";
import { MessageRepository } from "../messages/repository.js";
import { createAgenticRagSearchTools } from "../rag/factory.js";
import { QaLogRepository } from "../rag/qa-logs.js";
import type { RagSearchTool } from "../rag/search-tools.js";
import type { ChatMessage, ChatModel, ChatTool, EvidenceBlock } from "../rag/types.js";
import { formatBeijingTimeForPrompt } from "../time/beijing.js";
import { FeishuMemberRepository, formatFeishuMemberPrompt } from "./members.js";
import type { FeishuMemberResolver } from "./members.js";
import type { MessageSender } from "./sender.js";
import type { FeishuReceiveMessageEvent } from "./normalize.js";

export interface FeishuQuestionHandlerOptions {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  model: ChatModel;
  sender: MessageSender;
  memberRepository?: FeishuMemberRepository;
  memberResolver?: Pick<FeishuMemberResolver, "resolveUniqueName">;
  thinkingEmojiType?: string;
}

export interface FeishuQuestionDecision {
  shouldAnswer: boolean;
  question?: string;
  chatId?: string;
  reason?: string;
}

function parseTextContent(content: string | undefined): string {
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return content;
  }
}

function stripMentions(text: string, mentions: NonNullable<NonNullable<FeishuReceiveMessageEvent["event"]>["message"]>["mentions"]): string {
  let result = text;

  for (const mention of mentions ?? []) {
    for (const token of [mention.key, mention.name, mention.name ? `@${mention.name}` : undefined]) {
      if (token) {
        result = result.replaceAll(token, " ");
      }
    }
  }

  return result.replace(/@/g, " ").replace(/\s+/g, " ").trim();
}

type FeishuExecutableTool = (RagSearchTool | CronJobTool) & ChatTool;

const FEISHU_TOOL_SYSTEM_PROMPT =
  `你是飞书群聊助手。你可以先搜索本地知识来回答问题；当用户明确要求创建、查看或删除群消息定时任务时，也可以调用定时任务工具。定时任务工具只管理当前群聊，不能跨群操作。若用户要求定时任务发送图片，只能使用当前群聊里已经下载入库的图片文件名，并在创建定时任务时把文件名填入 imageFileName；不要编造本地路径。若用户用自然语言描述时间，你需要先将其转换为五字段 cron 表达式（分 时 日 月 周），再调用工具。当前时间会提供给你。检索证据中的时间戳是消息被发送时的真实时间。回答时若涉及相对时间表述（如消息中说”明天””今晚”），必须基于证据中每条消息的时间戳推导为具体日期，不要照搬原文的相对表述。对于一般问答，先按需调用搜索工具，再基于工具返回的证据直接给出最终答案；若引用了检索结果，要在答案里直接写出引用内容。不要声称完成了未实际调用的操作。重要：你的回答必须是面向群成员的自然语言，绝对不能输出 JSON、工具调用细节或原始的搜索结果格式。用户只应看到你整合后的最终答案。`;

const DEFAULT_MAX_MODEL_TURNS = 4;
const DEFAULT_MAX_TOOL_CALLS = 8;
const FEISHU_TOOL_LOOP_FALLBACK = "定时任务操作已提交，但模型没有生成最终回复。";
const FEISHU_TOOL_LOOP_LIMIT_REACHED = "工具调用次数已达到上限，请缩小请求后重试。";

function containsRawToolCallMarkup(content: string): boolean {
  return /<｜｜DSML｜｜tool_calls>|<｜｜DSML｜｜invoke\s+name=|<tool_call>|<tool_calls>/i.test(content);
}

function toToolResultContent(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isEvidenceBlockArray(value: unknown): value is EvidenceBlock[] {
  return Array.isArray(value) && value.length > 0 && typeof (value[0] as EvidenceBlock)?.text === "string";
}

function formatEvidenceBlocks(blocks: EvidenceBlock[]): string {
  return blocks
    .map((block, index) => {
      const source = block.source;
      const sender = source.sender ? `${source.sender} ` : "";
      const timestamp = source.timestamp ? `(${source.timestamp.slice(0, 19).replace("T", " ")})` : "";
      const header = `[证据${index + 1}] ${sender}${timestamp}:`;
      return `${header}\n${block.text}`;
    })
    .join("\n\n");
}

function toToolErrorContent(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}

async function executeFeishuTool(tool: FeishuExecutableTool, input: unknown): Promise<string> {
  const result = await tool.execute(input);
  if (isEvidenceBlockArray(result)) {
    return formatEvidenceBlocks(result);
  }
  return toToolResultContent(result);
}

async function runFeishuToolLoop(input: {
  question: string;
  now: Date;
  model: ChatModel;
  tools: FeishuExecutableTool[];
  maxModelTurns?: number;
  maxToolCalls?: number;
  memberPrompt?: string;
  conversationContext?: string;
}): Promise<string> {
  if (!input.model.completeWithTools) {
    throw new Error("当前 LLM 客户端不支持工具调用。");
  }

  const maxModelTurns = input.maxModelTurns ?? DEFAULT_MAX_MODEL_TURNS;
  const maxToolCalls = input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const systemPromptParts = [FEISHU_TOOL_SYSTEM_PROMPT];
  if (input.memberPrompt) {
    systemPromptParts.push(`${input.memberPrompt}\n回答中遇到上述 ID 时优先使用对应群昵称；没有映射时保留原 ID，不要编造昵称。`);
  }
  if (input.conversationContext) {
    systemPromptParts.push(`${input.conversationContext}\n这些是当前群聊里最近几轮你和用户的问答，只作为理解省略指代和连续追问的上下文；如果与检索证据冲突，以检索证据为准。`);
  }
  const systemPrompt = systemPromptParts.join("\n\n");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `当前时间：${formatBeijingTimeForPrompt(input.now)}\n问题：${input.question}` },
  ];
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  let toolCallsUsed = 0;

  for (let turn = 0; turn < maxModelTurns; turn += 1) {
    const assistantResult = await input.model.completeWithTools(messages, input.tools);
    const hasRawToolCallMarkup = containsRawToolCallMarkup(assistantResult.content);
    messages.push({
      role: "assistant",
      content: assistantResult.content,
      toolCalls: assistantResult.toolCalls,
      reasoningContent: assistantResult.reasoningContent,
    });

    if (assistantResult.toolCalls.length === 0) {
      if (hasRawToolCallMarkup) {
        break;
      }
      return assistantResult.content || FEISHU_TOOL_LOOP_FALLBACK;
    }

    for (const toolCall of assistantResult.toolCalls) {
      if (toolCallsUsed >= maxToolCalls) {
        return FEISHU_TOOL_LOOP_LIMIT_REACHED;
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
        const result = await executeFeishuTool(tool, toolCall.input);
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result,
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

  // Salvage: try one final completion without tools to generate an answer
  try {
    const salvageAnswer = await input.model.complete([
      ...messages,
      { role: "system", content: "请基于以上所有工具返回的信息，直接给出最终答案。不要再调用工具。" },
    ]);
    return salvageAnswer || "抱歉，回答生成失败，请稍后重试。";
  } catch {
    return "抱歉，回答生成失败，请稍后重试。";
  }
}

function formatConversationContext(records: import("../rag/qa-logs.js").QaLogRecord[]): string {
  const lines = records
    .slice()
    .reverse()
    .map((record, index) => `第 ${index + 1} 轮\n用户：${record.question}\n助手：${record.answer}`);
  return lines.length ? `近期对话上下文：\n${lines.join("\n\n")}` : "";
}

type FeishuMessage = NonNullable<NonNullable<FeishuReceiveMessageEvent["event"]>["message"]>;
type FeishuMention = NonNullable<FeishuMessage["mentions"]>[number];

function isMentionForBot(mention: FeishuMention, config: AppConfig): boolean {
  if (!config.feishu.botOpenId) {
    return false;
  }

  return mention.id?.open_id === config.feishu.botOpenId;
}

function getBotMentions(payload: FeishuReceiveMessageEvent, config: AppConfig) {
  const message = payload.event?.message;
  return (message?.mentions ?? []).filter((mention) => isMentionForBot(mention, config));
}

export function isFeishuMessageAddressedToBot(payload: FeishuReceiveMessageEvent, config: AppConfig): boolean {
  const message = payload.event?.message;
  if (!message || message.message_type !== "text") {
    return false;
  }

  return getBotMentions(payload, config).length > 0;
}

export function getFeishuQuestionDecision(
  payload: FeishuReceiveMessageEvent,
  config: AppConfig,
): FeishuQuestionDecision {
  const message = payload.event?.message;
  if (!message?.chat_id || message.message_type !== "text") {
    return {
      shouldAnswer: false,
      reason: "不是可回答的文本消息。",
    };
  }

  const mentions = getBotMentions(payload, config);
  const text = parseTextContent(message.content);
  const hasMention = isFeishuMessageAddressedToBot(payload, config);

  if (config.feishu.requireMention && !hasMention) {
    return {
      shouldAnswer: false,
      reason: "群聊配置为必须 @ 后回答。",
    };
  }

  const question = stripMentions(text, mentions);
  if (!question) {
    return {
      shouldAnswer: false,
      reason: "没有可回答的问题文本。",
    };
  }

  return {
    shouldAnswer: true,
    question,
    chatId: message.chat_id,
  };
}

export class FeishuQuestionHandler {
  private memberResolver?: Pick<FeishuMemberResolver, "resolveUniqueName">;

  constructor(private readonly options: FeishuQuestionHandlerOptions) {
    this.memberResolver = options.memberResolver;
  }

  setMemberResolver(memberResolver: Pick<FeishuMemberResolver, "resolveUniqueName">): void {
    this.memberResolver = memberResolver;
  }

  private async sendResponse(chatId: string, messageId: string | undefined, text: string): Promise<void> {
    if (messageId && this.options.sender.replyTextToMessage) {
      try {
        await this.options.sender.replyTextToMessage(messageId, text);
        return;
      } catch (error) {
        console.log(`飞书回复原消息失败，退回群消息：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await this.options.sender.sendTextToChat(chatId, text);
  }

  private async acknowledgeQuestion(chatId: string, messageId: string | undefined): Promise<void> {
    if (!messageId) {
      return;
    }

    if (this.options.sender.addReactionToMessage) {
      try {
        await this.options.sender.addReactionToMessage(messageId, this.options.thinkingEmojiType ?? "OK");
        return;
      } catch (error) {
        console.log(`飞书提问表情反馈失败，改用文字反馈：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await this.sendResponse(chatId, messageId, "收到，正在查。");
  }

  async handle(
    payload: FeishuReceiveMessageEvent,
    options: { excludeMessageIds?: string[] } = {},
  ): Promise<FeishuQuestionDecision> {
    const decision = getFeishuQuestionDecision(payload, this.options.config);
    if (!decision.shouldAnswer || !decision.question || !decision.chatId) {
      return decision;
    }

    const questionMessageId = payload.event?.message?.message_id;
    const now = new Date();
    const qaLogs = new QaLogRepository(this.options.database);
    await this.acknowledgeQuestion(decision.chatId, questionMessageId);

    const { tools, close } = await createAgenticRagSearchTools({
      config: this.options.config,
      secrets: this.options.secrets,
      database: this.options.database,
      messages: new MessageRepository(this.options.database),
      excludeMessageIds: options.excludeMessageIds,
    });

    try {
      try {
        const cronTools = createCronJobTools({
          repository: new CronJobRepository(this.options.database),
          chatId: decision.chatId,
          createdByOpenId: payload.event?.sender?.sender_id?.open_id,
          memberResolver: this.memberResolver,
        });
        const allTools: FeishuExecutableTool[] = [...tools, ...cronTools];
        const memberRepository = this.options.memberRepository ?? new FeishuMemberRepository(this.options.database);
        const memberPrompt = formatFeishuMemberPrompt(memberRepository.listByChat(decision.chatId));
        const conversationContext = formatConversationContext(qaLogs.listRecentByChat(decision.chatId, 6));
        const answer = await runFeishuToolLoop({
          question: decision.question,
          now,
          tools: allTools,
          model: this.options.model,
          memberPrompt,
          conversationContext,
        });
        qaLogs.create({
          chatId: decision.chatId,
          questionMessageId,
          question: decision.question,
          answer,
          citations: [],
          retrievalDebug: {},
          status: "answered",
          createdAt: new Date().toISOString(),
        });
        await this.sendResponse(decision.chatId, questionMessageId, answer);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        qaLogs.create({
          chatId: decision.chatId,
          questionMessageId,
          question: decision.question,
          answer: `暂时无法回答：${message}`,
          citations: [],
          retrievalDebug: {},
          status: "failed",
          error: message,
          createdAt: new Date().toISOString(),
        });
        await this.sendResponse(decision.chatId, questionMessageId, `暂时无法回答：${message}`);
      }
      return decision;
    } finally {
      close();
    }
  }
}
