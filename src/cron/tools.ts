import type { ChatTool } from "../rag/types.js";
import type { CronJobRepository } from "./jobs.js";

export interface CronJobTool extends ChatTool {
  execute(input: unknown): Promise<string>;
}

interface CreateCronJobToolsInput {
  repository: CronJobRepository;
  chatId: string;
  createdByOpenId?: string;
}

function readString(input: unknown, key: string): string {
  const value =
    typeof input === "object" && input !== null && key in input
      ? (input as Record<string, unknown>)[key]
      : undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} 必须是非空字符串。`);
  }
  return value.trim();
}

function readOptionalString(input: unknown, key: string): string | undefined {
  const value =
    typeof input === "object" && input !== null && key in input
      ? (input as Record<string, unknown>)[key]
      : undefined;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} 必须是字符串。`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function createCronJobTools(input: CreateCronJobToolsInput): CronJobTool[] {
  return [
    {
      name: "create_cron_job",
      description:
        "Create a scheduled AI message for the current Feishu chat only. The schedule must be a five-field cron string.",
      inputSchema: {
        type: "object",
        properties: {
          schedule: {
            type: "string",
            description: "Five-field cron schedule, for example 0 9 * * *.",
          },
          prompt: {
            type: "string",
            description: "Prompt used later to generate the scheduled message.",
          },
          imageFileName: {
            type: "string",
            description: "Optional image filename already stored from the current chat, for example om_xxx-image.jpg.",
          },
        },
        required: ["schedule", "prompt"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const job = input.repository.create({
          chatId: input.chatId,
          createdByOpenId: input.createdByOpenId,
          schedule: readString(rawInput, "schedule"),
          prompt: readString(rawInput, "prompt"),
          imageFileName: readOptionalString(rawInput, "imageFileName"),
        });
        return JSON.stringify({ ok: true, job });
      },
    },
    {
      name: "list_cron_jobs",
      description: "List active scheduled AI messages for the current Feishu chat only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => JSON.stringify({ ok: true, jobs: input.repository.listByChat(input.chatId) }),
    },
    {
      name: "delete_cron_job",
      description: "Delete a scheduled AI message by ID, only if it belongs to the current Feishu chat.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Cron job ID returned by create_cron_job or list_cron_jobs.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (rawInput) => {
        const id = readString(rawInput, "id");
        const ok = input.repository.deleteByChat(id, input.chatId);
        return JSON.stringify({
          ok,
          id,
          message: ok ? "定时任务已删除。" : "没有找到当前群里的这个定时任务。",
        });
      },
    },
  ];
}
