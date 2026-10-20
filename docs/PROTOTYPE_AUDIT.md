# Nolya 原型审查

审查日期：2026-10-19。输入：用户提供的 NolyaV1.1.zip，199,148,196 字节，SHA256 `a302501991a20d30fd74716d29fa846c30f06d6ec608281fa85602b85b3f7581`。外层 162 条目；安全检查路径穿越、绝对路径和符号链接后，解压外层及 19 个页面包。未运行任何包内程序、构建脚本或测试。

## 输入与证据定位

原始资料位于 `../downloads/NolyaV1.1-inspect/`（相对于本项目目录）；`NolyaV1.1/` 含五份全局规范，`packages/` 含各页面包。不要将含签名的下载地址或凭据写入项目。

五份全局规范：
- `Nolya_MVP_v1_0_Core_Product_Spec_2026-10-08.md`
- `Nolya_MVP_v1_0_Measurement_Question_Bank_Spec_2026-10-08.md`
- `Nolya_MVP_v1_0_Guest_Registered_Identity_Persistence_Spec_2026-10-10.md`
- `Nolya_MVP_v1_0_Solo_Loop_D7_Retention_Spec_2026-10-10.md`
- `Nolya_MVP_v1_0_China_Entry_Framing_Viral_Loop_Optimization_2026-10-13.md`

测量与题库规范明确优先于页面级 UI/API 规格。19 个包覆盖设计页01–18，首页有 v1.1 与 v2.0 两版。主要为 PNG/JPG、Markdown、双语 JSON、HTML/CSS/JS 原型、Python 渲染脚本和少量 JS/CJS 计分参考；未发现完整后端、数据库迁移、Cargo.toml、package.json 或通用 LICENSE。

## 产品边界

Nolya（中文暂名诺芽）围绕 Self、Friends 社交镜像、Daily Pulse 和 Guess Me / Reveal。日记、D7 规律和我的空间支撑长期回访。不是专业心理诊断，不做 Feed、自由匿名文字评价、私信、AI朋友或复杂积分。

## 可复用资产

- 页面01 v2.0：最新首页视觉、手机/桌面中英文设计图、文案；没有 HTML 实现
- 页面01 v1.1、页面02等：可编辑 HTML/CSS 布局参考，但不能当真实端到端产品
- 页面03 `source/self_result_engine_reference.cjs`：确定性 Self 计分参考，明确不是生产服务
- 页面08 `source/mirror_logic.js`：三个独立朋友的维度共识校验及分享字段裁剪参考
- 双语 JSON、题库文案和设计系统可移植；演示 fixture 与生产数据必须分离

## 冻结的业务不变量

### Self 与 Friends

4维×2题，共8题。A=+1，B=-1；每维均值为 -1/0/+1，0表示依场景。不能输出0–100假精确人格分数。展示有限、带证据的观察。

Friends 选择3个目标维度，前三位朋友各答不同平行情景的3题，共9个判断。默认稳定维度优先 D1/D2/D4，D3轮换。1位完成只称首次反馈；3位不同身份才完整镜像。每维2/3或3/3才共识；Self为0不能输出确定差异。页面08排除了已知歧义题 FRIEND-D1-A。聚合必须绑定 Self 快照与题库版本；不能让新答卷篡改旧结果。

### Pulse 与 Guess

Pulse 未答前，服务端不返回分布。样本 N<50 不给精确百分比，不伪造票数；同用户同题唯一有效提交。D7 与 Self 对照需同维度至少2个Pulse证据。

Guess 必须引用发起者已有真实答案。提交前任何访客接口都不能返回答案或正确性；答案不能藏在 URL、HTML、localStorage 中。提交与揭晓由服务端原子处理，身份/所有权/题目/版本/有效期必须验证。一次有效猜测，重复提交幂等，不能重猜获取更好成绩。过期和撤销不可泄露。反向邀请须绑定正确双方。分享 DTO 不包含朋友姓名、逐人答案、私有 ID 或凭据。

### 身份

游客可以体验与回应，无需先注册。会话由服务端建立，不信任客户端自报身份。升级账户要合并游客历史，跨设备和长期数据用稳定账户。微信身份和头像昵称授权分开。

## 必须补齐的设计与风险

1. 核心规范18个P0路由与18个设计包不是一一对应。需路由映射，避免遗漏 Social Inbox、Settings、Privacy/Terms 等。
2. 首页v2“3分钟开始 / 3 friend answers”与Self 30–60秒、3位朋友各3题有歧义；视觉可用v2，规则遵循权威测量规范。
3. 原型含设计参考肖像，Page02明确要求商业使用前核对授权。未发现授权证明。开发可用占位/已核准资产；不能据此宣称商业发布已获授权。
4. 游客期限/邀请限额、邀请有效期、账号恢复方式、日题时区、超过3朋友的聚合、历史重算与数据删除策略需在实现文档冻结默认值。
5. 随包QA报告没有在此审查中重跑；不能据此宣称产品通过测试。前端演示弹窗、样例统计、样例好友不是业务实现。

## 建议数据边界

保留 User、Question/Version、SelfAttempt/Answer/Profile、FriendCampaign/Session/Answer、Relationship、PulseSchedule/Answer、GuessRound/Answer。补充服务端Session、Identity与升级合并记录、带scope/期限/撤销/token_hash的Invite、幂等记录。所有权查询与 DTO 应区分 owner、participant、public，不能依靠前端隐藏答案。
