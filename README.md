# 碰个头 / CampusTogether

校园兴趣社区与可解释组队平台，个人 Vibe Coding 参赛项目。账号与基本讨论、最小竞赛招募草稿及事务发布已通过本机验收。申请审核、入队、群聊、AI 和管理仍在后续阶段。

核心视觉暂定 **新粗野主义**：奶油白、黑边框、硬阴影、明亮分区色。设计原型见 design/campus-brutal-concept.html；原型内数据不计为应用功能。

记录入口：[持续开发日志](DEVELOPMENT_LOG.md) · [最新详细记录](docs/development/2026-10-20.md) · [集成验收](docs/weekly/W1_06_INTEGRATION_REVIEW.md) · [参赛材料核对表](docs/competition/SUBMISSION_CHECKLIST.md) · [AI 证据索引](docs/ai/README.md)。

源码已上传到[公开 GitHub 仓库](https://github.com/ray2481359244-dev/campus-together)，默认分支为 `master`，保留从文档基线开始的完整提交历史。

获取代码：

```powershell
git clone https://github.com/ray2481359244-dev/campus-together.git
Set-Location campus-together
```

下文 `E:\比赛项目` 是当前开发电脑的位置；克隆后在你自己的仓库根目录执行相同命令即可。

## 环境与启动（Windows PowerShell）

Windows 已安装依赖时，可以直接双击根目录的 **启动平台.cmd**。保留该窗口运行，再访问 http://127.0.0.1:5173/ 。已运行时会给出地址，不再启动重复服务。

打不开时先运行 `pnpm.cmd doctor`（或 `node scripts/doctor.mjs`）。诊断只读取配置与运行状态，不打印密钥、不清理数据、不结束其他程序：

- `STOPPED`：网页未启动，执行 `pnpm.cmd local` 或双击启动入口。
- `RUNNING`：本项目网页、API 与数据库均就绪，直接打开提示地址。
- `DATABASE_UNAVAILABLE`：网页和 API 可达，数据库不可用，检查数据库终端或运行 `pnpm.cmd db:local`。
- `PORT_CONFLICT`：端口被其他程序、旧版服务或其他检出目录占用；先检查原开发终端，不能直接结束未知程序。
- `ENVIRONMENT_ERROR`：按提示安装 Node / 依赖或配置环境。若是刚克隆、没有 `.env`，先 `pnpm.cmd setup`。

需要 Node.js **24 LTS** 与 pnpm **11.5.1**。依赖已经锁定，首次下载速度取决于网络；尚未完成干净环境 10 分钟复现测试。

```powershell
Set-Location 'E:\比赛项目'
pnpm.cmd install --frozen-lockfile
pnpm.cmd setup
pnpm.cmd db:local
```

保持数据库终端打开。另开终端，在项目根目录执行：

```powershell
pnpm.cmd db:generate
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd dev
```

访问 http://127.0.0.1:5173 。开发 API 监听 127.0.0.1:3001，浏览器通过 Vite 的 `/api` 代理访问。请使用 127.0.0.1，避免与 localhost 混用导致 Cookie / Origin 不一致。

依赖安装完成后，也可以在一个终端执行 `pnpm.cmd local`：自动保留/生成 `.env`、启动本地数据库、生成客户端、应用迁移、导入明确标识的演示内容并启动前后端。已存在的数据不会清空。当前电脑已准备好依赖；请先停止旧的开发进程，避免 3001 / 5173 被占用。Ctrl+C 关闭开发进程，数据库可另用 `pnpm db:stop` 停止。

`pnpm setup` 生成随机本地数据库密码到忽略的 `.env`，不覆盖既有文件。此处不需要模型密钥。

`pnpm local` 会先检查本项目实例和端口。若仅网页或 API 仍在运行，先在其原终端正常停止，再重新启动；不会自动抢占端口。配置外部 PostgreSQL 时跳过本地数据库管理，直接连接你已准备好的数据库。开发网页固定 5173，若修改 API 的 `PORT`，通过 `pnpm dev` / `pnpm local` 启动时会同步代理。

### 本地数据库

- 本机没有 Docker，默认使用锁定的 embedded-postgres 开发组件提供真正的 PostgreSQL 18.4；组件包版本含 beta 标记，仅用于本地开发。生产可连接普通 PostgreSQL，不依赖此启动器。
- Windows 的 PostgreSQL 二进制不能可靠处理中文路径。启动器把运行文件与持久化数据放到 `%LOCALAPPDATA%\CampusTogether\<项目路径摘要>`，路径写在忽略的 `.local/runtime.json` 中；不是临时内存数据库。不要删除该目录来“重置”项目。
- 仅监听 `127.0.0.1:5432`，Ctrl+C 安全停止。重开同一命令继续使用原数据，不注册 Windows 系统服务。
- 也可自行提供 PostgreSQL 18，把 `.env` 的 `DATABASE_URL` / `TEST_DATABASE_URL` 改为实际地址，跳过 `db:local`。已有 Docker 的机器可参考 `infra/compose.yaml`，自行设置 `POSTGRES_PASSWORD` 并对应更新 `.env`，不与本地数据库同时占用 5432。
- `campus_test` 是独立测试库，测试脚本拒绝对主库执行清理。

### 演示内容

`APP_MODE=DEMO` 才创建演示账号和帖子，均为虚构。账号 `river@campus.invalid`、`lin@campus.invalid`，密码均为 `DemoCampus2026!`。该密码仅用于本地演示；正式运行用 `STANDARD` 并自行注册，不采用演示账号。

两所学校均标记“虚构演示”；学校、技能为自述，邮箱未核验。标准模式 seed 不创建演示账号与讨论，但参考学校仍需在真实试用前由负责人补齐。

## 验证

```powershell
pnpm.cmd db:check
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd test:e2e
pnpm.cmd test:recruitment-recovery
pnpm.cmd test:startup
pnpm.cmd test:serve
```

测试与浏览器验收命令、已运行结果随实际实现记录在 docs/PROGRESS.md。失败的命令不算通过；当前不能据 README 文案推断尚未实现的功能已经完成。

`test` 与 `test:e2e` 使用独立 `campus_test`，会清理该测试库的用户与讨论，不能指向有用数据。浏览器验收测试最终构建，运行前先 `pnpm build`。Windows 默认用已安装 Microsoft Edge；其他系统先按 Playwright 说明安装对应测试浏览器。E2E 服务只在 3101 监听，测试后回收。

`pnpm test:persistence` 会短暂重启本项目专用本地 PostgreSQL，同时只向独立测试库写入验证内容；不要在其他人使用本地演示时执行。不适用于外部数据库。它已验证帖子与服务端会话在 API 和 PostgreSQL 重启后保留。

`pnpm test:recruitment-recovery` 在构建和 `test:e2e` 生成测试演示数据后运行：仅在独立测试库写入两份验证草稿，重启专用 3102 API，验证创建标识、删除标记和会话保留。验证通过后删除本次仍存在的草稿，结束时回收该 API。它不重启主 PostgreSQL，不复用未知端口占用；需要测试库已有明确的 DEMO 账号。

构建后可停止开发进程，执行 `pnpm start` 在 http://127.0.0.1:3001 同域运行构建产物；这条本地路径也支持写入。未来 HTTPS 部署需单独设置 `NODE_ENV=production` 与 `SERVE_ORIGIN`，不能直接将本地演示配置公开发布。

`pnpm db:stop` 安全停止专用本地 PostgreSQL。数据不删除，之后用 `pnpm db:local` 再启动。

10 月 16 日已完成一次[同机独立目录复现](docs/reproduction/2026-10-16.md)：使用既有离线依赖缓存、全新环境与数据库，构建版注册和发帖通过。原始失败和耗时均记录；尚未完成干净新机器首次网络安装验证。`test:serve` 在已构建后检查隐藏父目录的网页深链接及 API 404 边界。

工程：`apps/web` 前端、`apps/server` API、`packages/contracts` 共享校验与 DTO、`prisma` 迁移与 seed、`docs` 决策和过程记录。新粗野主义概念稿只作视觉参考，运行数据来自 API 与 PostgreSQL。

## 开发节奏与参赛证据

10 月 20 日按 W1-06 闭合昨天的创建恢复缺口：创建已提交但响应未知时，继续修改后保存会先找回原草稿，再按原版本保存当前内容；删除的草稿不能由旧请求重建，他页修改不被静默覆盖。数据库 48 / 48、完整浏览器 21 / 21、类型 / 构建及专用 API 重启检查通过。新增创建记录表回填既有数据，十类业务表迁移前后数量与摘要一致；主预览持续运行。[当日日志](docs/development/2026-10-20.md)保留真实复现与边界，10 月 21 日照常复盘。

10 月 19 日按 W1-05 补齐讨论发布恢复：服务器保存成功但响应丢失时，点击“核对并完成发布”返回原帖，并发重试也只创建一条。结果未知时本页内容保持锁定，确认成功后可继续编辑；明确主题校验失败可修正。数据库 42 / 42、浏览器 21 / 21、类型和构建通过，真实服务 / PostgreSQL 重启后帖子、会话与发布重试标识仍保留。主库增量迁移前后既有讨论内容一致；关闭 / 刷新页面仍无自动备份保证。详见 [当天记录](docs/development/2026-10-19.md)。

同日继续提前推进 W1-06，补齐招募草稿 / 来源讨论首次读取失败后的重试；编辑中的后台失败保留表单和输入，读取较新版本不悄悄切换提交基准；草稿在他页发布 / 删除后停止写入并保留本页文字。[集成演示与失败状态检查](docs/weekly/W1_06_INTEGRATION_REVIEW.md)提供完整演示路径和实际边界。用户已明确允许每次验收后自动上传现有公开 GitHub 仓库，归档前仍检查凭据与私人资料。

10 月 17 日继续提前推进 W1-04，补齐跳转主内容、键盘四区切换、讨论详情 Esc 返回 / 焦点恢复、搜索前进后退同步和清除搜索。保持原交互动画，主要辅助文字和手机控件更清楚；320 / 390 / 768 / 1440px 长内容检查与原流程共 19 项浏览器回归通过。[UI 体验与验收](docs/weekly/W1_04_UI_REVIEW.md)。该日期是实际执行日，原计划日为 10 月 18 日；周复盘仍为 10 月 21 日。

10 月 17 日按 W1-03 复核账号与资料：注册账号、最少资料与新会话改为同事务；普通标签页共用登录 Cookie，另一个标签页注销 / 切换账号时显示恢复提示。界面携带预期账号，服务端拒绝旧账号页面误用新账号 Cookie 写入；凭证重试保留原身份，旧请求迟到的结果不会恢复已退出的账号。普通保存失败保留输入，身份变化时清除旧缓存和未提交表单，已保存草稿仍属于原账号。[账号体验与边界](docs/weekly/W1_03_ACCOUNT_REVIEW.md)。

10 月 16 日继续推进首周挑战 W1-S1：从「招募」进入竞赛招募大厅，保存私有草稿，补齐比赛、时间、岗位和总人数后预览确认发布。总人数包含队长，发布成功会真实创建队伍与岗位关系；刷新和其他账号可读取。也可从自己的竞赛讨论发起关联招募。

当前只开放竞赛区、申请审核模式的发布部分；已发布招募只读，尚不能申请、批准、加入或聊天。游戏 / 学习 / 户外招募表单和完整队伍生命周期尚未接入。聊天空间仅保存关联元数据。[体验与验收步骤](docs/weekly/W1_S1_RECRUITMENT.md)明确当前边界，不能把讨论帖子当作已实现的组队流程。

按 docs/DEVELOPMENT_PLAN_v1.1.md 的每周 30—40 小时滚动推进，第 7 天填写真实总结并制定下一周。当前 Git 提交按实际功能节点产生，不重写为虚构历史。

docs/ai 包含过程摘要和真实可见文本对话快照，两者均明确范围；至少三条完整核心迭代 Prompt 链仍需继续真实积累和归档。访谈、真实 AI 调用、同学试用、性能数据及比赛视频均不伪造。GitHub 源码归档与应用公开部署分别记录；当前不公开部署应用、不购买资源。
