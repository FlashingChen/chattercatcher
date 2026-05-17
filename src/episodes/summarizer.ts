import { formatBeijingTimeForPrompt } from "../time/beijing.js";
import type { ChatModel } from "../rag/types.js";
import type { EpisodeWindow } from "./repository.js";
import { sanitizeEpisodeSummary } from "./sanitizer.js";

export async function summarizeEpisodeWindow(window: EpisodeWindow, model: ChatModel, now: Date): Promise<string> {
  const transcript = window.messages
    .map((message) => `[${message.sentAt}] ${message.senderName}：${message.text}`)
    .join("\n");

  const summary = await model.complete([
    {
      role: "system",
      content:
        "你是 ChatterCatcher 的会话记忆整理模块。你的任务是把碎片化闲聊整理成可检索事实，补全短消息、代词、缩写与上下文之间的关系。只总结明确事实，不要编造。保留重要数字、日期、链接、文件名和代码；如果图片转述里出现文件名，必须在摘要中原样保留该文件名，方便之后按文件名找回图片。如果内容像密码、API key、token 或密钥，只描述其上下文关系，不要在摘要中复写原文。消息里的“今天”“明天”“昨晚”“下周三”等相对时间表述，请基于每条消息前的发送时间戳推导为具体日期写入摘要。例如 [2026-05-05T20:00:00.000Z] 妈妈说“明天要用丝丝露”，摘要应写为“2026-05-06 要用丝丝露”。",
    },
    {
      role: "user",
      content: `当前时间：${formatBeijingTimeForPrompt(now)}\n群聊：${window.chatName}\n时间：${window.startedAt} - ${window.endedAt}\n\n聊天记录：\n${transcript}\n\n请输出一段简洁的会话记忆摘要。`,
    },
  ]);

  return sanitizeEpisodeSummary(summary);
}
