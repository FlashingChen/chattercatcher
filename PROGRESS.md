# PROGRESS.md

## 开工回执（2026-08-02）

- 目标：Web UI 增加配置编辑、数据导出、重建索引三能力（浏览器可做，PRD 要求）。
- 顺序：任务1 GET/PUT /api/config（授权+脱敏+部分更新）→ 任务2 POST /api/export → 任务3 设置页前端（表单+导出/重建按钮）→ 任务4 文档接线 + 三连全绿 → 反向验证（红→绿）。
- 最大风险：密钥脱敏泄漏（任何响应不许含完整 secret）、现有测试零回归（基线 68 文件/322 用例）、白名单路径越界。
- 让步顺序：密钥安全 > 现有测试零回归 > 三功能做完。
- 基线已核对：node v25.9.0、npm test 68/322 全绿、lint/build 通过。
- 未做「清空向量重来」，重建索引与 processMessagesNow 同函数共用 /api/process/messages（领导拍板）。

## 任务状态

- 任务 0：✅ 基线核对通过
- 任务 1：✅ GET/PUT /api/config（授权 403、脱敏、白名单部分更新、禁改 web.host/port/storage.dataDir 均有用例）commit 5c0068c
- 任务 2：✅ POST /api/export（授权 403、文件真实存在、导出不含密钥）commit 0fb4cd3
- 任务 3：✅ 设置页前端（配置表单 + 导出数据 / 重建索引按钮，secret placeholder「留空则不修改」）commit dad3e19；真实冒烟通过（curl 三端点 + 首页按钮 grep）
- 任务 4：✅ 文档接线（DEVELOPMENT_PLAN / TECHNICAL_ARCHITECTURE / README / CHANGELOG）+ 三连全绿 commit 98d3bc8
- 反向验证：✅ 两处红→绿（见下）

## 反向验证记录

1. 删掉 PUT /api/config 授权检查 → 配置用例变红 `expected 200 to be 403`（tests/web/server.test.ts:600）→ 还原全绿 8/8。
2. GET /api/config 临时返回原始 secrets → 脱敏用例变红 `expected ... not to contain 'test-secret'`（泄露 apiKey 与 actionToken）→ 还原全绿 8/8。
   server.ts 已与 HEAD 完全一致（git diff 为空）。

## 冒烟记录（任务 3，mktemp home）

- GET / 首页 grep：导出数据×2、重建索引×1
- GET /api/config（带 cookie）200 返回脱敏配置；无 cookie 403
- PUT /api/config 200 `已保存，gateway 重启后生效`，secret 脱敏 `test...3456`，无原文泄漏
- PUT 含 web.host → 400 明确拒绝
- POST /api/export 200 输出文件真实存在，导出文件无密钥泄漏
- 完成 kill 并清理 mktemp home

## 备注

- 全量 npm test 曾有 tests/rag/cli-index.test.ts 与 tests/profiles/cli.test.ts 并行负载下 5s spawn 超时抖动；单独跑与重跑全量均通过，与本次改动无关（这两个测试不依赖 server.ts）。


