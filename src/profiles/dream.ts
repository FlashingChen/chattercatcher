import type { ChatModel } from "../rag/types.js";
import type { ProfileRepository } from "./repository.js";
import type { DreamMessageRecord, ProfileEntryType, ProfileEvidenceInput } from "./types.js";

interface ProfileDreamProcessorInput {
  profiles: ProfileRepository;
  model: ChatModel;
}

interface DreamUpdate {
  personId: string;
  category: string;
  entryType: ProfileEntryType;
  content: string;
  confidence: number;
  evidence: ProfileEvidenceInput[];
}

interface DreamOutput {
  updates: DreamUpdate[];
}

export interface ProfileDreamProcessResult {
  status: "succeeded" | "failed" | "skipped";
  processedMessageCount: number;
  generatedEntryCount: number;
  error?: string;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function parseDreamOutput(value: string): DreamOutput {
  const parsed = JSON.parse(stripJsonFence(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { updates?: unknown }).updates)) {
    throw new Error("Dream output must be a JSON object with updates array.");
  }
  return parsed as DreamOutput;
}

function buildPrompts(messages: DreamMessageRecord[], existingProfiles: unknown): { system: string; user: string } {
  return {
    system: [
      "你是 ChatterCatcher 的个人档案 Dream 处理器。",
      "只能基于输入消息提取人物档案变化。",
      "输出严格 JSON：{\"updates\":[{\"personId\":string,\"category\":string,\"entryType\":\"fact\"|\"inferred\",\"content\":string,\"confidence\":number,\"evidence\":[{\"messageId\":string,\"quote\":string,\"reason\":string}]}]}。",
      "没有足够证据时返回 {\"updates\":[]}。",
    ].join("\n"),
    user: JSON.stringify({ messages, existingProfiles }, null, 2),
  };
}

export class ProfileDreamProcessor {
  constructor(private readonly input: ProfileDreamProcessorInput) {}

  async processChat(input: { platform: string; platformChatId: string; limit?: number }): Promise<ProfileDreamProcessResult> {
    const startedAt = new Date().toISOString();
    const state = this.input.profiles.getDreamState(input.platform, input.platformChatId);
    const messages = this.input.profiles.listMessagesForDream({
      platform: input.platform,
      platformChatId: input.platformChatId,
      afterSentAt: state?.lastMessageSentAt,
      limit: input.limit ?? 100,
    });

    if (messages.length === 0) {
      const finishedAt = new Date().toISOString();
      this.input.profiles.recordDreamRun({
        platform: input.platform,
        platformChatId: input.platformChatId,
        status: "skipped",
        processedMessageCount: 0,
        generatedEntryCount: 0,
        startedAt,
        finishedAt,
      });
      return { status: "skipped", processedMessageCount: 0, generatedEntryCount: 0 };
    }

    try {
      const personIds = [...new Set(messages.map((message) => message.personId))];
      const existingProfiles = personIds.map((personId) => this.input.profiles.getPersonProfile(personId, { includeEvidence: false, includeInferred: true }));
      const prompts = buildPrompts(messages, existingProfiles);
      const raw = await this.input.model.complete([
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ]);
      const output = parseDreamOutput(raw);
      const messageIds = new Set(messages.map((message) => message.messageId));

      for (const update of output.updates) {
        this.validateUpdate(update, messageIds);
      }

      for (const update of output.updates) {
        this.input.profiles.upsertProfileEntry({
          personId: update.personId,
          category: update.category,
          content: update.content,
          entryType: update.entryType,
          confidence: update.confidence,
          source: "dream",
          evidence: update.evidence,
          observedAt: messages[messages.length - 1]!.sentAt,
        });
      }

      const lastMessage = messages[messages.length - 1]!;
      const finishedAt = new Date().toISOString();
      this.input.profiles.updateDreamState({
        platform: input.platform,
        platformChatId: input.platformChatId,
        lastMessageId: lastMessage.messageId,
        lastMessageSentAt: lastMessage.sentAt,
        updatedAt: finishedAt,
      });
      this.input.profiles.recordDreamRun({
        platform: input.platform,
        platformChatId: input.platformChatId,
        status: "succeeded",
        processedMessageCount: messages.length,
        generatedEntryCount: output.updates.length,
        startedAt,
        finishedAt,
      });

      return { status: "succeeded", processedMessageCount: messages.length, generatedEntryCount: output.updates.length };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.input.profiles.recordDreamRun({
        platform: input.platform,
        platformChatId: input.platformChatId,
        status: "failed",
        processedMessageCount: messages.length,
        generatedEntryCount: 0,
        error: message,
        startedAt,
        finishedAt,
      });
      return { status: "failed", processedMessageCount: messages.length, generatedEntryCount: 0, error: message };
    }
  }

  private validateUpdate(update: DreamUpdate, messageIds: Set<string>): void {
    if (!this.input.profiles.personExists(update.personId)) {
      throw new Error(`Unknown personId in dream output: ${update.personId}`);
    }
    if (update.entryType !== "fact" && update.entryType !== "inferred") {
      throw new Error("Dream update entryType must be fact or inferred.");
    }
    if (typeof update.confidence !== "number" || !Number.isFinite(update.confidence) || update.confidence < 0 || update.confidence > 1) {
      throw new Error("Dream update confidence must be a number between 0 and 1.");
    }
    if (!Array.isArray(update.evidence) || update.evidence.length === 0) {
      throw new Error("Dream update evidence is required.");
    }
    for (const evidence of update.evidence) {
      if (!messageIds.has(evidence.messageId)) {
        throw new Error(`Dream update evidence message is outside the processed batch: ${evidence.messageId}`);
      }
      if (!evidence.quote.trim() || !evidence.reason.trim()) {
        throw new Error("Dream update evidence quote and reason are required.");
      }
    }
    if (!update.category.trim() || !update.content.trim()) {
      throw new Error("Dream update category and content are required.");
    }
  }
}
