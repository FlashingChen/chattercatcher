import { describe, expect, it, vi } from "vitest";
import { createCronJobScheduler } from "../../src/cron/scheduler.js";
import type { CronJobRecord, CronJobRepository } from "../../src/cron/jobs.js";

function job(input: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: input.id ?? "job-1",
    chatId: input.chatId ?? "chat-a",
    schedule: input.schedule ?? "0 9 * * *",
    prompt: input.prompt ?? "总结",
    status: input.status ?? "active",
    nextRunAt: input.nextRunAt ?? "2026-05-05T09:00:00.000Z",
    createdAt: input.createdAt ?? "2026-05-05T08:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-05T08:00:00.000Z",
    ...(input.imageFileName ? { imageFileName: input.imageFileName } : {}),
    ...(input.mentionTargetName ? { mentionTargetName: input.mentionTargetName } : {}),
    ...(input.mentionOpenId ? { mentionOpenId: input.mentionOpenId } : {}),
    ...(input.mentionUserId ? { mentionUserId: input.mentionUserId } : {}),
  };
}

describe("createCronJobScheduler", () => {
  it("runs due jobs and marks success", async () => {
    const due = job();
    const repository = {
      listDue: vi.fn(() => [due]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const send = vi.fn(async () => undefined);
    const generate = vi.fn(async () => "定时总结");
    const now = () => new Date("2026-05-05T09:00:00.000Z");

    const scheduler = createCronJobScheduler({ repository, generateMessage: generate, sendTextToChat: send, now });
    await scheduler.runDueNow();

    expect(generate).toHaveBeenCalledWith(due, now());
    expect(send).toHaveBeenCalledWith("chat-a", "定时总结");
    expect(repository.markSuccess).toHaveBeenCalledWith("job-1", now());
  });

  it("sends configured image after due job text", async () => {
    const due = job({ imageFileName: "order-code.jpg" });
    const repository = {
      listDue: vi.fn(() => [due]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const sendText = vi.fn(async () => undefined);
    const sendImage = vi.fn(async () => undefined);
    const now = () => new Date("2026-05-05T09:00:00.000Z");

    const scheduler = createCronJobScheduler({
      repository,
      generateMessage: async () => "记得取餐",
      sendTextToChat: sendText,
      sendImageToChat: sendImage,
      now,
    });
    await scheduler.runDueNow();

    expect(sendText).toHaveBeenCalledWith("chat-a", "记得取餐");
    expect(sendImage).toHaveBeenCalledWith("chat-a", "order-code.jpg");
    expect(repository.markSuccess).toHaveBeenCalledWith("job-1", now());
  });

  it("sends due jobs with resolved mention metadata", async () => {
    const due = job({ mentionTargetName: "妈妈", mentionOpenId: "ou_mom" });
    const repository = {
      listDue: vi.fn(() => [due]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const send = vi.fn(async () => undefined);
    const now = () => new Date("2026-05-05T09:00:00.000Z");

    const scheduler = createCronJobScheduler({ repository, generateMessage: async () => "记得带水杯", sendTextToChat: send, now });
    await scheduler.runDueNow();

    expect(send).toHaveBeenCalledWith("chat-a", "记得带水杯", {
      mentions: [{ openId: "ou_mom", name: "妈妈" }],
    });
  });

  it("records failure and continues other jobs", async () => {
    const repository = {
      listDue: vi.fn(() => [job({ id: "job-1" }), job({ id: "job-2" })]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const generate = vi.fn(async (record: CronJobRecord) => {
      if (record.id === "job-1") throw new Error("LLM 请求失败");
      return "第二条";
    });
    const send = vi.fn(async () => undefined);
    const now = () => new Date("2026-05-05T09:00:00.000Z");

    const scheduler = createCronJobScheduler({ repository, generateMessage: generate, sendTextToChat: send, now });
    await scheduler.runDueNow();

    expect(repository.markFailure).toHaveBeenCalledWith("job-1", "LLM 请求失败", now());
    expect(repository.markSuccess).toHaveBeenCalledWith("job-2", now());
  });

  it("does not overlap while a run is active", async () => {
    let release = false;
    const repository = {
      listDue: vi.fn(() => [job()]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const generate = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (release) resolve();
          else queueMicrotask(poll);
        };
        poll();
      });
      return "定时总结";
    });
    const scheduler = createCronJobScheduler({
      repository,
      generateMessage: generate,
      sendTextToChat: async () => undefined,
      now: () => new Date("2026-05-05T09:00:00.000Z"),
    });

    const first = scheduler.runDueNow();
    await Promise.resolve();
    await scheduler.runDueNow();
    expect(generate).toHaveBeenCalledTimes(1);
    release = true;
    await first;
  });

  it("starts with an immediate due-job run before arming interval ticks", async () => {
    const due = job();
    const repository = {
      listDue: vi.fn(() => [due]),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    } as unknown as CronJobRepository;
    const send = vi.fn(async () => undefined);
    const setIntervalFn = vi.fn(() => 123 as unknown as ReturnType<typeof setInterval>);
    const scheduler = createCronJobScheduler({
      repository,
      generateMessage: async () => "启动时发送",
      sendTextToChat: send,
      setIntervalFn,
      now: () => new Date("2026-05-05T09:00:00.000Z"),
    });

    scheduler.start();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("chat-a", "启动时发送"));

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(repository.markSuccess).toHaveBeenCalledWith("job-1", new Date("2026-05-05T09:00:00.000Z"));
  });

  it("starts and stops a minute interval", () => {
    const timer = 123 as unknown as ReturnType<typeof setInterval>;
    const setIntervalFn = vi.fn(() => timer);
    const clearIntervalFn = vi.fn();
    const scheduler = createCronJobScheduler({
      repository: { listDue: vi.fn(() => []), markSuccess: vi.fn(), markFailure: vi.fn() } as unknown as CronJobRepository,
      generateMessage: async () => "",
      sendTextToChat: async () => undefined,
      setIntervalFn,
      clearIntervalFn,
    });

    scheduler.start();
    scheduler.start();
    scheduler.stop();

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn.mock.calls[0]).toEqual([expect.any(Function), 60_000]);
    expect(clearIntervalFn).toHaveBeenCalledWith(timer);
  });
});
