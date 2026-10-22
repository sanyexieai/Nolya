## 0.4 全页面设计更新

按原始 Page01–18 逐页接入对应人物/场景素材和响应式布局，保留真实数据、隐私及安全边界。辅助页面采用原包品牌资源和同一设计系统，不以照片替代功能。逐页覆盖、无独立原稿的页面及验收边界见 [全页面设计覆盖](docs/ALL_PAGES_DESIGN.md)。本轮验收以最终提交对应的 CI 与截图记录为准，以下旧版记录不代表新改动已通过。

# Nolya · 诺芽

最新浏览器证据：对比度修复提交 `d61576cc4fe8fe2693e821c3cfc5daa65c7e32f8` 的 [托管 CI](https://github.com/sanyexieai/Nolya/actions/runs/39406818397) 通过 25 项 Chromium 检查，包含实际手机文字对比度与固定导航余量；verify（含54项前端测试、综合回归、备份恢复及Docker构建）也已完整通过。截图 artifact `12258181146`。完整生产部署和手工无障碍验收仍单列，不把脚本范围扩展为全面认证。


基于用户提供的 NolyaV1.1 原型包实现的社交认知产品。Rust 后端、React + TypeScript 移动优先 Web 界面、SQLite 持久化数据库。

> 当前为产品化候选 0.2，未部署公网。核心功能、托管工程验证与 Chromium 浏览器脚本已取得通过证据；尚未完成生产部署和完整人工可访问性/跨设备验收。当前门槛见 `docs/PRODUCT_READINESS.md`，精确结果见 `docs/RELEASE_VERIFICATION.md`。

## 产品范围

- Self：8 道生活化二选一，4 个维度，保留“看场景”的结果
- Friends：邀请不同身份各回答 3 题，依据真实反馈生成社交镜像
- Daily Pulse：每天一题，先答后看结果，小样本不展示虚构精确百分比
- Guess / Reveal：先猜后揭晓，答案由服务端保密，支持反向邀请
- 我的空间、选择日记、游客身份和真实本地账户保存
- 邀请管理：状态、进度、过期、撤销和分页；选择日记筛选、自我观察历史比较
- 账户安全：改密、全部会话退出、一次性恢复码与账户恢复、删除前再验证
- 访客合入已有账户：验证密码、预览数量和冲突、明确确认后事务迁移（仅无冲突记录）

这不是心理诊断或专业心理测评服务。页面中的解释只针对用户提交的生活选择。

## 本地启动

需要稳定版 Rust、Node.js 22.18+ 或 24（客户端测试使用原生 TypeScript 类型擦除）、npm。SQLite 通过 Rust 依赖内置编译，无需单独启动数据库。

```sh
cp .env.example .env
./scripts/run.sh
```

在本机打开 http://127.0.0.1:3000 。第一次启动会安装并构建前端、编译 Rust，后续数据默认保存到 `data/nolya.sqlite`。不要将数据目录提交到 Git 或打入分发包。

开发热更新：

```sh
# .env 内 NOLYA_PUBLIC_ORIGIN 改为 http://127.0.0.1:5173
./scripts/dev.sh
```

打开 http://127.0.0.1:5173 。前端通过 Vite 同源代理调用 Rust `/api`。

## 测试

```sh
./scripts/verify.sh
```

端到端测试写入测试数据，必须使用独立数据库，不能对真实用户服务直接执行。HTTP 测试入口为 `tests/e2e_api.py`，准确参数见脚本帮助和验收文档。

## 项目结构

```text
backend/       Rust API、领域规则、SQLite 迁移与后端测试
frontend/      React + TypeScript 界面与 API 客户端
docs/          产品、架构、接口、原型审查、分阶段交付记录
tests/         独立 HTTP 端到端验收
scripts/       本地启动与校验
```

## 首版约束

- 提供本地用户名与密码账户及一次性恢复码。它不是邮箱验证或微信登录；密码与恢复码都遗失时无法恢复。请使用独立密码，妥善离线保存恢复码
- 游客升级新账户保留原数据；登录已有账户可预览并确认无冲突合并。常见的同日 Pulse 重叠、重复朋友/猜测参与或合并后变成自己互动时，整次合并会被阻止，两个空间原样保留；尚未实现这些冲突的自动解决。详情见 `docs/GUEST_MERGE.md`
- 不同会话/账户不等于不同真人。开发版去重不能作为生产反作弊证明
- 原型的人像素材未提供商用许可证明，本工程不直接将其作为正式品牌素材
- 原型设计、产品文案与商标的权利仍归相应权利人；本工程未擅自授予开源或再分发许可
- 正式上线前仍需完整人工可访问性、Safari/跨设备验收、域名、HTTPS、备份调度与恢复演练、监控、边缘防刷、隐私和服务条款审定。邮件/微信是可选扩展，不是假定已接入的功能

## 配置

参见 `.env.example`。默认仅监听本机地址。生产环境必须启用 HTTPS 和 Secure Cookie，严格配置允许的 Origin，不允许通配凭证跨域。公开邀请链接的域名由 `NOLYA_PUBLIC_ORIGIN` 决定。

服务启动时自动应用幂等数据库迁移。已有数据库迁移和备份策略见架构文档。此仓库不含原始 199 MB 原型 ZIP，也不含其签名下载地址。

## 托管验收进展（2026-10-20）

已按授权推送到 `sanyexieai/Nolya` 的 `codex/nolya-local-mvp` 工作分支，默认分支 `main` 的初始化 README 未改动；未合并、部署或发布正式版本。

- [首轮 CI](https://github.com/sanyexieai/Nolya/actions/runs/39405043533) 的 verify job 完整通过，包含 Rust 1.90、综合回归、备份恢复及 Docker 镜像构建。
- [修复后 CI](https://github.com/sanyexieai/Nolya/actions/runs/39405738917) 的 browser job 通过 23 项检查，`page_errors: []`，保存 8 张合成数据截图（artifact 12257885291）。实际视口为 1440×1000 和 390×844；320/430px 仅有几何回归，不是浏览器验收。
- 前端测试已增至 54 项；第二轮 browser 与 verify（含 Docker 构建）均完整通过。

## 生产准备与备份

`docs/OPERATIONS.md` 提供 Linux/systemd、容器/Caddy 配置、健康探针、SQLite 在线备份和安全恢复流程；`deploy/` 为未实际部署的模板。生产模式设置 `NOLYA_ENV=production`，必须显式配置精确 HTTPS Origin 和 Secure Cookie；无效配置在创建数据库前拒绝启动。

`./scripts/verify.sh` 执行构建、单元/组件、HTTP 安全及业务、配置失败关闭、真实重启与备份恢复验证；真实浏览器另行执行 `tests/browser_run.sh`，不能用前者通过代替后者。

## 0.3 设计与社交分享候选

按用户原始设计包对齐样式，提供微信好友、朋友圈、抖音、小红书的真实海报和文案工作流，以及支持时的系统分享。平台入口不代表官方SDK直发，不会自动发布。详见 [设计来源](docs/DESIGN_ALIGNMENT.md)、[分享能力](docs/SOCIAL_SHARING.md) 和 [验收记录](docs/RELEASE_VERIFICATION.md)。
