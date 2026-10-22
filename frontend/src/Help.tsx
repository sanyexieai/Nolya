import { BrandCompanion } from "./ui";
import { Link } from "react-router-dom";
import { PageHeading, PrivacyNote } from "./ui";
export function HelpPage() {
  return (
    <div className="container narrow-page">
      <BrandCompanion label="先清楚了解，再安心选择" />
      <PageHeading
        eyebrow="清楚了解，再安心选择"
        title="使用帮助与隐私说明"
        description="Nolya 是生活选择的记录与比较工具，不是心理测评、诊断或人格定论。"
      />
      <section className="card help-content">
        <h2>你的选择如何使用</h2>
        <p>
          自我镜像依据你保存的 8
          个选择生成。每日选择只记录当天答案，不会自动改写镜像。结果反映当下情境，不代表固定特质。
        </p>
        <h3>朋友能看到什么？</h3>
        <p>
          朋友邀请会显示你的昵称和关于你的问题。你看到的是朋友选择的汇总；只有一位回应时可能推断其个人选择，因此不承诺完全匿名。参与者以浏览器或账户区分，不能证明是真实的不同人物。
        </p>
        <h3>猜测与链接</h3>
        <p>
          猜测邀请在对方提交后揭晓你的真实答案。任何拿到普通分享链接的人都可能参与，请只发送给信任的人。反向邀请仅供原邀请人参与。你可在我的空间查看有效期并撤回链接，撤回不会删除已保存的互动。
        </p>
        <h3>人群比较是什么？</h3>
        <p>
          仅比较本次题目的实际参与者，不代表社会整体。样本少时不显示百分比；人数增加后比较结果可能变化。没有哪一边更正确。
        </p>
      </section>
      <section className="card help-content">
        <h2>保存、找回与删除</h2>
        <details open>
          <summary>访客记录能保存多久？</summary>
          <p>
            访客记录依赖当前浏览器的 Cookie。到期时间可在我的空间查看。清除
            Cookie、退出或更换设备后可能无法找回，建议保存为账户或先导出数据。
          </p>
        </details>
        <details>
          <summary>已有账户怎么合并访客记录？</summary>
          <p>
            登录时先验证账户并查看合并预览，之后单独确认。存在同日回答、重复参与或自评自猜等冲突时，不会跳过或丢弃记录。可导出访客记录或注册另一个账户保留两个空间。
          </p>
        </details>
        <details>
          <summary>忘记密码怎么办？</summary>
          <p>
            在账户安全中预先生成恢复码，安全保存到密码管理器。恢复码只显示一次，新码会替代旧码；使用后失效。没有有效恢复码时暂不支持邮箱或人工找回。
          </p>
        </details>
        <details>
          <summary>如何导出或删除记录？</summary>
          <p>
            账户页可以下载 JSON
            数据副本，包含你保存的记录。删除需要明确确认；注册账户还需验证当前密码。删除不可恢复，并会撤回有效邀请。已被他人自行复制或保存的内容无法远程收回。
          </p>
        </details>
        <details>
          <summary>网络中断或链接打不开？</summary>
          <p>
            先保留当前页面，检查网络并使用页面的重试按钮。链接可能已过期、被撤回或名额已满，可联系邀请人确认。提交后先查看已保存结果，不要通过新建账户重复参与。
          </p>
        </details>
        <div className="settings-actions">
          <Link className="button secondary" to="/account">
            账户与数据
          </Link>
          <Link className="button secondary" to="/space">
            管理我的邀请
          </Link>
        </div>
      </section>
      <PrivacyNote>不自动发布你的结果，也不自动向朋友发送消息。</PrivacyNote>
    </div>
  );
}
