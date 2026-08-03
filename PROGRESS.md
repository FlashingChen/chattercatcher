# PROGRESS.md

## 任务 0 开工回执（2026-08-03）

- **目标**：文件任务可溯源（file_jobs 补 sha256 + 飞书 file_key）、gateway 开机自启（macOS launchd 真机 / Linux systemd 静态）、Docker 镜像一键跑。
- **顺序**：① 任务1 迁移+ingest 落列 → ② 任务2 服务安装 → ③ 任务3 Docker → ④ 任务4 文档收尾 → 反向验证红→绿。
- **风险**：better-sqlite3 原生模块镜像编译坑 → 基础镜像用 node:20-bookworm；服务文件只动自己两个；launchd 已有同名服务不覆盖。
- **基线**：node v25.9.0、npm test 68 文件 325 测试全绿、lint/build 全绿、docker 29.4.1 就绪。任务 0 核对全部通过。

## 任务 1：file_jobs 补列 + DDL 清理

- 已实现：file_jobs 加 `content_sha256`、`platform_file_key` 两列（PRAGMA+ALTER 迁移 + CREATE TABLE 同步）；ingest 时算内容 sha256 落列；飞书路径把 attachment.fileKey 传入落列；本地导入该列留空；删除重复的 feishu_chat_members 建表块。
- 存量 backfill：stored_path 文件还在就算 sha256 补写，文件不在留空不编造。
- 验证：npm test 69 文件 329 测试全绿（基线 68/325），lint/build 全绿。新增用例覆盖两列写入、重复 ingest 同路径 ID 不变、存量行迁移后行数不变。

## 任务 2：服务安装（launchd/systemd）

- 已实现：`chattercatcher service install/status/uninstall`。macOS 生成 `~/Library/LaunchAgents/com.chattercatcher.gateway.plist`（node + dist/cli.js + gateway start --foreground、KeepAlive、RunAtLoad、日志写 logs/gateway.log）；Linux 生成 `~/.config/systemd/user/chattercatcher-gateway.service` + 打印 enable --now 指引，标注「未真机验证」。
- 真机验证（macOS 2026-08-03）：install 后 launchctl list 可见 com.chattercatcher.gateway（pid=35542）、gateway status running；uninstall 后 launchctl 无该服务、plist 删除、service status 如实报「未安装」（非假绿灯）。反向验证红→绿均通过。
- 已有同名非本项目服务不覆盖（写 BLOCKED.md）。
- 验证：npm test 71 文件 335 测试全绿，lint/build 全绿。单测覆盖 plist（Label、路径、KeepAlive）与 unit（ExecStart、Restart、WorkingDirectory）。

## 任务 3：Docker 镜像

- 已实现：根目录多阶段 Dockerfile + .dockerignore，ENTRYPOINT ["node","dist/cli.js"]，ENV CHATTERCATCHER_HOME=/data，EXPOSE 3878。镜像内容检查无 /data、无 .chattercatcher、无密钥值。
- 真跑验证（2026-08-03，docker 29.4.1）：`docker build -t chattercatcher:test` 成功；`docker run --rm chattercatcher:test --help` 正常；`web start` 容器起后宿主 `curl /api/status` 返回 HTTP 200（详见对话输出）。
- 偏差说明：web.host 默认 127.0.0.1，且 src/config、src/web 不在白名单无法改监听地址；Docker `-p` 端口映射到不了容器 127.0.0.1（已实证）。因此宿主访问需在挂载卷写 config.json 设 web.host=0.0.0.0，文档会写明。非丢数据、非测试回归，仅宿主访问方式。

## 任务 4：收尾接线

- 已更新：TECHNICAL_ARCHITECTURE（file_jobs 溯源列、service 能力 launchd 真机/systemd 未验证、新增 Docker 章节）、DEVELOPMENT_PLAN（M3 三项标已实现，systemd 标未验证）、README（service 与 Docker 用法）、CHANGELOG（Unreleased 记三项新增）。
- 全量验证三连全绿：npm test 71 文件 / 335 测试 / skipped=0；npm run lint 与 npm run build 全绿；git status 只含白名单路径。

## 反向验证（必做）

1. 内容 sha256 计算改为固定字符串 → 新用例红（2 失败）；还原 → 绿（17 passed）。证据见对话。
2. launchd uninstall 后 `service status` 如实报「launchd 服务未安装。installed=false / running=false」，非假绿灯。证据见对话。

## 完成状态

- 任务 1/2/3/4 全部完成；BLOCKED.md 无阻塞项。

