import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { loadSecrets, saveSecrets } from "../config/store.js";
import type { AppConfig } from "../config/schema.js";
import { CronJobRepository } from "../cron/jobs.js";
import { openDatabase } from "../db/database.js";
import { FileJobRepository } from "../files/jobs.js";
import { EpisodeRepository } from "../episodes/repository.js";
import { getGatewayStatus } from "../gateway/index.js";
import { MessageRepository } from "../messages/repository.js";
import { processMessagesNow } from "../rag/manual-index.js";
import { QaLogRepository } from "../rag/qa-logs.js";

function buildHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ChatterCatcher</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f5f0;
        --panel: #ffffff;
        --text: #1f2933;
        --muted: #667085;
        --line: #d9d7cf;
        --accent: #1f7a5a;
        --warn: #9a5b13;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 48px; overflow-x: hidden; }
      header {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: flex-start;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--line);
      }
      h1 { margin: 0; font-size: 30px; line-height: 1.1; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
      p { margin: 8px 0 0; color: var(--muted); }
      code { background: #eceae2; border-radius: 4px; padding: 2px 6px; }
      button {
        appearance: none;
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--text);
        border-radius: 6px;
        padding: 8px 12px;
        cursor: pointer;
      }
      button:hover { border-color: var(--accent); }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        margin: 24px 0;
      }
      .metric {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        min-height: 112px;
      }
      .label { color: var(--muted); font-size: 13px; }
      .value { margin-top: 10px; font-size: 22px; font-weight: 650; overflow-wrap: anywhere; line-height: 1.18; }
      .note { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.45; }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
        gap: 24px;
      }
      .layout > * { min-width: 0; }
      section { padding: 20px 0; border-top: 1px solid var(--line); }
      section:first-child { border-top: 0; }
      .message-list { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      .message-item { padding: 14px 16px; border-bottom: 1px solid var(--line); }
      .message-item:last-child { border-bottom: 0; }
      .message-meta { display: flex; flex-wrap: wrap; gap: 8px 14px; color: var(--muted); font-size: 13px; line-height: 1.4; }
      .message-body { margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      th, td { padding: 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow: hidden; text-overflow: ellipsis; }
      th { color: var(--muted); font-size: 13px; font-weight: 600; }
      tr:last-child td { border-bottom: 0; }
      .message { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .id-text, .path { display: block; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 13px; }
      .compact-table th:first-child, .compact-table td:first-child { width: 120px; }
      .compact-table th:nth-child(2), .compact-table td:nth-child(2) { width: 180px; }
      .status-ok { color: var(--accent); }
      .status-warn { color: var(--warn); }
      .empty { color: var(--muted); padding: 18px; background: var(--panel); border: 1px dashed var(--line); border-radius: 8px; }
      .status-line { margin-top: 10px; font-size: 13px; color: var(--muted); text-align: right; }
      @media (max-width: 900px) {
        header, .layout { display: block; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        header button { margin-top: 16px; }
      }
      @media (max-width: 560px) {
        main { padding: 24px 16px 36px; }
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>ChatterCatcher</h1>
          <p>本地优先的家庭群知识库。问答必须先检索 RAG 证据，不堆叠全量上下文。</p>
        </div>
        <div>
          <div class="actions">
            <button id="process-messages" type="button">立即处理</button>
          </div>
          <div id="action-status" class="status-line"></div>
        </div>
      </header>

      <div class="grid" id="metrics"></div>

      <div class="layout">
        <div>
          <section>
            <h2>最近消息</h2>
            <div id="messages" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>会话记忆</h2>
            <div id="episodes" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>问答日志</h2>
            <div id="qa-logs" class="empty">正在读取...</div>
          </section>
        </div>
        <aside>
          <section>
            <h2>群聊</h2>
            <div id="chats" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>文件库</h2>
            <div id="files" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>解析任务</h2>
            <div id="file-jobs" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>定时任务</h2>
            <div id="cron-jobs" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>本地操作</h2>
            <p><code>chattercatcher settings</code> 修改配置。</p>
            <p><code>chattercatcher files add &lt;path...&gt;</code> 导入文本、DOCX 或 PDF 文件。</p>
            <p><code>chattercatcher doctor</code> 检查飞书、模型、RAG 和本地存储。</p>
          </section>
        </aside>
      </div>
    </main>
    <script>
      const metrics = document.querySelector("#metrics");
      const messages = document.querySelector("#messages");
      const episodes = document.querySelector("#episodes");
      const chats = document.querySelector("#chats");
      const files = document.querySelector("#files");
      const fileJobs = document.querySelector("#file-jobs");
      const cronJobs = document.querySelector("#cron-jobs");
      const qaLogs = document.querySelector("#qa-logs");
      const processMessages = document.querySelector("#process-messages");
      const actionStatus = document.querySelector("#action-status");

      let webActionToken = "__WEB_ACTION_TOKEN__";

      function fmt(value) {
        return value == null || value === "" ? "-" : String(value);
      }

      function escapeHtml(value) {
        return fmt(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function isOpaqueId(value) {
        return /^(ou|oc|om|cli|on|un|uid)_?[a-z0-9]+/i.test(fmt(value));
      }

      function formatDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return fmt(value);
        const pad = (input) => String(input).padStart(2, "0");
        return [
          date.getFullYear(),
          pad(date.getMonth() + 1),
          pad(date.getDate()),
        ].join("/") + " " + [
          pad(date.getHours()),
          pad(date.getMinutes()),
          pad(date.getSeconds()),
        ].join(":");
      }

      function displaySender(value) {
        return isOpaqueId(value) ? "群成员" : fmt(value);
      }

      function displayChatName(value, platform) {
        if (!isOpaqueId(value)) return fmt(value);
        return platform === "feishu" ? "飞书群聊" : "群聊";
      }

      function formatGatewayValue(gateway) {
        if (gateway.connection === "running") return "运行中";
        if (!gateway.configured) return "未配置";
        return "待启动";
      }

      function formatGatewayNote(gateway) {
        if (gateway.connection === "running" && gateway.pid) return "PID " + gateway.pid;
        return "飞书长连接";
      }

      function renderMetrics(status) {
        const gatewayClass = status.gateway.configured ? "status-ok" : "status-warn";
        metrics.innerHTML = [
          ["Gateway", formatGatewayValue(status.gateway), formatGatewayNote(status.gateway), gatewayClass],
          ["版本", status.version || "unknown", "当前运行版本", ""],
          ["群聊", status.data.chats, "本地群聊数", ""],
          ["消息", status.data.messages, "已入库消息", ""],
          ["会话记忆", status.data.episodes, "已生成摘要", ""],
          ["文件", status.data.files, "文件知识源", ""],
        ].map(([label, value, note, extra]) => \`
          <div class="metric">
            <div class="label">\${escapeHtml(label)}</div>
            <div class="value \${extra}">\${escapeHtml(value)}</div>
            <div class="note">\${escapeHtml(note)}</div>
          </div>
        \`).join("");
      }

      function renderMessages(items) {
        if (items.length === 0) {
          messages.className = "empty";
          messages.textContent = "还没有消息。启动 Gateway 后，群聊文本会进入本地 RAG 索引。";
          return;
        }
        messages.className = "";
        messages.innerHTML = \`
          <div class="message-list">
              \${items.map((item) => \`
                <article class="message-item">
                  <div class="message-meta">
                    <span>\${escapeHtml(formatDateTime(item.sentAt))}</span>
                    <span>\${escapeHtml(displaySender(item.senderName))}</span>
                    <span>\${escapeHtml(displayChatName(item.chatName, item.platform))}</span>
                  </div>
                  <div class="message-body">\${escapeHtml(item.text)}</div>
                </article>
              \`).join("")}
          </div>
        \`;
      }

      function renderEpisodes(items) {
        if (items.length === 0) {
          episodes.className = "empty";
          episodes.textContent = "还没有会话记忆。默认在 10 分钟窗口静默 2 分钟后生成，也可以运行 chattercatcher process episodes 手动触发。";
          return;
        }
        episodes.className = "";
        episodes.innerHTML = \`
          <div class="message-list">
              \${items.map((item) => \`
                <article class="message-item">
                  <div class="message-meta">
                    <span>\${escapeHtml(formatDateTime(item.startedAt))} - \${escapeHtml(formatDateTime(item.endedAt))}</span>
                    <span>\${escapeHtml(displayChatName(item.chatName, "feishu"))}</span>
                    <span>\${escapeHtml(item.messageCount)} 条消息</span>
                  </div>
                  <div class="message-body">\${escapeHtml(item.summary)}</div>
                </article>
              \`).join("")}
          </div>
        \`;
      }

      function renderChats(items) {
        if (items.length === 0) {
          chats.className = "empty";
          chats.textContent = "还没有群聊记录。";
          return;
        }
        chats.className = "";
        chats.innerHTML = \`
          <table>
            <thead><tr><th>名称</th><th>平台</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td><span class="id-text" title="\${escapeHtml(item.name)}">\${escapeHtml(displayChatName(item.name, item.platform))}</span></td>
                  <td>\${escapeHtml(item.platform)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderFiles(items) {
        if (items.length === 0) {
          files.className = "empty";
          files.textContent = "还没有文件。可先运行 chattercatcher files add <path...> 导入文本、DOCX 或 PDF 文件。";
          return;
        }
        files.className = "";
        files.innerHTML = \`
          <table>
            <thead><tr><th>文件</th><th>解析器</th><th>字符</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>
                    <div>\${escapeHtml(item.fileName)}</div>
                    <div class="path" title="\${escapeHtml(item.storedPath)}">\${escapeHtml(item.storedPath)}</div>
                  </td>
                  <td>\${escapeHtml(item.parser || "unknown")}</td>
                  <td>\${escapeHtml(item.characters)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderFileJobs(items) {
        if (items.length === 0) {
          fileJobs.className = "empty";
          fileJobs.textContent = "还没有文件解析任务。";
          return;
        }
        fileJobs.className = "";
        fileJobs.innerHTML = \`
          <table>
            <thead><tr><th>任务</th><th>状态</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>
                    <div>\${escapeHtml(item.fileName)}</div>
                    <div class="path" title="\${escapeHtml(item.id)}">ID: \${escapeHtml(item.id)}</div>
                    <div class="path" title="\${escapeHtml(item.error || item.storedPath)}">\${escapeHtml(item.error || item.storedPath)}</div>
                  </td>
                  <td>\${escapeHtml(item.status)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderCronJobs(items) {
        if (items.length === 0) {
          cronJobs.className = "empty";
          cronJobs.textContent = "还没有定时任务。可在飞书群里 @ 机器人创建。";
          return;
        }
        cronJobs.className = "";
        cronJobs.innerHTML = \`
          <table>
            <thead><tr><th>任务</th><th>状态</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>
                    <div>\${escapeHtml(item.schedule)}</div>
                    <div class="message" title="\${escapeHtml(item.prompt)}">\${escapeHtml(item.prompt)}</div>
                    <div class="path" title="\${escapeHtml(item.id)}">ID: \${escapeHtml(item.id)}</div>
                    <div class="path" title="\${escapeHtml(item.chatId)}">群: \${escapeHtml(item.chatId)}</div>
                    <div class="path">下次: \${escapeHtml(formatDateTime(item.nextRunAt))}</div>
                    <div class="path" title="\${escapeHtml(item.lastError || "")}">\${escapeHtml(item.lastError || "")}</div>
                    \${item.status === "active" ? \`<button type="button" data-delete-cron-job="\${escapeHtml(item.id)}">删除</button>\` : ""}
                  </td>
                  <td>\${escapeHtml(item.status)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderQaLogs(items) {
        if (items.length === 0) {
          qaLogs.className = "empty";
          qaLogs.textContent = "还没有问答日志。";
          return;
        }
        qaLogs.className = "";
        const rows = items.map((item) => {
          const citationCount = Array.isArray(item.citations) ? item.citations.length : 0;
          return [
            '<article class="message-item">',
            '  <div class="message-meta">',
            "    <span>" + escapeHtml(formatDateTime(item.createdAt)) + "</span>",
            "    <span>" + escapeHtml(item.status) + "</span>",
            "    <span>" + escapeHtml(citationCount) + " 条引用</span>",
            "  </div>",
            "  <div class=\\\"message-body\\\"><strong>问：</strong>" + escapeHtml(item.question) + "</div>",
            "  <div class=\\\"message-body\\\"><strong>答：</strong>" + escapeHtml(item.answer) + "</div>",
            "</article>",
          ].join("\\n");
        });
        qaLogs.innerHTML = [
          '<div class="message-list">',
          rows.join(""),
          "</div>",
        ].join("\\n");
      }

      async function fetchJson(path) {
        const response = await fetch(path);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(path + " " + response.status + " " + body);
        }
        return response.json();
      }

      function renderLoadError(element, error) {
        element.className = "empty";
        element.textContent = "加载失败：" + (error instanceof Error ? error.message : String(error));
      }

      async function loadSection(path, element, render) {
        try {
          render(await fetchJson(path));
        } catch (error) {
          renderLoadError(element, error);
        }
      }

      async function load() {
        await Promise.all([
          loadSection("/api/status", metrics, renderMetrics),
          loadSection("/api/messages/recent?limit=20", messages, (data) => renderMessages(data.items)),
          loadSection("/api/episodes?limit=10", episodes, (data) => renderEpisodes(data.items)),
          loadSection("/api/chats", chats, (data) => renderChats(data.items)),
          loadSection("/api/files", files, (data) => renderFiles(data.items)),
          loadSection("/api/file-jobs", fileJobs, (data) => renderFileJobs(data.items)),
          loadSection("/api/qa-logs?limit=10", qaLogs, (data) => renderQaLogs(data.items)),
          loadSection("/api/cron-jobs", cronJobs, (data) => renderCronJobs(data.items)),
        ]);
      }

      async function processNow() {
        processMessages.disabled = true;
        actionStatus.textContent = "正在处理消息索引...";
        try {
          const response = await fetch("/api/process/messages", {
            method: "POST",
            headers: { "x-chattercatcher-web-token": webActionToken },
          });
          const result = await response.json();
          if (!response.ok) {
            actionStatus.textContent = result.message || "处理失败。";
            return;
          }

          if (result.status === "skipped") {
            actionStatus.textContent = result.reason;
          } else {
            actionStatus.textContent = \`处理完成：chunks=\${result.chunks}, vectors=\${result.vectors}\`;
          }
          await load();
        } catch (error) {
          actionStatus.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          processMessages.disabled = false;
        }
      }

      document.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const id = target.dataset.deleteCronJob;
        if (!id) return;
        target.setAttribute("disabled", "disabled");
        actionStatus.textContent = "正在删除定时任务...";
        try {
          const response = await fetch(\`/api/cron-jobs/\${encodeURIComponent(id)}\`, {
            method: "DELETE",
            headers: { "x-chattercatcher-web-token": webActionToken },
          });
          const result = await response.json();
          actionStatus.textContent = result.ok ? "定时任务已删除。" : result.message || "删除失败。";
          await load();
        } catch (error) {
          actionStatus.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          target.removeAttribute("disabled");
        }
      });

      processMessages.addEventListener("click", () => void processNow());
      void load();
      setInterval(() => {
        if (document.visibilityState === "visible") {
          void load();
        }
      }, 5000);
    </script>
  </body>
</html>`;
}

export interface WebAppOptions {
  version?: string;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const rawLimit = Number(value ?? fallback);
  return Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), max) : fallback;
}

function getWebActionToken(secrets: Awaited<ReturnType<typeof loadSecrets>>): string {
  return secrets.web.actionToken;
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorizedWebAction(request: { headers: Record<string, string | string[] | undefined> }, token: string): boolean {
  const provided = readHeader(request.headers["x-chattercatcher-web-token"]);
  return provided === token;
}


export function createWebApp(config: AppConfig, options: WebAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const database = openDatabase(config);
  const version = options.version ?? "unknown";
  const messages = new MessageRepository(database);
  const episodes = new EpisodeRepository(database);
  const fileJobs = new FileJobRepository(database);
  const qaLogs = new QaLogRepository(database);
  const cronJobs = new CronJobRepository(database);
  let webActionToken = "";
  const tokenReady = (async () => {
    const secrets = await loadSecrets();
    if (!secrets.web.actionToken) {
      secrets.web.actionToken = crypto.randomBytes(32).toString("hex");
      await saveSecrets(secrets);
    }
    webActionToken = getWebActionToken(secrets);
  })();

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/status", async () => {
    await tokenReady;
    return {
      app: "ChatterCatcher",
      version,
      gateway: getGatewayStatus(config),
      data: {
        chats: messages.getChatCount(),
        messages: messages.getMessageCount(),
        episodes: episodes.getEpisodeCount(),
        files: messages.listFiles(1_000).length,
        qaLogs: qaLogs.getCount(),
        cronJobs: cronJobs.list(1_000).length,
      },
      rag: {
        mode: "required",
        note: "问答必须先检索证据，禁止全量上下文堆叠。",
        retrieval: {
          keyword: "SQLite FTS5",
          vector: "SQLite embedding",
          hybrid: true,
        },
      },
      web: config.web,
    };
  });

  app.get("/api/chats", async () => ({
    items: messages.listChats(),
  }));

  app.get("/api/files", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    return {
      items: messages.listFiles(limit),
    };
  });

  app.get("/api/file-jobs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    const status = (request.query as { status?: string }).status;
    return {
      items: fileJobs.list(limit, status === "processing" || status === "indexed" || status === "failed" ? { status } : {}),
    };
  });

  app.get("/api/messages/recent", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: messages.listRecentMessages(limit),
    };
  });

  app.get("/api/episodes", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: episodes.listRecentEpisodes(limit),
    };
  });

  app.get("/api/qa-logs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: qaLogs.listRecent(limit),
    };
  });

  app.get("/api/cron-jobs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    return {
      items: cronJobs.list(limit),
    };
  });

  app.delete("/api/cron-jobs/:id", async (request, reply) => {
    await tokenReady;
    if (!isAuthorizedWebAction(request, webActionToken)) {
      reply.code(403);
      return { ok: false, message: "Web 操作未授权。" };
    }

    const id = (request.params as { id: string }).id;
    const job = cronJobs.get(id);
    if (!job) {
      reply.code(404);
      return { ok: false, message: "没有找到定时任务。" };
    }

    const ok = cronJobs.deleteByChat(id, job.chatId);
    return { ok };
  });

  app.post("/api/process/messages", async (request, reply) => {
    await tokenReady;
    if (!isAuthorizedWebAction(request, webActionToken)) {
      reply.code(403);
      return { status: "failed", message: "Web 操作未授权。" };
    }

    try {
      return await processMessagesNow({
        config,
        secrets: await loadSecrets(),
        database,
        limit: 10_000,
      });
    } catch (error) {
      reply.code(500);
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  app.get("/", async (_request, reply) => {
    await tokenReady;
    reply.type("text/html; charset=utf-8");
    return buildHtml().replaceAll("__WEB_ACTION_TOKEN__", webActionToken);
  });

  return app;
}

export async function startWebServer(config: AppConfig, options: WebAppOptions = {}): Promise<void> {
  const app = createWebApp(config, options);
  await app.listen({ host: config.web.host, port: config.web.port });
  const address = app.server.address();
  const url =
    typeof address === "string" ? address : `http://${config.web.host}:${address?.port ?? config.web.port}`;
  const versionText = options.version ? ` ${options.version}` : "";
  console.log(`ChatterCatcher Web UI${versionText}: ${url}`);
}
