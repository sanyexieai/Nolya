# 独立真实 HTTP 验收记录

日期：2026-10-19 04:07 UTC。

## 范围和环境

本轮运行自行编写的 Python 标准库测试 `tests/e2e_api.py`，连接本地 Rust 服务 `127.0.0.1:3002`，使用新建隔离 SQLite 数据库。没有 mock API，没有直接插入数据库伪造群体人数，没有执行上传包中的程序。测试生成的会话/凭据只存于项目外临时文件，未加入项目。

注意执行环境不同 shell 的网络进程不可假定共享；启动服务、测试和实际重启都放在同一个 shell，结束由 trap 清理指定 PID。未启动部署或公开服务。

## 发现并修复的问题

第一次端到端测试在 Friends 提交触发 HTTP 500。原因是联表查询的 `respondent_id` 未限定表名，SQLite 返回 ambiguous column name。后端维护者修复并重新构建后，本轮使用全新数据库完整重跑通过。

## 已通过的实际断言

- 五个独立 CookieJar 创建不同服务端身份；GET session 不自动创建用户
- 8题/4维×2的题库及缺答拒绝；全A正确得分；目标维度D1/D2/D4
- 缺失CSRF、错误Origin拒绝；同幂等key同body复用结果、不同body冲突
- owner不能为自己填朋友题；三个朋友各3个平行题；同身份重复start不占多槽
- 跨身份拿别人的反馈session提交被拒绝
- 1/2/3份反馈分别first/partial/full；未满3不提前宣称共识
- D1三票A为一致，D2两B一A对Self A构成2/3差异
- 重复提交不加人数；第4位拒绝；无关身份不能读owner指定镜像
- 返回明确浏览器身份口径和限制，不声称证明3个真人
- Pulse未答无crowd，别人答后未答者仍不可读分布
- 相同票重提不增计数，不同票冲突
- 50个真实HTTP测试身份投票：N=1至49无精确百分比；N=50时1A/49B为2%/98%
- Guess不存在来源被拒绝；提交前无真实答案/正确性字段
- owner不能猜自己；有效提交后得到真实答案与正确性
- 重复相同猜测不加关系计数、改猜冲突；第三者仍不可看揭晓
- 撤销后GET和提交均不可参与或泄露答案
- 新Self不修改旧campaign快照，最新镜像不混入旧判断
- 四个身份并发抢3槽，准确3个成功；随后六次并发重复提交只产生3份反馈
- 游客注册原地升级，身份和Self/镜像/Pulse保持
- **实际停止服务进程，再用同SQLite重启**；续验账户、Self、镜像、日记、已猜者Reveal均通过

两个阶段退出码均为0。API基础验收通过不代表UI、生产部署或所有产品功能完成。

## 未验收和限制

- 邀请/会话到期需要可注入时钟的后端单元测试，本HTTP脚本不通过生产调时接口绕过
- 登录已有账户的游客合并与冲突策略尚未在本轮验收
- 七个不同日期的Solo证据、跨地区/跨版本统计隔离、导出/删除、真实浏览器UI另需验收
- 这些都是测试浏览器身份，不能替代真人防刷；清Cookie/换设备的Sybil风险仍存在
- 未核对商业肖像许可，未公开上线，未推送远端

## 复现命令

在项目根目录使用独立数据库。以下标识均为测试本地路径，不应指向生产库。若重跑首阶段，请换一个全新的数据库文件，因为50票边界断言要求空数据。

```sh
export NOLYA_BIND=127.0.0.1:3002
export NOLYA_DB_PATH=/tmp/nolya-independent-e2e-new.sqlite
export NOLYA_ALLOWED_ORIGINS=http://127.0.0.1:3002
export NOLYA_PUBLIC_ORIGIN=http://127.0.0.1:3002
backend/target/debug/nolya-api >/tmp/nolya-e2e.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
sleep 1
python3 tests/e2e_api.py --base http://127.0.0.1:3002 --state /tmp/nolya-e2e-state.json
kill "$pid"; wait "$pid" || true
backend/target/debug/nolya-api >>/tmp/nolya-e2e.log 2>&1 &
pid=$!
sleep 1
python3 tests/e2e_api.py --base http://127.0.0.1:3002 --state /tmp/nolya-e2e-state.json --resume
```

实际验收使用同一启动方式，在首阶段通过后显式kill指定PID，并重新启动同一二进制与同一数据库；不是仅重复GET。状态文件权限0600，内含临时测试会话，不应上传或提交。
