# 独立验收测试

全部脚本只能使用测试数据库和合成身份，不要指向真实用户服务。测试会创建账户、提交答案、撤销邀请；安全回归还会删除合成账户。

## HTTP 主流程

Python 3 标准库，无第三方依赖：

```sh
python3 tests/e2e_api.py --base http://127.0.0.1:3001 --state /tmp/nolya-test-state.json
# 停止并重启服务，保留同一测试数据库，然后：
python3 tests/e2e_api.py --base http://127.0.0.1:3001 --state /tmp/nolya-test-state.json --resume
```

会话 state 文件含测试凭据，权限应为0600，不得提交或打包。配置 `NOLYA_ALLOWED_ORIGINS` 包含测试端口的 Origin。测试需要全新数据库和未被其他测试投票污染的每日题目。

## 浏览器

浏览器测试依赖 Playwright 和 Chromium。用 `npm ci --prefix tests` 安装锁定版本，再用 `tests/node_modules/.bin/playwright install --with-deps chromium` 安装对应浏览器，或设置 `CHROMIUM_PATH` 使用已安装 Chromium。

```sh
bash tests/browser_run.sh
```

先构建前后端，启动器会创建并清理隔离后端和测试数据库。只允许 loopback 和显式合成测试标记；不可指向已有真实服务。默认输出截图到 `artifacts/browser/`；此目录不进入源代码分发包。脚本覆盖真实页面答题、每日选择、结果刷新、主要路由和手机横向溢出。它不替代 API 的完整边界回归，也不是完整可访问性审计。

在进程命名空间隔离的执行器中，启动服务和测试必须放在同一 shell 内，用 trap 清理自己启动的进程；不要假定另一工具调用能访问之前的 localhost。


## 访客合并与安全回归

```sh
cargo build --manifest-path backend/Cargo.toml
python3 tests/security_api.py
python3 tests/merge_api.py
```

两者均自行创建临时数据库与只监听 loopback 的服务，同一调用内启动和清理，不接受既有数据库或外部服务地址。`merge_api.py` 的每个用例使用独立服务和合成账户，避免测试绕过真实认证限流；`--case` 可按名称筛选，`--port` 可指定未占用端口。运行完成会清理全部测试凭据和数据库。

`./scripts/verify.sh` 包含 Rust 格式/测试/Clippy、前端构建与测试、隔离 HTTP 回归、真实重启及备份恢复。真实浏览器验收单独运行，不能把该脚本通过等同于 UI 验收。

前端 `npm test` 包含 API helper 测试与 jsdom/React 的账户组件测试。组件测试验证确认、取消、身份切换、迟到响应、失败/失效与请求去重；它使用模拟网络和 DOM，不证明 Chromium 点击、布局、视觉、移动视口或可访问性通过。


## 产品化候选综合验收

`./scripts/verify.sh` 现在还包含 `auth_security_api.py`、`product_api.py`、`config_api.py`、`restart_e2e.py` 和 `scripts/ops/` 的两套备份恢复检查。`restart_e2e.py` 实际执行 SIGTERM 停止和同一数据库重启，不是只打印操作建议。所有新脚本使用隔离临时数据库与合成身份。

`tests/release_audit_api.py` 是已发现会话撤销问题的定向回归，不能当作全面独立安全审计。浏览器仍须单独运行；当前环境阻塞详见 `docs/BROWSER_ACCEPTANCE.md`。

托管 CI 配置了独立 browser job：安装锁定 Playwright/Chromium，运行一次性合成数据库验收，并保留7天截图。已运行的具体 commit、CI 和截图证据见 `docs/RELEASE_VERIFICATION.md`；前一提交的通过不能外推到后一提交。

## 社交分享回归

share_browser.cjs由浏览器主流程调用，验证四平台PNG下载尺寸/签名、独立jsQR解码、文案编辑及320/390px布局。系统分享和剪贴板使用API替身验证载荷及取消/失败语义，不表示真实平台发送。额外验证320/430/768/1440px主路由和原图加载。合成截图与海报保存在浏览器artifact。

### 中文字体与正常视口截图

浏览器 CI 安装 Ubuntu 官方 fonts-noto-cjk，并通过 fontconfig 确认 Noto Sans CJK 可用；标题另检查实际计算字重至少 700。应用没有远程字体依赖，使用 PingFang、Microsoft YaHei 及 Noto 系统回退，并允许粗体合成，避免仅 Regular 回退字体导致中文标题偏细。

首页和 Page09 保留桌面/手机截图。分享手机截图先清除键盘测试焦点，分别记录预览和主要操作的正常视口，不为了截图移除无障碍跳转链接或固定导航。PNG 海报仍独立验证尺寸与二维码。最终图必须对应交付 commit 或同 tree 的 PR 测试 merge；旧截图不证明后续视觉改动。

## 首页随机文案回归

home_copy_browser.cjs 在独立浏览器上下文控制随机数，逐一验证五组完整文案在320/390/430/1440px的排版、图文边界与真实CTA可达性，保留20张局部截图与home-copy-variants.json。它另外通过真实访客身份刷新验证本次访问稳定，通过SPA离开/返回验证重新抽选与自然重复。生产代码不提供选择文案的查询参数。详见[文案与抽选规则](../docs/HOME_COPY_VARIANTS.md)。
