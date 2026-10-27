# 已实现 API

前缀 `/api/v1`。成功 `{data, meta?}`，失败 `{error:{code,message,fields?},requestId}`。更新至 2026-10-26 I-003 成员管理与关闭招募。未列出的队长转交、开始 / 结束 / 取消、聊天和 AI 业务仍未实现。

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
| POST /recruitments | 登录作者创建私有草稿；`{requestKey:UUID,draft}`，可暂缺发布必填项；同作者 / 同键 / 同请求重试 200，新建 201；同键不同内容 409；原创建的草稿已删除为 410 DRAFT_DELETED，不重建 |
| PATCH /recruitments/:id | 仅作者草稿，`{revision,draft}`，完整替换草稿；行锁和版本校验；冲突 409 |
| DELETE /recruitments/:id | 仅作者草稿，`{revision}`；已发布不可删除，409 |
| POST /recruitments/:id/publish | 仅作者，`{revision}`；重查学校 / 来源 / 主题与未来截止；事务建队、岗位、队长、空间元数据、事件并公开；首次 201，重复已发布 200 |
| POST /recruitments/:id/eligibility | 登录后用 `{slotId:UUID或null,timeConfirmed:boolean或null}`核对本人条件；只读判断采用 POST 避免把当次回答放入 URL；需 Origin / CSRF，返回 PASS / FAIL / UNKNOWN 及逐项依据 |
| POST /teams/:id/applications | `{requestKey:UUID,slotId:UUID,message:0—1000字,timeConfirmed:boolean}`；重新检查条件，新提交 / 冷却后重提 201，同意向重试 200；待审核不占位 |
| GET /me/applications | 仅本人，`teamId`可选，按提交时间倒序最多 50 条；返回申请状态、原说明、本人条件快照与可撤回状态，不返回他人的申请 |
| POST /applications/:id/withdraw | 仅申请者本人，`{revision}`；撤回和事件同事务，原版本重试返回同一撤回结果；新一轮申请后旧撤回 409；非本人 404 |
| GET /teams/:id/applications | 仅当前有效队长；`status=PENDING或ALL`，默认待审；`cursor` 为本队申请 UUID；每页 20 条，返回 items / nextCursor / pendingCount，含申请者必要自述资料和原始条件依据 |
| POST /applications/:id/review | 仅当前有效队长；`{revision,decision:APPROVE或REJECT,reason?:0—500字}`，成功及原操作重试均 200；批准重查当前条件 / 总量 / 岗位，成员、状态、审核、通知与事件同事务；变化 409，条件不符 422 |
| GET /me/notifications | 仅本人；可选本人通知 UUID `cursor`，每页 20 条，返回 items / nextCursor / unreadCount；当前审核批准 / 拒绝、退出、移除和关闭待审结果 |
| POST /me/notifications/:id/read | 仅本人，严格空对象 `{}`；首次与重复标为已读均 200，不改写首次 readAt；非本人 404 |
| GET /me/teams | 本人有效成员队伍，不受浏览学校筛选影响；可选本人有效队伍 UUID `cursor`，每页 20 条，返回 items / nextCursor |
| GET /teams/:id | 仅当前有效成员；返回本人角色、当前有效成员的必要自述资料、人数和操作能力；待审 / 退出 / 移除 / 旁观者及无成员身份的管理员均 404 |
| POST /teams/:id/leave | 本人普通成员，`{revision:成员版本}`；成功及原操作重试均 200；队长 409 CAPTAIN_CANNOT_LEAVE；后续版本 409 MEMBERSHIP_CHANGED |
| POST /teams/:id/members/:memberId/remove | 当前有效队长，`{revision:目标成员版本,reason:1—500字}`；同版、同原因原操作幂等；不能移除队长、跨队目标或已失效成员 |
| POST /teams/:id/close-recruitment | 当前有效队长，`{revision:招募版本,reason?:0—500字}`；关闭标记、招募版本、待审 EXPIRED / 版本、本人通知、事件同事务；不取消队伍，不移出现有成员，不支持重开 |
| POST /teams/:id/actions | 当前有效队长，`{kind:TRANSFER或START或COMPLETE或CANCEL,revision:队伍版本,reason}`；TRANSFER 另需 `targetMemberId` / `targetRevision`，说明可空；其他操作说明 1—500 字。成功 / 原操作重试 200，后续版本或相反操作 409 TEAM_CHANGED，阶段 / 人数不符 409 TEAM_NOT_EDITABLE |

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

本阶段仅 COMPETITION 和 APPROVAL 发布模式。公共 `draft` 字段是作者确认发布的结构化内容，不含内部请求摘要；私有草稿只对作者返回。`team.chatAvailable=false`，`acceptingStatus` 结合实时有效成员数、截止与现有队伍状态返回 OPEN / FULL / CLOSED。已开放申请 / 撤回，没有直接加入、审核批准、消息或通知投递 API。

10 月 20 日补充：招募创建标识保存到独立的 RecruitmentCreateRequest，作者 + requestKey 为主键，请求摘要和草稿关联与创建同事务。草稿删除时移除草稿正文，关联置空，保留最小创建记录；原键重试 410，不清理后重新创建。记录无自动 24 小时过期，随所属账号的硬删除级联清理；本轮没有新增账号删除界面。创建记录和摘要不进入 DTO。

已提交请求先返回当前结果，再决定是否执行新建时的来源 / 学校校验；资料或来源后续变化不应把成功创建变成未知。旧数据通过增量迁移回填，兼容前一应用版本写入的原有创建字段。同一标识不同内容仍 409。

前端保存未确认创建的原始快照与标识。用户继续修改后重试，先用原始请求找回草稿；仅在它仍是初始版本和原内容时，以该版本 PATCH 保存当前修改。若他页已更新 / 发布或原草稿已删除，保留本页输入并停止写入，提供已保存内容核对入口；不静默使用他页新版覆盖内容。明确的业务校验拒绝可修正后重新创建，非 JSON 网关错误、超时或限流继续保留原请求。关闭 / 刷新后没有本页创建恢复保证。

## I-001 岗位申请边界（2026-10-22）

条件版本 `competition-application-v1`：账号、实时招募总量 / 截止、既有成员 / 被移除状态、身份学校、岗位余量、自述技能及当次时间确认。任一 FAIL 总结果 FAIL，否则有缺失为 UNKNOWN，全部通过才 PASS。技能只做 NFKC / 大小写 / 首尾空白规范化后的精确标签对照；缺少标签是 UNKNOWN，不推断没有能力或进行能力认证。时间确认包含页面已展示的起止、每周投入和时段，不从自由文本或长期资料推断；没有总匹配百分比。

申请写入先锁申请者 User（NO KEY UPDATE），再按 Recruitment → Team 锁定顺序重查，保证跨队每人 10 条、每队 100 条有效待审上限。待审不占队伍或岗位名额，批准留待下一轮。每队 / 每人一条 Application 身份；撤回 / 拒绝后冷却 10 分钟，重提增加 submission 与 revision。ApplicationRequest 按本人 / 请求键保存内容摘要、所属申请轮次及原始说明 / 确认 / 条件依据快照，申请、快照和领域事件同事务。

同键内容变化为 409 REQUEST_KEY_CONFLICT；仍有不同内容的待审申请为 409 APPLICATION_EXISTS；旧请求对应较早申请轮次为 409 APPLICATION_SUPERSEDED。旧请求在本轮已撤回时返回 WITHDRAWN，不能恢复意向；资格在校验后变化会在真正提交时返回 422 ELIGIBILITY_NOT_PASSED，校验失败不占请求键。冷却和限额分别为 409 APPLICATION_COOLDOWN / APPLICATION_LIMIT。

截止或停止招募后，原 PENDING 的有效读取状态为 EXPIRED，不能撤回或新申请，过期记录不计有效待审限额；本轮没有后台状态调度，存储状态不会因读取自动重写。之后实现关闭 / 审核时仍须真实检查截止，不能依赖存储 PENDING。原申请和撤回重试均保留版本 / 轮次保护。

申请端 DTO 均 no-store，只含本人的说明和必要条件快照，`reviewAvailable=false`。队长当前没有读取他人申请或批准接口。前端未知提交结果保留并锁定原请求，非 JSON 网关错误或限流不换键；明确拒绝才允许修正。页面刷新 / 关闭后不保证恢复未提交文字，已保存意向可在招募详情或大厅“我的岗位申请”核对。

## I-002 审核、成员与结果通知（2026-10-22）

上节末尾的 `reviewAvailable=false` 和无队长接口为 I-001 时点记录；当前为 `true`，申请 DTO 新增本次 `review` 和申请者当前 `membership`。本次审核包含决定、说明、时间和批准时复查依据；成员身份由真实 TeamMember 读取，不以 APPROVED 文案替代。只有队长私有列表 / 审核响应额外返回申请者必要自述资料，公开招募仍只返回人数与岗位占用，不公开申请说明、邮箱或通知。

审核先查本队归属，再按 UUID 排序锁定申请者与队长 User（NO KEY UPDATE），随后 Recruitment → Team。本人资料修改也在 User 锁内完成，防止审核越过尚未提交的资料变更。批准检查账号、有效招募 / 截止、学校、成员 / 被移除状态、岗位、自述技能和原时间确认；只有 PASS 才创建或恢复有效成员，并按真实人数更新 OPEN / FULL。拒绝不占名额；截止 / 停止后的有效 EXPIRED 不可审核。完整生命周期和自动过期通知仍未实现。

ApplicationReview 每个申请轮次唯一，并保留原 revision、审核人、决定 / 说明、岗位 / 招募标题快照及批准复查证据。相同原版本、相同决定 / 规范化说明重试返回已保存结果，不重复成员 / 通知 / 事件；相反决定、修改说明、已撤回或重提后的旧版本均 409 APPLICATION_CHANGED。422 ELIGIBILITY_NOT_PASSED 返回逐项未通过依据，申请仍待审。原创建 / 撤回的轮次保护继续生效。

ApplicationReview、申请状态 / revision、成员、队伍人数状态、Notification 与领域事件在一个事务内。通知通过复合外键绑定原申请者，一次审核最多一条，保留当时摘要，不随之后重提的岗位改变。查询 / 已读只接受本人记录，游标也限定本人；队长列表游标限定本队。列表按时间与 UUID 倒序，最多每页 20 条；未读数统计全部本人未读，不限当前页。没有 Socket、短信或邮件，消息页打开 / 页面重新可见及手动刷新补取，已读失败可安全重试。

队长前端把未知审核结果的原版本、决定和说明保留并锁定，非 JSON 网关错误 / 限流不换操作；可原样重试或刷新核对。明确状态 / 条件失败先刷新再选择申请。只有成功读取当前申请后才解除核对状态，旧“待审核”提示不覆盖新的审核或成员结果。跨标签页换号沿用既有清缓存与迟到响应保护，私有队长 GET 同样绑定当前账号。

## I-003 成员管理与关闭招募（2026-10-26）

条件新快照为 `competition-application-v2`，旧 v1 快照仍原样可读。v2 明确 ACTIVE / LEFT / REMOVED 都不能新申请同一队伍；退出后禁止重新入队，避免没有成员任期 / 聊天历史权限方案时重用身份。原批准请求只返回当前成员状态，不再次激活已退出 / 移除的成员。

成员改动沿 UUID 排序 User → Recruitment → Team 锁顺序。TeamMember 新增正整数 revision；MembershipChange 保留成员、原版本、操作者、类型、原因和摘要。原版本、同操作 / 同原因且仍是该次结果时重试返回原回执；退出与移除竞争只有一个成功，旧版本不能改写后来状态。OPEN / FULL 按有效人数恢复空位，IN_PROGRESS 保持原阶段；终态不接受新成员改动。队长不能普通退出或被移除，转交和取消留待后续。

关闭招募使用独立 `Team.recruitmentClosedAt` 与唯一 RecruitmentClosure；关闭不等于 CANCELLED，现有有效成员仍可查看队伍。截止检查、条件对照、队长列表和有效待审限额均识别关闭标记。关闭锁内把全部原始 PENDING 写为 EXPIRED、递增版本并设置处理时间，只给受影响申请者保存关闭通知；已批准 / 撤回 / 拒绝记录不被改写。相同原招募版本与原因可重试，不重复通知；不同版本 / 说明为 409 RECRUITMENT_CHANGED。关闭后释放成员名额也不清除关闭标记。

Notification 增加退出、移除和关闭三种来源；保留旧审核关联与数据。互斥来源 CHECK 和复合外键确保成员通知属于当事人、关闭通知属于相同队伍的申请者，每次变化 / 关闭每人至多一条。DTO 的 `applicationId` 在成员变化时可为 null，新增 `teamId`；通知摘要是历史结果，当前身份以详情为准。新申请通知和 Socket 仍未实现。

队伍列表 / 详情在一致读快照中检查有效成员，只返回必要字段，不返回邮箱、口令、私有申请说明或成员变更原因。退出 / 移除提交后新读取立即 404；客户端重新可见或手动刷新后收起旧页面，不宣称 Socket 实时撤权。未知操作保留原版本与原因，原样重试；离开成功清除队内缓存并返回我的队伍。直接页面读取失权时不展示旧成员列表。

## I-004 队长转交与活动状态（2026-10-26）

队伍 DTO 新增独立 `revision`、`startedAt` / `completedAt` / `cancelledAt`、开始 / 结束 / 取消能力；成员新增 `canTransfer`。队伍版本用于新管理操作，成员版本用于退出 / 移除与接任身份检查，招募版本仍用于关闭招募，三者不可混用。

转交在排序 User → Recruitment → Team 锁内检查当前有效队长、目标同队 ACTIVE MEMBER、目标账号 ACTIVE、目标成员版本与队伍版本。先降原队长、再升接任者，同事务更新 captainUserId；双方岗位和人数不变，唯一有效队长约束保留。发起作者不变，审核权始终跟随当前队长；新队长从“我的队伍”进入管理。旧成员版本不能在转交后误退出；原队长须按新成员版本确认退出。

START 仅未截止的 OPEN / FULL 且至少两名有效成员，允许未满员或先关闭招募后开始；FULL 不自动开始。COMPLETE 仅 IN_PROGRESS；CANCEL 允许未截止 OPEN / FULL 或 IN_PROGRESS。本轮仅开放队长操作，管理员无越权例外。COMPLETED / CANCELLED / EXPIRED 不再转交、开始、结束、取消、退出或移除。终态 ACTIVE 成员可只读查看队伍；不开放复制或重开入口。

每次管理增加队伍版本，TeamAction 记录原版本 / 操作者 / 决定 / 说明 / 接任目标及成员版本和当时结果。原操作完全相同、且尚无后续管理版本时返回原回执，不重新执行；这包括已经失去队长权限的原转交者核对自己那次转交。修改目标 / 说明 / 决定或后续管理版本均 409。新的操作仍严格验证当前队长。回执只证明当时结果，当前状态须重新读取。

开始 / 结束 / 取消把当时全部原 PENDING 同事务写为 EXPIRED 并更新版本 / 处理时间；有效成员收到状态通知，受影响申请者收到失效通知。转交通知发给当时有效成员，不改变待审申请。TeamActionNotice 每操作每接收者唯一，Notification 复合外键绑定接收者且来源互斥；旧通知保持原样。新增 kind 为 CAPTAIN_TRANSFERRED、TEAM_STARTED、TEAM_COMPLETED、TEAM_CANCELLED、APPLICATION_EXPIRED，仍使用本人分页与幂等已读接口。状态、角色、通知和领域事件任一失败整体回滚。

截止已到的未开始队伍在私有读取显示有效 EXPIRED，管理和成员改动即时拒绝。当前仍无每分钟自动过期、重启补偿扫描、归档期限或群聊；原显式关闭接口仍可把截止后的待审失效落库。领域事件与站内通知不表示已写入群聊系统消息。未知响应在页面冻结原决定 / 说明 / 版本再核对，未提交说明不保证跨整页刷新恢复。

## I-005 自动到期（2026-10-27）

启动补偿和每分钟扫描每批至多 100 队，失败单队下次重试；目标队伍 / 申请 / 招募请求先执行同一到期事务。数据库 epoch 时间避免驱动时区歧义；Recruitment → Team 锁保证与手动活动 / 审核竞争一致。EXPIRE 只由系统产生，TeamAction.actorId 可空，用户 actions Schema 不接受该类型。到期成员通知 TEAM_EXPIRED，原待审申请者通知 APPLICATION_EXPIRED；不再允许截止后的显式关闭改写终态。仅保留原审核结果回执，不重复批准或恢复成员。

## I-006 队伍群聊（2026-10-27）

GET /teams/:id/chat 接受 after（增量）或 before（更早），互斥，limit 默认 30 最大 50；默认最新页升序，返回 items / more / previousBefore / highWater、状态 / 写能力、公告版本、未读与已读序号。POST /teams/:id/chat/messages 使用 {clientMessageId:UUID,body:1—2000字}；原标识同内容回执幂等，不同内容 409。POST /chat/read 使用 {seq}，不能超过高水位，不能倒退。POST /chat/announcement 使用 {revision,body:0—2000字}，仅当前队长和可写阶段。POST /chat/messages/:messageId/delete 使用 {}，仅本人有效成员在可写阶段删除文字，保留序号并产生撤回提示。

所有接口为私有 no-store、独立有效成员 / 账号检查，写操作同源 CSRF；终态新消息 409，仍有阅读权限时可找回原消息回执。每成员每队一分钟最多 20 条文字，另遵守原 IP 写限流。HTTP 两秒补取、重新可见和联网时同步；不提供 Socket 长连接。正文 / 公告没有公开接口；系统动态不包含私有审核或移除原因。
