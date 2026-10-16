# 已实现 API

前缀 `/api/v1`。成功 `{data, meta?}`，失败 `{error:{code,message,fields?},requestId}`。更新至 `2b18760`，未列出的入队 / 审核 / 聊天 / AI 业务仍未实现，返回 404。

| 方法与路径 | 当前行为 |
| --- | --- |
| GET /health | 存活与 DEMO 标识，不依赖登录或数据库；开发启动器可显式提供当前目录短摘要 devInstance，生产不返回该字段 |
| GET /ready | 实际查询 PostgreSQL，就绪失败 503 |
| GET /schools | 可用学校，含演示标记 |
| GET /topics?category= | 数据库主题；区域枚举校验 |
| GET /auth/csrf | 匿名或当前会话的 CSRF 上下文 |
| POST /auth/register | 邮箱、10—128 位密码、昵称、有效学校；成功轮换会话 |
| POST /auth/login | 真实 Argon2id 验证；成功轮换会话 |
| GET /auth/me | 当前私有资料或 null；可用 CSRF |
| POST /auth/logout | 撤销当前会话并清 Cookie |
| GET/PATCH /me/profile | 仅本人；自述学校、昵称、简介、年级、技能、兴趣 |
| GET /profiles/:userId | 公开 DTO，不含邮箱、密码或会话 |
| GET /posts | schoolId 必填；category/topicId/q/cursor/limit；默认 20、最大 50 |
| GET /posts/:id | 公开正文、主题、作者公开资料和当前 canEdit |
| POST /posts | 当前账号学校内发布；有效主题；不能自行传作者或学校 |
| PATCH /posts/:id | 仅作者；标题、正文、当前 revision；旧版本 409 |
| DELETE /posts/:id | 仅作者；携带 revision；软删除后列表与原链接不可读 |
| GET /me/recruitments | 仅本人，按更新时间倒序返回最近 50 条草稿及已发布招募；不分页 |
| GET /recruitments | 公开已发布竞赛招募；schoolId 必填，category 仅 COMPETITION；topicId/q/cursor/limit，默认 12、最大 30；q 搜索标题、说明、比赛名称与方向 |
| GET /recruitments/:id | 已发布公开；草稿仅作者可读，其他人均 404；DTO 不包含邮箱、请求摘要和会话信息 |
| POST /recruitments | 登录作者创建私有草稿；`{requestKey:UUID,draft}`，可暂缺发布必填项；同作者 / 同键 / 同请求重试 200，新建 201；同键不同内容 409 |
| PATCH /recruitments/:id | 仅作者草稿，`{revision,draft}`，完整替换草稿；行锁和版本校验；冲突 409 |
| DELETE /recruitments/:id | 仅作者草稿，`{revision}`；已发布不可删除，409 |
| POST /recruitments/:id/publish | 仅作者，`{revision}`；重查学校 / 来源 / 主题与未来截止；事务建队、岗位、队长、空间元数据、事件并公开；首次 201，重复已发布 200 |

所有变更请求都带当前同源 Origin 和 X-CSRF-Token。注册/登录前也需要匿名上下文。会话 Cookie 为 HttpOnly、SameSite=Lax，生产要求 Secure / HTTPS；Cookie 不包含用户公开资料。

所有输入严格 Schema 校验，未支持的字段被拒绝。常见错误：INVALID_INPUT、INVALID_CREDENTIALS、AUTH_REQUIRED、CSRF_INVALID、ORIGIN_REJECTED、NOT_AUTHOR、REVISION_CONFLICT、TOPIC_UNAVAILABLE、INVALID_SCHOOL、RATE_LIMITED、SERVICE_UNAVAILABLE。

限流目前为单实例内存限流，重启重置；未声称支持多实例。完整 API 范围仍见 PROJECT_SPEC.md，状态与边界修正以 DECISIONS.md 为准。

招募请求的所有写入仍验证 Origin / CSRF，单实例写入限流为每分钟 40 次。招募 DTO 不缓存（no-store）。非作者操作草稿 404；已发布编辑 / 删除 409。前后端复用 `packages/contracts/src/recruitments.ts`，拒绝伪造 authorId / schoolId / teamId 等未支持字段。

本阶段仅 COMPETITION 和 APPROVAL 发布模式。公共 `draft` 字段是作者确认发布的结构化内容，不含内部请求摘要；私有草稿只对作者返回。`team.chatAvailable=false`，`acceptingStatus` 只反映招募时间是否截止，不代表可以申请或完整生命周期已执行。没有直接加入、审核、消息或通知投递 API。
