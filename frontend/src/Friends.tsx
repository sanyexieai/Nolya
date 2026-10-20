import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  Link2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { api, errorMessage, mutate, newKey, shareUrl } from "./api";
import type {
  Choice,
  FriendContext,
  FriendSession,
  Mirror,
  SelfResult,
  ShareLink,
} from "./api";
import { useSession } from "./session";
import {
  ActionLink,
  Badge,
  Button,
  CopyLink,
  Empty,
  Loading,
  Notice,
  Options,
  PageHeading,
  PrivacyNote,
  Progress,
  useResource,
} from "./ui";
export function InvitePage() {
  const { user, loading } = useSession();
  const resource = useResource(
    () =>
      user ? api<SelfResult | null>("/self/latest") : Promise.resolve(null),
    [user?.id],
  );
  const [link, setLink] = useState<ShareLink>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newKey());
  async function create() {
    if (!resource.data) return;
    setBusy(true);
    setError("");
    try {
      setLink(
        await mutate<ShareLink>(
          "/invites",
          { self_assessment_id: resource.data.id },
          key.current,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container narrow-page">
      <PageHeading
        eyebrow="换个角度，看见自己"
        title="你眼中的我，是什么样？"
        description="邀请 3 位熟悉你的朋友，每人回答 3 道生活题。"
      />
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !resource.data ? (
        <Empty
          title="先有自己的选择，再听朋友的视角"
          action={
            <ActionLink to="/self">
              先开始我的镜像
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          你的 8 个选择，会成为这次镜像的起点。
        </Empty>
      ) : (
        <>
          <section className="card invite-card">
            <div className="invite-art">
              <div className="invite-bubble">我</div>
              <div className="invite-bubble">你</div>
              <div className="invite-bubble">
                <Heart size={26} />
              </div>
              <Sparkles className="invite-spark" size={28} />
            </div>
            <h2>{link ? "邀请准备好了" : "留一点空间，给意外的发现"}</h2>
            <p>
              不是请朋友给你打分。
              <br />
              只是想知道，在另一个人眼里，你会怎么选。
            </p>
            <div className="invite-facts">
              <span>
                <Check size={15} />
                每人约 30 秒
              </span>
              <span>
                <Check size={15} />
                无需注册
              </span>
              <span>
                <Check size={15} />
                没有好坏之分
              </span>
            </div>
            {link ? (
              <div className="share-section">
                <Badge>把同一个链接发给 3 位朋友</Badge>
                <CopyLink value={shareUrl(link, "friend")} />
                <Link to="/mirror" className="text-link">
                  去看看镜像进度 <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <>
                <p className="consent-summary">
                  创建邀请后，收到链接的人将看到你的昵称并回答关于你的问题。你可以在我的空间撤回邀请。
                </p>
                <Button onClick={create} busy={busy}>
                  <Link2 size={18} />
                  生成朋友邀请链接
                </Button>
              </>
            )}
            {error && <Notice>{error}</Notice>}
          </section>
          <PrivacyNote>
            只向你展示汇总视角。邀请链接可能被转发，请只发给你信任的人。
          </PrivacyNote>
          <div className="subtle-link-row">
            <Link to="/today">
              暂时不邀请，先做今天的小选择 <ArrowRight size={15} />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
export function FriendPage() {
  const { token = "" } = useParams();
  const { ensureGuest, user, loading: sessionLoading } = useSession();
  const context = useResource(
    () => api<FriendContext>(`/invites/${encodeURIComponent(token)}`),
    [token, user?.id],
  );
  const [consent, setConsent] = useState(false);
  const [session, setSession] = useState<FriendSession>();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const startKey = useRef(newKey());
  const submitKey = useRef(newKey());
  const q = session?.questions[index];
  const owner = context.data?.owner_display_name || "TA";
  async function start() {
    setBusy(true);
    setError("");
    try {
      await ensureGuest();
      const result = await mutate<FriendSession>(
        `/invites/${token}/start`,
        { consent: true },
        startKey.current,
      );
      if (result.already_submitted) {
        setDone(true);
      } else {
        setSession(result);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    if (!session || !q || !answers[q.id]) return;
    if (index < session.questions.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await mutate(
        `/invites/${token}/responses`,
        {
          session_id: session.session_id,
          answers: session.questions.map((question) => ({
            question_id: question.id,
            choice: answers[question.id],
          })),
        },
        submitKey.current,
      );
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container narrow-page">
      {context.loading || sessionLoading ? (
        <Loading />
      ) : context.error ? (
        <>
          <PageHeading eyebrow="朋友的邀请" title="暂时打不开这张邀请" />
          <Notice onRetry={context.reload}>{context.error}</Notice>
          <ActionLink to="/">回到首页</ActionLink>
        </>
      ) : done || context.data?.already_submitted ? (
        <>
          <PageHeading
            eyebrow="一个新视角，已送达"
            title="谢谢，你眼中的 TA 很珍贵。"
          />
          <section className="card success-card">
            <span className="success-icon">
              <Check size={36} />
            </span>
            <h2>你的 3 个选择已保存</h2>
            <p>
              {owner} 会在自己的镜像中看到汇总。
              <br />
              如果你也好奇，试着看看自己吧。
            </p>
            <ActionLink to="/self">
              看看我会怎么选 <ArrowRight size={17} />
            </ActionLink>
          </section>
        </>
      ) : context.data?.is_owner ? (
        <Empty
          title="这是你自己的邀请"
          action={
            <ActionLink to="/mirror">
              查看我的镜像
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          把链接发给熟悉你的朋友，让他们带来独立的视角。你不能回答自己的邀请。
        </Empty>
      ) : context.data?.status !== "active" ? (
        <Empty
          title={
            context.data?.status === "full"
              ? "这张镜像的 3 个视角已经齐了"
              : "这张邀请已经结束"
          }
          action={
            <ActionLink to="/self">
              开始我自己的镜像
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          {context.data?.status === "full"
            ? "这次已经收到足够的回答。你也可以开始发现自己的另一面。"
            : "邀请可能已过期或被撤回，可以请朋友发来新的链接。"}
        </Empty>
      ) : session && q ? (
        <>
          <PageHeading
            eyebrow={`你眼中的 ${owner}`}
            title="熟悉 TA 的你，会怎么选？"
            description="选更接近你平时观察的那一边，不用猜 TA 的答案。"
          />
          <section className="question-card">
            <div className="question-meta">
              <span>
                <Heart size={16} />
                你的视角
              </span>
              <strong>
                {String(index + 1).padStart(2, "0")} <small>/ 03</small>
              </strong>
            </div>
            <Progress current={index + 1} total={3} />
            <h2>{q.prompt}</h2>
            <Options
              question={q}
              selected={answers[q.id]}
              onSelect={(choice) => {
                setAnswers({ ...answers, [q.id]: choice });
                submitKey.current = newKey();
              }}
              disabled={busy}
            />
            <PrivacyNote>你看见的，只是 TA 真实的一面。</PrivacyNote>
          </section>
          {error && <Notice>{error}</Notice>}
          <div className="question-actions">
            <button
              className="text-button"
              disabled={index === 0 || busy}
              onClick={() => setIndex((i) => i - 1)}
            >
              <ArrowLeft size={16} />
              上一题
            </button>
            <Button disabled={!answers[q.id]} busy={busy} onClick={next}>
              {index === 2 ? "送出我的视角" : "下一题"}
              <ArrowRight size={18} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <PageHeading
            eyebrow="来自一个熟悉的人的邀请"
            title={
              <>
                {owner} 想知道，
                <br />
                你眼中的 TA。
              </>
            }
            description="3 个轻松的生活选择，大概半分钟。没有标准答案，也不用填写姓名。"
          />
          <section className="card friend-landing">
            <div className="friend-hearts">
              <Heart size={52} />
              <Sparkles size={24} />
            </div>
            <h2>你看见的那一面，或许 TA 还不知道</h2>
            <p>
              请按平时的观察回答，别先看 TA 自己的答案。独立的视角，才有意思。
            </p>
            <div className="privacy-box">
              <ShieldCheck size={23} />
              <p>
                {context.data?.privacy_notice ||
                  "你的结构化选择将作为汇总反馈给邀请人。只有一位参与者时，邀请人可能看出这是你的个人视角；这不是完全匿名的回答。"}
              </p>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>我理解以上说明，同意把这 3 个选择分享给邀请人</span>
            </label>
            <Button disabled={!consent} busy={busy} onClick={start}>
              说说我眼中的 {owner}
              <ArrowRight size={18} />
            </Button>
            {error && <Notice>{error}</Notice>}
          </section>
        </>
      )}
    </div>
  );
}
const dimensionNames: Record<string, string> = {
  D1: "生活的节奏",
  D2: "表达的方式",
  D3: "面对新鲜事",
  D4: "情绪的流动",
};
export function MirrorPage() {
  const { user, loading } = useSession();
  const resource = useResource(
    () => (user ? api<Mirror>("/mirror") : Promise.resolve(null)),
    [user?.id],
  );
  const mirror = resource.data;
  useEffect(() => {
    if (!user || !mirror || mirror.state === "full") return;
    const timer = setInterval(resource.reload, 30000);
    return () => clearInterval(timer);
  }, [user?.id, mirror?.state]);
  return (
    <div className="container mirror-page">
      <PageHeading
        eyebrow="同一个你，换个角度看看"
        title={
          mirror?.state === "full"
            ? "三个视角，让你更立体。"
            : mirror?.completed_count
              ? "朋友眼中的你，开始浮现。"
              : "朋友眼中的你，会是什么样？"
        }
        description="把自己的选择，与熟悉你的人的观察，轻轻放在一起。"
      >
        <button
          className="icon-button refresh-button"
          title="刷新镜像"
          aria-label="刷新镜像"
          onClick={resource.reload}
        >
          <RefreshCw size={19} />
        </button>
      </PageHeading>
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !mirror?.self_assessment_id ? (
        <Empty
          title="镜像，从自己的选择开始"
          action={
            <ActionLink to="/self">
              开始我的第一次镜像
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          先留下 8 个生活选择，再邀请朋友发现更多面的你。
        </Empty>
      ) : (
        <>
          <div className="mirror-status">
            <div className="respondent-dots">
              {[0, 1, 2].map((i) => (
                <span
                  className={i < mirror.completed_count ? "completed" : ""}
                  key={i}
                >
                  {i < mirror.completed_count ? (
                    <Check size={19} />
                  ) : (
                    <Users size={18} />
                  )}
                </span>
              ))}
            </div>
            <div>
              <strong>{mirror.completed_count} / 3 个独立视角已送达</strong>
              <p>
                {mirror.completed_count === 0
                  ? "朋友还没有回答，先把链接分享给 TA 吧。"
                  : mirror.completed_count < 3
                    ? "先看看这些独立观察，3 个视角齐了再比较共识。"
                    : "这一次，三个独立视角都已到齐。"}
              </p>
            </div>
            <ActionLink to="/invite" secondary>
              {mirror.completed_count ? "查看邀请链接" : "邀请朋友"}
              <ArrowRight size={17} />
            </ActionLink>
          </div>
          {mirror.completed_count === 0 ? (
            <section className="card waiting-mirror">
              <div className="waiting-orbit">
                <Heart size={42} />
                <span>✧</span>
              </div>
              <h2>新的视角，值得等待</h2>
              <p>
                不用催，也不用特意选“最了解你”的人。
                <br />
                不同相处方式，会带来不同的观察。
              </p>
              <Link className="text-link" to="/self/result">
                先看看自己眼中的我 <ArrowRight size={16} />
              </Link>
            </section>
          ) : (
            <>
              <div className="mirror-legend">
                <span>
                  <span className="legend-dot purple" />
                  自己眼中的我
                </span>
                <span>
                  <span className="legend-dot pink" />
                  朋友看到的我
                </span>
              </div>
              <div className="comparison-grid">
                {mirror.comparisons.map((c) => (
                  <section className="card comparison-card" key={c.dimension}>
                    <div className="comparison-heading">
                      <span>{dimensionNames[c.dimension] || c.dimension}</span>
                      {mirror.state === "full" &&
                        c.relation !== "insufficient" && (
                          <span
                            className={`relation-tag ${c.relation === "gap" ? "gap" : ""}`}
                          >
                            {c.relation === "aligned"
                              ? "想在了一起"
                              : c.relation === "gap"
                                ? "一个意外的不同"
                                : "更看情境"}
                          </span>
                        )}
                    </div>
                    <div className="comparison-own">
                      <small>你自己的选择</small>
                      <h3>{c.self_label}</h3>
                    </div>
                    <div className="comparison-friend">
                      <small>{c.sample_size} 个独立视角</small>
                      <h3>{c.friend_label || "还需要更多观察"}</h3>
                      <div className="count-pills">
                        <span>A · {c.a_count} 人</span>
                        <span>B · {c.b_count} 人</span>
                      </div>
                    </div>
                    {mirror.state !== "full" && (
                      <p className="small muted">
                        目前是个人观察，还不能代表朋友们的共识。
                      </p>
                    )}
                  </section>
                ))}
              </div>
              {mirror.insights.length > 0 && (
                <section className="mirror-insights">
                  <Badge pink>值得留意的小发现</Badge>
                  {mirror.insights.map((insight, i) => (
                    <p key={i}>{insight}</p>
                  ))}
                </section>
              )}
            </>
          )}
          <Notice kind="info">
            {mirror.identity_notice ||
              "目前按独立浏览器或账户区分参与者，无法证明是三个不同的真实人物。"}
          </Notice>
          <div className="next-step-banner">
            <span className="round-icon">
              <Sparkles size={23} />
            </span>
            <div>
              <h2>那 TA 能猜中你的选择吗？</h2>
              <p>选一个真实答案，看看你们想到一起了没有。</p>
            </div>
            <ActionLink to="/guess/new">
              让朋友猜猜
              <ArrowRight size={18} />
            </ActionLink>
          </div>
          <PrivacyNote>
            这是不同视角之间的对照，不是评判，也不是谁对谁错。
          </PrivacyNote>
        </>
      )}
    </div>
  );
}
