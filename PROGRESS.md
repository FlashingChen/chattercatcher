# PROGRESS.md

## 开工回执（2026-08-02）

- 目标：语音转写 + 图片 OCR 文字提取，均走远程 API，进知识库可检索可引用。
- 基线核对：node v25.9.0（≥20）✓；npm test 65 文件/303 测试全绿 ✓；lint、build 全绿 ✓。
- 顺序：1 transcription 配置段 → 2 语音转写管道 → 3 图片 OCR → 4 收尾接线 + 反向验证。
- 最大风险：OCR 提取不能回归现有 multimodal 测试（extractedText 为空时行为必须一字不差）；音频管道 mock 只能打在 fetch 网络边界。
- 参照系：图片管线照抄（image_multimodal_tasks → ImageMultimodalWorker → describeImage → createImageSummaryMessage）。

## 任务 1（已完成，commit f7f5852）

- transcription 配置段 + secrets 段 + createDefault 覆盖；cli setup 交互项、settings show 脱敏展示。
- tests/config 15 个全绿（新增 3 个 transcription 用例）；lint/build 全绿。

## 任务 2（已完成）

- audio_transcription_tasks 表、AudioTranscriptionTaskRepository、OpenAICompatibleTranscriptionModel（POST /audio/transcriptions multipart）、AudioTranscriptionWorker、createAudioTranscriptMessage、ingest audio 分支入队、gateway 触发、cli 接线。
- 转写文本 100% 来自 API 返回，attempts≥3 标失败。
- multimodal+gateway 50 全绿；全量 68 文件/317 测试全绿，skipped=0。
