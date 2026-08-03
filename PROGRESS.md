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

（未开工）

## 任务 4：收尾接线

（未开工）
