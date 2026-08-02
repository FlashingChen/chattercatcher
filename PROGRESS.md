# PROGRESS.md

## 开工回执（2026-08-02）

- 目标：语音转写 + 图片 OCR 文字提取，均走远程 API，进知识库可检索可引用。
- 基线核对：node v25.9.0（≥20）✓；npm test 65 文件/303 测试全绿 ✓；lint、build 全绿 ✓。
- 顺序：1 transcription 配置段 → 2 语音转写管道 → 3 图片 OCR → 4 收尾接线 + 反向验证。
- 最大风险：OCR 提取不能回归现有 multimodal 测试（extractedText 为空时行为必须一字不差）；音频管道 mock 只能打在 fetch 网络边界。
- 参照系：图片管线照抄（image_multimodal_tasks → ImageMultimodalWorker → describeImage → createImageSummaryMessage）。
