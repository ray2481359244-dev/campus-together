# 碰个头 / CampusTogether

校园兴趣社区与可解释组队平台，个人 Vibe Coding 参赛项目。首周账号与基本讨论核心已通过本机验收；完整参赛平台仍在分阶段开发，招募、群聊、AI 和管理模块尚未完成。

核心视觉暂定 **新粗野主义**：奶油白、黑边框、硬阴影、明亮分区色。设计原型见 design/campus-brutal-concept.html；原型内数据不计为应用功能。

记录入口：[持续开发日志](DEVELOPMENT_LOG.md) · [2026-10-15 详细记录](docs/development/2026-10-15.md) · [参赛材料核对表](docs/competition/SUBMISSION_CHECKLIST.md) · [AI 证据索引](docs/ai/README.md)。

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
pnpm.cmd test:startup
```

测试与浏览器验收命令、已运行结果随实际实现记录在 docs/PROGRESS.md。失败的命令不算通过；当前不能据 README 文案推断尚未实现的功能已经完成。

`test` 与 `test:e2e` 使用独立 `campus_test`，会清理该测试库的用户与讨论，不能指向有用数据。浏览器验收测试最终构建，运行前先 `pnpm build`。Windows 默认用已安装 Microsoft Edge；其他系统先按 Playwright 说明安装对应测试浏览器。E2E 服务只在 3101 监听，测试后回收。

`pnpm test:persistence` 会短暂重启本项目专用本地 PostgreSQL，同时只向独立测试库写入验证内容；不要在其他人使用本地演示时执行。不适用于外部数据库。它已验证帖子与服务端会话在 API 和 PostgreSQL 重启后保留。

构建后可停止开发进程，执行 `pnpm start` 在 http://127.0.0.1:3001 同域运行构建产物；这条本地路径也支持写入。未来 HTTPS 部署需单独设置 `NODE_ENV=production` 与 `SERVE_ORIGIN`，不能直接将本地演示配置公开发布。

`pnpm db:stop` 安全停止专用本地 PostgreSQL。数据不删除，之后用 `pnpm db:local` 再启动。

工程：`apps/web` 前端、`apps/server` API、`packages/contracts` 共享校验与 DTO、`prisma` 迁移与 seed、`docs` 决策和过程记录。新粗野主义概念稿只作视觉参考，运行数据来自 API 与 PostgreSQL。

## 开发节奏与参赛证据

按 docs/DEVELOPMENT_PLAN_v1.1.md 的每周 30—40 小时滚动推进，第 7 天填写真实总结并制定下一周。当前 Git 提交按实际功能节点产生，不重写为虚构历史。

docs/ai 包含过程摘要和真实可见文本对话快照，两者均明确范围；至少三条完整核心迭代 Prompt 链仍需继续真实积累和归档。访谈、真实 AI 调用、同学试用、性能数据及比赛视频均不伪造。GitHub 源码归档与应用公开部署分别记录；当前不公开部署应用、不购买资源。
