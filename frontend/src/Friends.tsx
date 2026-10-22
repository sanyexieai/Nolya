import "./design-self-friends.css";
import { ResultShare, SocialShare } from "./Share";
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
        eyebrow="朋友反馈"
        title="邀请朋友回答 3 道题"
        description="邀请一位熟悉你的人，回答 3 道关于你的生活情境题。看看 TA 觉得你通常会怎么做。"
      />
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !resource.data ? (
        <Empty
          title="请先完成自我测评"
          action={
            <ActionLink to="/self">
              先开始我的镜像
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          完成 8 道题后，才能对照自己的答案与朋友反馈。
        </Empty>
      ) : (
        <>
          <section className="card invite-card">
            <div className="invite-editorial">
              <div className="invite-copy">
                <h2>邀请熟悉你的朋友提供反馈</h2>
                <p>朋友将根据平时对你的了解作答，结果不用于评分。</p>
                <ul className="invite-benefits">
                  <li>只需回答 3 道情境题</li>
                  <li>大约 30 秒，无需注册</li>
                  <li>第一位朋友答完后可查看反馈</li>
                </ul>
                <div className="invite-contexts">
                  <span>朋友</span>
                  <span>伴侣</span>
                  <span>同事</span>
                  <span>家人</span>
                </div>
              </div>
              <picture className="invite-photo">
                <source
                  media="(max-width: 700px)"
                  srcSet="/design/invite-mobile.png"
                />
                <img
                  src="/design/invite-desktop.png"
                  alt="三位朋友在咖啡馆轻松交流，每个人都带来不一样的视角"
                />
              </picture>
            </div>
            {link ? (
              <div className="share-section">
                <Badge>第一位朋友答完后，即可查看反馈</Badge>
                <SocialShare value={shareUrl(link, "friend")} kind="friend" />
                <Link to="/mirror" className="text-link">
                  查看回答进度 <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <>
                <p className="consent-summary">
                  创建邀请后，收到链接的人将看到你的昵称并回答关于你的问题。你可以在我的空间撤回邀请。
                </p>
                <Button onClick={create} busy={busy}>
                  <Link2 size={18} />
                  创建朋友邀请
                </Button>
              </>
            )}
            {error && <Notice>{error}</Notice>}
          </section>
          <div className="invite-steps">
            <span>01 分享邀请</span>
            <span>02 朋友回答 3 道题</span>
            <span>03 查看朋友反馈</span>
          </div>
          <PrivacyNote>
            只向你展示汇总视角。邀请链接可能被转发，请只发给你信任的人。
          </PrivacyNote>
          <div className="subtle-link-row">
            <Link to="/today">
              暂不邀请，回答今日问题 <ArrowRight size={15} />
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
    <div className="container design-friend-page">
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
          <PageHeading eyebrow="提交成功" title="你的回答已提交" />
          <section className="card success-card">
            <span className="success-icon">
              <Check size={36} />
            </span>
            <h2>你的 3 个选择已保存</h2>
            <p>
              {owner} 会在自己的镜像中看到汇总。
              <br />
              你也可以完成自己的自我测评。
            </p>
            <ActionLink to="/self">
              开始自我测评 <ArrowRight size={17} />
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
            ? "这次邀请已收齐回答。你可以开始自己的自我测评。"
            : "邀请可能已过期或被撤回，可以请朋友发来新的链接。"}
        </Empty>
      ) : session && q ? (
        <div className="design-friend-questions">
          <div className="design-friend-question-content">
            <img
              className="design-friend-question-thumbnail"
              src="/design/friend-question-portrait.png"
              alt="品牌人物示例，非邀请者照片"
            />
            <PageHeading
              eyebrow={`你眼中的 ${owner}`}
              title="请根据你对 TA 的了解作答"
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
              <PrivacyNote>请根据平时的观察作答，不需要判断对错。</PrivacyNote>
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
          </div>
          <aside className="design-friend-question-aside">
            <img
              src="/design/friend-question-portrait.png"
              alt="手持饮品的品牌人物"
              width="1410"
              height="1587"
            />
            <h2>根据你对 TA 的了解选择答案</h2>
            <p>按平时对 TA 的了解来选。你给出的是朋友视角，不是好坏评价。</p>
          </aside>
        </div>
      ) : (
        <div className="design-friend-landing">
          <div className="design-friend-landing-copy">
            <PageHeading
              eyebrow="来自一个熟悉的人的邀请"
              title={
                <>
                  {owner} 想知道，
                  <br />
                  TA 通常会怎么选。
                </>
              }
              description="共 3 道生活情境题，约需 30 秒。没有标准答案，无需填写姓名。"
            />
            <section className="card friend-landing">
              <ul className="design-friend-benefits">
                <li>只选 3 题</li>
                <li>大约 30 秒</li>
                <li>没有标准答案</li>
              </ul>
              <h2>完成 3 道题，向邀请人提供反馈</h2>
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
                说说我眼中的 TA
                <ArrowRight size={18} />
              </Button>
              {error && <Notice>{error}</Notice>}
            </section>
            <details className="design-friend-explainer">
              <summary>先看看怎么玩</summary>
              <ol>
                <li>三个生活场景：每题两个合理选项。</li>
                <li>凭平时的了解：不是答对错的考试。</li>
                <li>形成朋友视角：完成后，邀请人可查看你的观察。</li>
              </ol>
            </details>
          </div>
          <figure className="design-friend-landing-photo">
            <picture>
              <source
                media="(max-width: 700px)"
                srcSet="/design/friend-landing-mobile.png"
              />
              <img
                src="/design/friend-landing-desktop.png"
                alt="咖啡馆品牌人物与两张生活照片"
                width="862"
                height="799"
              />
            </picture>
            <figcaption>想到 TA 平时的样子，你会怎么选？</figcaption>
          </figure>
        </div>
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
    <div
      className={`container mirror-page design-mirror-page ${mirror?.state === "full" ? "design-mirror-full" : "design-mirror-first"}`}
    >
      <aside className="design-mirror-imagery" aria-label="品牌场景图">
        {mirror?.state === "full" ? (
          <>
            <picture>
              <source
                media="(max-width: 700px)"
                srcSet="/design/full-mirror-mobile.jpg"
              />
              <img
                className="design-mirror-main"
                src="/design/full-mirror-main.jpg"
                alt="阳光咖啡馆里的品牌人物"
              />
            </picture>
            <div className="design-mirror-insets">
              <img src="/design/full-mirror-glance.jpg" alt="" />
              <img src="/design/full-mirror-rest.jpg" alt="" />
            </div>
          </>
        ) : (
          <figure className="design-mirror-first-photo">
            <img
              src="/design/first-mirror-cafe.jpg"
              alt="在咖啡馆手持饮品的品牌人物"
              width="525"
              height="778"
            />
            <figcaption>自己的选择与朋友反馈</figcaption>
          </figure>
        )}
      </aside>
      <div className="design-mirror-content">
        <PageHeading
          eyebrow="朋友反馈结果"
          title={
            mirror?.state === "full"
              ? "3 份朋友反馈已收齐"
              : mirror?.completed_count
                ? "已收到朋友反馈"
                : "等待朋友回答"
          }
          description="对照你的测评结果与朋友在相关情境中的回答。"
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
            title="请先完成自我测评"
            action={
              <ActionLink to="/self">
                开始我的第一次镜像
                <ArrowRight size={17} />
              </ActionLink>
            }
          >
            完成 8 道题后，可邀请朋友回答并查看反馈。
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
                <h2>还没有收到朋友回答</h2>
                <p>
                  将邀请链接发送给熟悉你的朋友。
                  <br />
                  朋友完成回答后，结果会显示在这里。
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
                        <span>
                          {dimensionNames[c.dimension] || c.dimension}
                        </span>
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
                    <Badge pink>结果说明</Badge>
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
            {mirror.state === "full" && (
              <ResultShare
                kind="mirror"
                summary={
                  mirror.insights[0] ||
                  "我已完成自我测评，并收到朋友对相关情境的回答。"
                }
              />
            )}
            <div className="next-step-banner">
              <span className="round-icon">
                <Sparkles size={23} />
              </span>
              <div>
                <h2>邀请朋友猜测你的答案</h2>
                <p>从已回答的问题中选一道，邀请朋友猜测。</p>
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
    </div>
  );
}
