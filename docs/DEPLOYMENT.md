# 部署交接与上线前操作

2026-10-27：负责人已确认主机下次再选，本轮停在部署准备。源码、构建入口、部署模板、加密备份和隔离恢复已准备；未创建云资源、绑定域名、安装服务或开放公网。AI 按负责人决定暂缓，保持 `RULES_ONLY`，普通流程不需要模型配置。

默认模板面向一台 Linux 主机：Node.js 24、pnpm 11.5.1、PostgreSQL 18、同机 Caddy HTTPS 代理、单应用进程。Windows 仍可按 README 本地启动；若最终选 Windows 正式主机，部署阶段再验证 HTTPS 代理和服务托管。模板不等于云主机或证书已经验收。

## 下一次从这里开始

1. 确定主机、域名和实际试用学校；确认服务器访问方式及数据库位置。主机与域名费用、备案及网络条件在选择时核对，本轮没有购置资源。用户还未确定主机时，不猜测凭据。
2. 从已归档的提交获取源码，或使用本轮生成的发布目录；先运行 `node scripts/verify-release.mjs <发布目录>` 核对文件摘要。发布目录不含 `.env`、数据库、上传运行数据、备份密钥或 `node_modules`。
3. 在新主机安装锁定环境，再执行 `pnpm install --frozen-lockfile`、`pnpm db:generate`、`pnpm build`。本机离线缓存复现不能替代新主机首次网络安装或 Linux 原生图片组件验证。
4. 创建专属 PostgreSQL 数据库及普通应用角色，角色仅拥有自己的应用库 / schema；不要使用超级用户运行应用。把 [生产配置模板](../infra/production.env.example)复制到服务器私有文件，例如 `/etc/campus/campus.env`，填入实际 HTTPS 域名、数据库凭据和独立随机 CSRF 密钥。权限仅允许运维和服务用户读取，环境文件在发布目录外。
5. 加载该环境后执行 `pnpm db:migrate`、`pnpm db:seed`。生产 STANDARD seed 仅创建主题，不创建虚构学校、演示用户和帖子。通过 `SCHOOL_NAME` / `SCHOOL_CITY` 加 `pnpm bootstrap:school` 配置负责人提供的实际学校；需要停用已有虚构学校时显式加 `--deactivate-demo-schools`。学校仍是自述身份，不能表述为校方认证。
6. 先经 HTTPS 临时受控访问注册负责人账号，获取本人用户 ID，在服务器以 `ADMIN_USER_ID` 加 `pnpm bootstrap:admin` 初始化第一位管理员；没有网页提权入口。该脚本只允许首位管理员，记录初始化审计；不输出密码、邮箱或会话。后续管理员增设须另行明确安排。
7. 执行 `pnpm backup:key` 或在 `BACKUP_KEY_FILE` 放入 32 字节十六进制密钥，另留独立安全副本。执行 `pnpm backup:create`，按下文在专用空恢复库演练，然后 `pnpm deploy:preflight`。配置或学校 / 管理员未齐时预检应失败，不把失败改成警告绕过。
8. 按实际安装路径核对 [应用服务](../infra/campus.service)、[Caddy 配置](../infra/Caddyfile)，验证配置后再启用。应用仅监听 `127.0.0.1:3001`；Caddy 负责 HTTPS，`CAMPUS_DOMAIN` 与 `SERVE_ORIGIN` 必须一致。仅信任 loopback 代理，数据库不开放到公网。部署阶段实际检查证书、代理、真实 IP 限流和 Secure Cookie。
9. 以两个独立浏览器账号完成注册、四区发布 / 入队、聊天、举报与管理员处理；检查 `/api/v1/health`、`/api/v1/ready`，手机布局与错误提示。启动 [每日备份服务](../infra/campus-backup.service)和[定时器](../infra/campus-backup.timer)前，确认密钥与备份目录权限、异机副本位置和保留周期。只有上述步骤实际通过，才标记已部署。

模板路径 `/opt/campus/current`、`/etc/campus`、`/var/lib/campus` 需要在实际主机创建并授权；本轮没有在开发电脑安装这些服务。主机未选定，所以 DNS、证书、网络策略和异机备份验证属于下一次部署工作。

## 加密备份和恢复

本项目提供小规模应用数据备份：读取 PostgreSQL 一致性只读快照，包含全部业务表和处理后的图片；记录迁移校验和与 schema 摘要，gzip 后用 AES-256-GCM 加密。仅把密文写入备份文件。当前工具限制数据体量，超过限制会拒绝，较大部署改用 PostgreSQL 原生备份与恢复体系。它不包含数据库角色、服务器配置、TLS 证书和备份密钥，不能代替整个 PostgreSQL 集群备份。

本机默认密钥 `.local/backup.key`、备份 `.local/backups/*.ctbackup` 均忽略上传。生产用私有外部路径。密钥丢失不能解密；不要把密钥与唯一备份只留在同一台主机。每天运行脚本的模板已准备，尚未启用；保留周期、定期恢复和异机复制在部署时落实，本轮不会自动删除旧备份。

创建：

```powershell
pnpm.cmd backup:key
pnpm.cmd backup:create
```

密钥初始化使用独占创建，已有密钥时不覆盖；只需首次执行。恢复要求提前创建一个**全新空数据库**，名称以 `_restore` 结尾；设置 `RESTORE_DATABASE_URL` 指向它，用同版本源码先应用迁移，再执行：

```powershell
pnpm.cmd backup:restore -- .local/backups/你的备份.ctbackup --confirm-empty-target
```

pnpm 对参数的传递请以脚本实际收到为准；也可直接 `node scripts/backup.mjs restore <文件> --confirm-empty-target`。工具拒绝主库 / 同名库、非专用恢复库、非空目标、schema 或迁移不同、错误密钥和篡改密文。插入按外键依赖顺序，数据与全部摘要在事务内校验，不关闭外键，不删除目标已有记录。失败整体回滚。所有表摘要核验后，同一恢复事务会撤销备份里的全部会话，恢复上线必须重新登录，避免旧备份使已经注销或封禁时撤销的 Cookie 再次生效。备份的账号状态仍反映快照时点，负责人切换前须核对备份之后的封禁等管理变更。恢复后的过期群聊仍由首次启动维护重新清理，较早备份不能延长归档期限。

`pnpm test:backup` 只读取独立 `_test` 库，将浏览器验收产生的图片、聊天与管理数据恢复到新建的随机 `_restore` 库，核对每张表并重启专用 API 两次。它不覆盖主库，也不删除原库；会保留本次隔离恢复库供检查，清理须在确认没有继续使用后另行处理。

## 发布、更新与回退

`pnpm release:prepare` 需要工作树已提交且有构建产物，在 `.local/releases/` 生成带 `RELEASE_MANIFEST.json` 的独立目录；`--preview` 可生成明确标记的未提交预览。`pnpm release:verify <目录>` 校验所有文件与额外文件。发布包属于本机构建产物，不混入 Git 源码提交。

第一次部署保留完整旧发布目录；更新前先做新备份、核对迁移，再让 `current` 指向新发布。当前增量迁移不提供自动向下回滚。若只有应用缺陷且 schema 向后兼容，可回到已验证的旧应用；涉及不兼容 schema / 数据时，应停写、恢复到新的空恢复库、验证后由负责人确认切换数据库。不能直接覆盖正在使用的主库，也不能在不断写入时恢复旧数据而忽略期间新增内容。

应用日志仅输出请求 ID / 错误类别，环境值、密码、Cookie、聊天正文和举报证据不写入日志。代理模板没有启用含 URL 的访问日志；启用日志前应确认脱敏和保留设置。上线后关注就绪状态、5xx、备份任务成功与恢复演练，不以页面能打开代替数据与权限验收。

## 已验证与保留边界

本轮实际结果见[当日日志](development/2026-10-27.md)与[当前验收](ACCEPTANCE.md)。通过的是本机真实 PostgreSQL、独立账号浏览器、隔离恢复、构建和目录复现；未做云主机 / 真机 / DNS / 公网 HTTPS 验收。HTTP 两秒增量群聊已验收，没有实现 Socket；条件排序仍集中竞赛、个人时间用逐活动显式确认，未实现结构化个人日历或语义推荐。AI 真实服务按用户指示延期，参赛完整视频、PDF、完整 Prompt 链和真实试用仍须按实际证据补充。

实现参考：[PostgreSQL JSON 记录转换](https://www.postgresql.org/docs/current/functions-json.html)、[Node.js 加密接口](https://nodejs.org/docs/latest-v24.x/api/crypto.html)、[Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。这些资料用于实现核对，不构成实际部署成功证明。
