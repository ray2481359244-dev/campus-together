# 已实现 API

前缀 `/api/v1`。成功 `{data, meta?}`，失败 `{error:{code,message,fields?},requestId}`。更新至 2026-10-19 W1-05 发布恢复，未列出的入队 / 审核 / 聊天 / AI 业务仍未实现，返回 404。

| 方法与路径 | 当前行为 |
| --- | --- |
| GET /health | 存活与 DEMO 标识，不依赖登录或数据库；开发启动器可显式提供当前目录短摘要 devInstance，生产不返回该字段 |
| GET /ready | 实际查询 PostgreSQL，就绪失败 503 |
| GET /schools | 可用学校，含演示标记 |
| GET /topics?category= | 数据库主题；区域枚举校验 |
| GET /auth/csrf | 匿名或当前会话的 CSRF 上下文 |
| POST /auth/register | 邮箱、10—128 位密码、昵称、有效学校；用户 / 资料 / 会话及旧上下文撤销同事务，提交后设置 Cookie |
| POST /auth/login | 真实 Argon2id 验证；成功轮换会话 |
| GET /auth/me | 当前私有资料或 null；可用 CSRF |
| POST /auth/logout | 撤销当前会话并清 Cookie |
| GET/PATCH /me/profile | 仅本人；自述学校、昵称、简介、年级、技能、兴趣 |
| GET /profiles/:userId | 公开 DTO，不含邮箱、密码或会话 |
| GET /posts | schoolId 必填；category/topicId/q/cursor/limit；默认 20、最大 50 |
| GET /posts/:id | 公开正文、主题、作者公开资料和当前 canEdit |
| POST /posts | `{requestKey:UUID,topicId,title,body}`；当前账号学校内发布，有效主题；首次 201，同作者同键同内容重试 200，内容不同 409，原帖已隐藏 / 删除 410；不能自行传作者或学校 |
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

10 月 18 日补充：讨论 PATCH 的版本条件更新与响应快照读取在同一事务内完成，保持行更新锁至快照读取结束。请求仍只包含标题 / 正文 / revision，没有新字段或路由。浏览器使用开始编辑时的 revision；冲突后保留输入，明确确认服务器版本后才更新基准。当时 POST /posts 尚无幂等，已由下述 10 月 19 日增量补齐。

10 月 19 日补充：POST /posts 必填 `requestKey`，服务端对校验并 trim 后的 topicId / title / body 保存 SHA-256，Post 的 authorId + createRequestKey 唯一约束保证并发只创建一条。同键不同内容为 409 `REQUEST_KEY_CONFLICT`；同键原帖已隐藏 / 删除为 410 `POST_UNAVAILABLE`，不返回正文，不重新创建。请求元数据不进入公开 DTO。已有成功请求先解析原帖，再检查新建所需的学校 / 主题；资料学校改变、主题停用或帖子正常编辑后，重试仍返回原帖当前可见版本，不改回初始正文或迁移到新学校。

浏览器在发布结果未知时锁定本次内容，使用“核对并完成发布”重复原请求；只有明确的 INVALID_INPUT / TOPIC_UNAVAILABLE / PROFILE_INCOMPLETE 拒绝才解锁修正。非 JSON 网关错误、超时、503 或限流均不能据此推断先前请求未保存。请求标识仅在本次页面中保留；关闭 / 刷新后不保证恢复，仍需先核对讨论板。旧数据库记录迁移时保留空请求元数据；旧客户端缺少 requestKey 会得到 400，需重新载入更新后的页面。

限流目前为单实例内存限流，重启重置；未声称支持多实例。完整 API 范围仍见 PROJECT_SPEC.md，状态与边界修正以 DECISIONS.md 为准。

10 月 17 日补充：客户端对写入、CSRF 获取和可能包含私有内容的读取发送 `X-Session-User`（当前用户 UUID，匿名为 `anonymous`）。若提供该头而实际 Cookie 对应其他用户，返回 409 `SESSION_CHANGED`；预期已登录但实际会话失效则 401 `AUTH_REQUIRED`。此头只作身份一致性核对，不能授予身份或权限；未提供时依旧完整验证 Cookie、Origin、CSRF 和作者权限。`GET /auth/me` 用于重新确认当前身份，不绑定旧身份。

登录轮换与注销仅能成功撤销仍有效且未撤销的旧会话。并发争用失败可能在 CSRF 阶段返回 403，或在条件更新阶段返回 409；失败请求不设置 / 清除 Cookie。客户端只在同一会话上下文内自动重试 CSRF，旧会话请求的迟到结果不应用到新上下文。注册响应网络丢失与数据库回滚是不同情形，不能宣称响应丢失时注册必然未落库。

客户端以本地 `STALE_SESSION_RESPONSE` 标记已过时的结果；它不是新增服务端路由，也不能据此断定原请求没有提交。确认已保存内容时应重新登录原账号读取。

招募请求的所有写入仍验证 Origin / CSRF，单实例写入限流为每分钟 40 次。招募 DTO 不缓存（no-store）。非作者操作草稿 404；已发布编辑 / 删除 409。前后端复用 `packages/contracts/src/recruitments.ts`，拒绝伪造 authorId / schoolId / teamId 等未支持字段。

本阶段仅 COMPETITION 和 APPROVAL 发布模式。公共 `draft` 字段是作者确认发布的结构化内容，不含内部请求摘要；私有草稿只对作者返回。`team.chatAvailable=false`，`acceptingStatus` 只反映招募时间是否截止，不代表可以申请或完整生命周期已执行。没有直接加入、审核、消息或通知投递 API。
