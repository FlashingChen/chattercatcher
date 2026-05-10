import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeishuMessageSender } from "../../src/feishu/sender.js";

let testDir: string;

describe("FeishuMessageSender image sending", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-sender-image-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("uploads local image and sends Feishu image message", async () => {
    const imagePath = path.join(testDir, "order-code.jpg");
    await fs.writeFile(imagePath, Buffer.from("fake-image"));
    const uploads: unknown[] = [];
    const messages: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          image: {
            async create(payload) {
              uploads.push(payload);
              return { image_key: "img_uploaded" };
            },
          },
          message: {
            async create(payload) {
              messages.push(payload);
            },
          },
        },
      },
    });

    await sender.sendImageToChat("oc_family", imagePath);

    expect(uploads).toEqual([
      {
        data: {
          image_type: "message",
          image: Buffer.from("fake-image"),
        },
      },
    ]);
    expect(messages).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "image",
          content: JSON.stringify({ image_key: "img_uploaded" }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });
});
