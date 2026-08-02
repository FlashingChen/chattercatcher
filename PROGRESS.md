# PROGRESS

## 进度
- [x] 任务 0 基线核对（62/295 全绿，lint/build 通过）
- [x] 任务 1 XLSX：jszip+cheerio 手写解析，多工作表/共享字符串中文验证通过；提交 feat: 添加 XLSX 解析支持
- [x] 任务 2 PPTX：jszip 解压 + cheerio 提 `<a:t>`，按 slide 数字排序保证顺序；多页中文验证通过
- [x] 任务 3 HTML：cheerio 去 script/style/nav/head 等取正文，脚本内容与导航不在输出中
- [ ] 任务 4 收尾接线 + 反向验证
- 注：parser.ts 为单一原子文件，三种格式分支同住其中，随任务 1 首次引入一并提交；后续任务只补测试与文档。

## 理解的目标
- .xlsx/.pptx/.html/.htm 解析出文本进知识库，中文不乱码、每工作表/每页/正文不丢。

## 任务 0 核对（2026-08-02）
- node v25.9.0（≥20 OK）；npm test 62 文件 / 295 测试全绿；lint(tsc) 退出 0；build(tsup) 成功。基线吻合。

## 依赖选型决策（2026-08-02）
- registry.npmjs.org 网络飘忽（ECONNRESET/ETIMEDOUT，85s 超时）。exceljs 拖几十个传递包，安装面太大。
- 改为 jszip（已在依赖树，mammoth 传递依赖，本地声明零下载）+ cheerio（单包）。手写 OOXML 解析覆盖 xlsx/pptx，cheerio 负责 html。三种格式只新增 cheerio 一个下载。冒烟测试验证中文/命名空间均正常。

## 执行顺序
1. XLSX：jszip 解压 + cheerio 提 sharedStrings/sheet 单元格 → fixture+测试+commit
2. PPTX：jszip 解压 + cheerio 提 `<a:t>`（照架构文档「先解压 XML 提取」）→ commit
3. HTML：cheerio 去 script/style/nav 取正文（readability 依赖太重，放弃，cheerio 单独达标）→ commit
4. 接线：describeSupportedParseTypes 文案 + 架构文档/CHANGELOG + 全量三连 + 反向验证 → commit

## 最大风险
- 手写 xlsx 解析对日期序列号只输出数字原值（格式化为日期需解析 styles.xml，复杂度高，接受局限并记录）。
- pptx 幻灯片顺序：jszip 文件名是字典序，需按 slide 数字排序。
- npm 依赖再遇网络失败 → 换 npmmirror registry 只装本包（不改全局配置），理由记 PROGRESS.md。
