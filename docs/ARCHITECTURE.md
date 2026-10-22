# Nolya 技术架构与决策记录

版本 local-mvp-1 · 2026-10-19  
目标：单机可启动、可验证、可迁移的真实产品闭环。此文件规定架构目标，是否已实现必须看源代码和验收结果。

## 1. 结构

```text
Mobile/Desktop browser
  React + TypeScript + Vite
  Same-origin JSON /api/v1 + HttpOnly session cookie
            |
Rust Axum application
  request validation / Origin + CSRF / authentication
  application services / idempotency / transactions
  deterministic measurement engine / versioned content
            |
SQLite durable file + schema migrations
```

开发时 Vite 代理 `/api` 到 Rust；本地成品可由 Rust 或明确配置的单个静态服务器提供前端。浏览器永不直接连接数据库。没有 LLM、Redis、短信、微信或邮件作为启动依赖。具体启动命令/环境变量以仓库 README 为准。

### 边界与责任

- Frontend：呈现、仅页内存的交互草稿、路由、分享和重试状态；不拥有最终评分/身份/授权。页内回退保留选择，离页/刷新清空，避免跨用户草稿残留。首版中文优先，locale完整本地化延后
- API：身份建立、访问控制、服务器时间、校验、错误码与返回字段白名单
- Domain：Self三态、平行题分配、朋友聚合、Pulse阈值、Guess揭晓和统计
- Persistence：事务、外键、唯一约束、版本快照、迁移和幂等记录
- Content：来源、版本、locale、区域、状态和显式 polarity；不是匿名用户生成的任意题目

先保持模块化单体。拆服务、Kafka、微服务网关不会为首批用户提供直接价值，暂不引入。

## 2. 主要领域记录

以下是逻辑模型；实际表名可以不同，但约束必须等价。

| 记录 | 核心字段 / 不变量 |
|---|---|
| users | random id、guest/registered、username_normalized、optional display_name、locale、region、created_at、guest_expires_at |
| credentials | user_id unique、Argon2id hash；不与公开profile混在一个 DTO |
| sessions | digest unique、user_id、csrf_secret、expires_at、created_at；登录轮换 |
| question_versions | id+version+locale+region、form、dimension、prompt/options、polarity、semantic hints、status |
| self_assessments | user_id、question_bank_version、scoring_version、target_dimensions、created_at；不可变 |
| self_answers | assessment_id+question_id unique；恰好8个有效源ID |
| self_feedback | assessment_id+user_id unique；三种反馈之一 |
| friend_cohorts | self_assessment_id、frozen target_dimensions、measurement_version、capacity=3 |
| invites | opaque token digest / resolvable secure token、owner/cohort、status、expiry；可撤销 |
| friend_sessions | cohort+respondent unique、slot、assigned_question_ids、status、reserved_until |
| friend_answers | session+question unique；同一session恰好3个有效映射 |
| pulse_instances | region+date unique、question/version、timezone；每天新实例 |
| pulse_answers | user+instance unique、immutable choice、answered_at |
| guess_rounds | owner、source_answer_ref、source version snapshot、actual_choice、token、expiry、parent round、optional intended recipient |
| guess_answers | round+guesser unique、guessed choice、derived correctness、submitted_at |
| reverse_source_answers | owner+question version、choice、parent round；不能冒充完整Self或Pulse |
| idempotency_records | principal+method+route+key unique、body digest、response、invalidated；与写入同事务，合并后保留键保护但清除失效响应 |
| merge_previews | token digest、source session digest、source/target identity、state fingerprint、5 minute expiry；只授权一次明确确认 |
| analytics_events | event name、opaque scoped reference、timestamp、dedup key；无敏感payload |

所有外部 ID 都不使用可枚举自增主键。即使 ID 随机也不能代替对象授权。来源题目更新时创建新版本，历史答案仍引用原版；不在旧记录上悄悄替换选项含义。

## 3. 必须在事务中发生的动作

1. Self：验证8题→写assessment和answers→冻结target dimensions→写幂等结果
2. 朋友开始：检查可用链接/非主人/未参与→原子占用一个slot→冻结该人的3题
3. 朋友提交：检查同一cohort/版本/分配→写3答案→标完成→更新真实聚合所需记录→幂等结果
4. Pulse：检查服务器当天instance→插入唯一答案→根据已提交集合计算结果
5. Guess：查已保存源答案所有权→快照版本与答案→创建不透明链接
6. Guess提交：检查参与人/链接/目标/一次性→保存猜测和正确性→返回专属Reveal
7. Reverse：验证原轮次参与→保存新owner真实选择→创建新轮次绑定原peer
8. 升级：创建凭据→原地更新guest用户→轮换session→保留既有数据
9. 合并：重新验证源会话/目标/预览指纹/无冲突→转移所有所有权和参与引用→保留幂等保护并清除失效响应→删除空访客及会话→签发新会话；任何失败回滚
10. 删除：撤销session与链接→先清除其他身份持有的相关幂等揭晓缓存→级联删除自有数据和自己的他人互动→聚合自动减计

网络断开不等于事务失败。客户端重试同幂等键，服务器返回同一提交结果。禁止先增加计数再写答案，禁止由前端上送 friend_count、score、correctness 或 crowd percentage。

SQLite 用外键开启、WAL、合理busy timeout、事务和唯一索引；多请求争同slot时由数据库决定唯一胜者。写冲突返回可重试错误，不绕过约束。多进程横向写入尚不在SQLite单机部署范围内。

## 4. 身份、鉴权与浏览器安全

### 会话

服务端生成至少256位随机token，Cookie HttpOnly/SameSite=Lax，HTTPS时Secure。数据库保存digest。访客身份也有服务器用户行，不能信任客户端自报guest_id。前端只能拿到CSRF token；不得将认证token写localStorage。

访客30天是可访问性期限。过期会话不能读数据；物理清理需已实现、已验证的retention job，不能仅因为Cookie过期就声称删除了数据库数据。

本地用户名+密码用于真实可测的保存账户。Argon2id的salt与参数由成熟库实现；不手写密码学。用户注册前知道没有邮件/手机验证与找回。登入/注册错误不能泄露密码或散列；禁止在日志中记录请求body。

2026-10-20 的后续里程碑增加显式预览/确认的无冲突迁移。预览使用现有密码验证，保留当前访客会话；确认绑定两个身份及相关记录指纹，整个事务更新所有外键。Pulse 重叠、重复参与、合并后自我互动、请求键冲突均阻止整次迁移，不丢弃任一空间。完整冲突解决仍未实现，详见 API 与 GUEST_MERGE。

### CSRF / Origin

所有写入接受application/json，拒绝不在允许列表的Origin；bootstrap guest也严格检查。已认证写入还必须有正确X-CSRF-Token。无会话login可仅使用严格Origin验证；有会话login必须CSRF。正式部署验证Host/Forwarded headers时只信任明确代理，不依据任意客户端头生成分享URL。

开发Origin只允许README列出的本地地址；不能用 `*` 解决浏览器错误。生产只支持配置的HTTPS origin。权限失败不自动重试为匿名或切换身份。

### 对象级授权

- Self/Journal/Solo/Space/Export：仅当前session.user
- Mirror：仅该assessment主人
- Invite创建/撤销：仅owner
- Friend提交：仅被冻结respondent session，owner不能提交
- Guess创建：仅源答案owner
- Guess提交：非owner、符合定向target、未提交、链接有效
- Reveal：仅成功提交该round的本人（以及另有明确owner界面的授权），不能发给其他token持有者
- Reverse：只能原已提交guesser变新owner；原owner变目标

公开邀请码是受限能力，不是“知道token即可访问全部owner数据”。回包白名单只含昵称、题目、状态和本人权限；任何owner答案、完整关系数据都必须单独授权。

### 额外防护

- 正式上线前：严格CSP、nosniff、Referrer-Policy:no-referrer，敏感响应no-store、无第三方跟踪脚本
- 日志屏蔽Cookie/Authorization、token路径、密码与原始选择；只记request id和错误码
- 禁止dangerouslySetInnerHTML渲染昵称/题目；文本长度、枚举、ID、版本全校验
- Token碰撞用数据库唯一约束；高熵随机token与有效期、撤销一起使用
- 按IP/session/owner的提交与登录频率限制；本地进程限流不宣称分布式反滥用
- 不持久化设备指纹，不从通讯录抓好友，不假装guest能证明真人独立性

## 5. 测量引擎

评分应是纯函数，输入有效的版本化事实，输出可追溯结果；数据库调用与文案渲染分开，便于单元测试。

### Self

`score(d) = (polarity(q1,choice1)+polarity(q2,choice2))/2`，仅-1/0/+1。稳定维优先选target，用D1,D2,D4,D3确定并列顺序。稳定观察上限2、contextual上限1。禁止从毫无证据的第四Friends维生成结论。

### Friends

只聚合同一assessment/cohort、同版本和三种平行表单。N<3无群体共识；N=3时majority>=2才描述。对齐/差异还需要Self非零。多个assessment不混用朋友数据；重做Self不重解释过去的朋友回答。

### Pulse与Solo

群体统计以region+day instance+question version为cohort，答前完全不返回。N<50百分比为null；N≥50由真实计数计算。日期取服务端CN/Asia-Shanghai，不听浏览器自报日期。

Solo使用最新七个实际作答日期；Self基线必须在窗口开始日的Asia/Shanghai午夜前已存在，并取最早的符合记录。窗口内或之后重做的Self不能冒充先前基线。至少两个同维语义明确且同向的Pulse才有echo/gap。争议性映射不得为凑卡片硬加：例如“工作80%先上线/再打磨”不必然等于计划/随性，应先排除，等待内容校准。

### Guess

源答案必须真实存在，正确性是两个A/B的等值比较，与Self或Friends分数无关。只对当前关系统计，去重同一真实源答案产生的重复轮次。题目和答案快照使后来Self重做不会改变旧Reveal。

## 6. 内容版本与定时

首发内容以版本化配置导入，后端提供接口；不能将客户端截图内容当权威。题目最小字段包括id/version/locale/region/status/dimension/form/polarity/created_at及source reference。

初版可通过受版本控制的JSON/迁移加载8 Self、16原始Friends（D1-A inactive）、30 Pulse。没有管理后台就诚实称配置导入，不声称“无需发版运营后台”。

Pulse的30题循环需固定epoch和日序；重启不能换题，时区边界一致。后续运营发布表支持draft/scheduled/published/withdrawn。撤下已有答案的题目不能悄悄改历史或影响guess引用；新创建禁用，既有展示按明确政策处理。

中文原题优先。英语Self/Friends可采用原型Page02/06已存在的逐ID翻译；Pulse全量英文需审校。locale不是region，切到英文不能把CN统计混进所谓global。

## 7. SQLite 到 PostgreSQL 的迁移计划

本地SQLite适合可交付闭环和小范围单进程验证；生产多实例、高并发、可靠备份恢复需要独立升级，不把SQLite宣称为所有规模方案。

1. 固定领域服务和repository边界，尽量用显式类型/参数化SQL；日期/布尔/JSON在逻辑模型中明确类型
2. 所有schema变化为有序、不可修改的迁移，记录版本和校验；启动发现版本过高/失败即停止，不悄悄丢表
3. 添加Postgres驱动与等价表/外键/唯一索引；将SQLite字符串时间转timestamptz，ID转uuid或一致文本
4. 用事务/行锁分配friend slot；验证unique冲突、serializable或锁策略；不要照搬SQLite全局写锁假设
5. 在隔离环境运行双数据库契约测试，尤其是并发幂等、删除、guest升级、aggregate边界
6. 暂停写入并做受控导出/导入；复制所有历史版本、token digest、source links；校验行数、checksum、外键和真实聚合
7. 备份并演练恢复/回滚；切流后验证关键计数，防止同时写双库造成分叉
8. 发布迁移需要独立部署授权；本次不连接生产、不传凭据、不建立新持久访问

数据库文件、测试cookie和环境secret排除Git。提交仓库仅包含schema、合成测试fixtures和代码，不包含真实用户数据。

## 8. 可观测性与错误处理

健康检查不泄露路径/secret。结构化日志含request id、route template、status、latency、error code；不输出原始token URL或choice payload。域错误稳定返回API码，internal_error只给安全概述。

事件真实来自提交，不重复计数。业务指标先离线查询数据库即可；没有已实现分析后台就不画假增长图。同页实际失败保持内存草稿和当前会话，离页/刷新清空未提交草稿并提前告知；超时后幂等重试；用户能返回Today或安全退出。

生产前增加migration failure、DB capacity、backup health、auth abuse、5xx、p95等告警。监控不得扩展收集原本未获同意的敏感数据。

## 9. 架构决策记录（ADR）

### ADR-001：Rust 模块化单体 + React Web

采用Rust/Axum、SQLite、React/TypeScript/Vite，满足用户后端优先Rust与手机浏览器入口。微信小程序保留未来独立客户端适配；不先承担平台SDK与账户授权复杂度。

### ADR-002：guest-first，本地可验证账户

第一次价值不依赖注册。以真实用户名密码验证跨浏览器账户保存，明确没有邮箱/短信/微信服务。生产身份提供商未配置时显示不可用，不伪造发送成功。

### ADR-003：FRIEND-D1-A 暂停激活

来源M的D1-A写“很快重新安排”与“更希望按原计划”，两者都可能反映结构偏好；Page06–08也已有QA警告。保留原始ID/文本/元数据作来源，不静默改写、不自行翻转。运行时前三位采用B/C/D。

| 活跃题组 | A polarity | B polarity | 使用 |
|---|---:|---:|---|
| FRIEND-D1-B / C / D | +1 | -1 | 计划 / 留空间 |
| FRIEND-D2-B / C / D | +1 | -1 | 直接 / 委婉 |
| FRIEND-D3-B / C / D | +1 | -1 | 尝鲜 / 熟悉 |
| FRIEND-D4-B / C / D | +1 | -1 | 外显 / 内收 |
| FRIEND-D1-A | 保留源值但不执行 | 保留源值但不执行 | inactive，待内容审校 |

回归例：Self D1=A/A，D1-B/C/D=A/A/A → score1 + friend3/3 alignment；Self D2=A/A，D2-B/C/D=B/B/A → majority-1 + gap2/3；Self D4=A/B，friendA/A/A → contextual，绝不是gap。未知题或inactive题在POST中被拒绝。

### ADR-004：匿名会话不是独立真人证明

服务端约束one respondent per cohort、one guess per round，能阻止同一持久身份重复，并不能阻止重新建guest。接口返回identity_notice，试用不宣称验证真实好友；公网公测前需要额外滥用控制与明确样本展示政策。

### ADR-005：固定cohort与版本，不复写历史

三位B/C/D的cohort固定到一份Self assessment；重测生成新assessment。撤销链接只更改访问能力，不改已获同意的历史事实。统计只取匹配cohort，避免“换答案立即制造差异”。

### ADR-006：没有假统计或假发送

数据不足返回null与条件状态；接口失败显示错误。前端绝不注入截图样例作为fallback。复制成功文案仅「链接已复制」，不会称「朋友已收到」。

## 10. 发布前安全边界

本次是本地开发交付，未授权部署/发布。公网公测前必须完成完整隐私条款、商业资产授权、HTTPS/secret管理、数据备份恢复、持续清理、滥用限制、身份合并与安全审查；微信/邮箱等接入各自需要合法配置与授权。文档的设计不构成这些工作的完成证明。
