# BLOCKED.md（待裁决清单）

无。所有任务按文档完成，无阻塞项。

顺手观察（不影响本次交付，记录备查）：
- `src/db/database.ts` 中 `feishu_chat_members` 建表语句出现重复定义（原文件 240 行附近与 270 行附近相同 DDL，为历史遗留冗余），`CREATE TABLE IF NOT EXISTS` 保证幂等，无行为影响，未改动。
