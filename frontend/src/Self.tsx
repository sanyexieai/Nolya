import { ResultShare } from "./Share";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Heart, Sparkles } from "lucide-react";
import { api, errorMessage, mutate, newKey } from "./api";
import type { Choice, Question, SelfResult } from "./api";
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
export function SelfPage() {
  const { ensureGuest } = useSession();
  const navigate = useNavigate();
  const resource = useResource(() =>
    api<{ version: string; questions: Question[] }>("/self/questions"),
  );
  const [answers, setAnswers] = useState<Record<string, Choice>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newKey());
  const data = resource.data;
  const question = data?.questions[index];
  function select(choice: Choice) {
    if (!question) return;
    const next = { ...answers, [question.id]: choice };
    setAnswers(next);
    key.current = newKey();
    setError("");
  }
  async function next() {
    if (!question || !data || !answers[question.id]) return;
    if (index < data.questions.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await ensureGuest();
      await mutate<SelfResult>(
        "/self/assessments",
        {
          version: data.version,
          answers: data.questions.map((q) => ({
            question_id: q.id,
            choice: answers[q.id],
          })),
        },
        key.current,
      );
      navigate("/self/result");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container flow-page">
      <div className="flow-intro">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          返回首页
        </Link>
        <PageHeading
          eyebrow="先从自己开始"
          title={
            <>
              先看看，
              <br />
              你会怎么选。
            </>
          }
          description="8 道生活题。别想太久，选更像你的那一边。"
        />
        <div className="self-side-art">
          <span>
            同一个人，
            <br />
            也会有不同的选择。
          </span>
          <div className="side-art-circle" />
          <Sparkles size={35} />
        </div>
        <PrivacyNote>
          完成后才会保存结果，离开此页将不保留未提交的选择。
        </PrivacyNote>
      </div>
      <div className="flow-content">
        {resource.loading ? (
          <Loading text="正在准备 8 个生活小问题…" />
        ) : resource.error ? (
          <Notice onRetry={resource.reload}>{resource.error}</Notice>
        ) : question && data ? (
          <>
            <section className="question-card">
              <div className="question-meta">
                <span>
                  <Sparkles size={16} />
                  你的选择
                </span>
                <strong>
                  {String(index + 1).padStart(2, "0")}{" "}
                  <small>
                    / {String(data.questions.length).padStart(2, "0")}
                  </small>
                </strong>
              </div>
              <Progress current={index + 1} total={data.questions.length} />
              <span className="eyebrow">第 {index + 1} 题</span>
              <h2>{question.prompt}</h2>
              <p className="question-hint">两个选项都没有对错。</p>
              <Options
                question={question}
                selected={answers[question.id]}
                onSelect={select}
                disabled={busy}
              />
              <PrivacyNote>按第一反应选就好，不用解释。</PrivacyNote>
            </section>
            {error && <Notice>{error}</Notice>}
            <div className="question-actions">
              <button
                className="text-button"
                disabled={index === 0 || busy}
                onClick={() => setIndex((i) => i - 1)}
              >
                <ArrowLeft size={18} />
                上一题
              </button>
              <Button
                disabled={!answers[question.id]}
                busy={busy}
                onClick={next}
              >
                {index === data.questions.length - 1
                  ? "看看我的第一张镜像"
                  : "下一题"}
                <ArrowRight size={19} />
              </Button>
            </div>
          </>
        ) : (
          <Empty title="暂时还没有题目">请稍后回来看看。</Empty>
        )}
      </div>
    </div>
  );
}
export function SelfResultPage() {
  const { user, loading } = useSession();
  const resource = useResource(
    () =>
      user ? api<SelfResult | null>("/self/latest") : Promise.resolve(null),
    [user?.id],
  );
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [busy, setBusy] = useState(false);
  const result = resource.data;
  async function rate(value: string) {
    if (!result) return;
    setBusy(true);
    setFeedbackError("");
    try {
      await mutate(
        `/self/assessments/${result.id}/feedback`,
        { rating: value },
        newKey(),
      );
      setFeedback(value);
    } catch (e) {
      setFeedbackError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container result-page">
      <PageHeading
        eyebrow="这是今天的你"
        title="你的第一张镜像，来了。"
        description="来自你的 8 个真实生活选择。一个开始，不是一个定义。"
      />
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !result ? (
        <Empty
          title="从一个选择开始认识自己"
          action={
            <ActionLink to="/self">
              开始 8 道生活题
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          完成后，你的第一张镜像会出现在这里。
        </Empty>
      ) : (
        <>
          <div className="result-grid">
            <section className="self-result-art">
              <div className="result-graphic">
                <div className="result-petal p1" />
                <div className="result-petal p2" />
                <div className="result-petal p3" />
                <div className="result-petal p4" />
                <Sparkles size={32} />
              </div>
              <span className="eyebrow">MY FIRST MIRROR</span>
              <h2>{result.summary}</h2>
              <p>更多面的你，值得慢慢看见。</p>
              <span className="result-signature">Nolya.</span>
            </section>
            <section className="card evidence-card">
              <Badge>从选择里，看见一点自己</Badge>
              <h2>有些倾向，已经露出轮廓</h2>
              <div className="observations">
                {result.observations.map((text, i) => (
                  <div className="observation" key={i}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
              <div className="feedback">
                <p>这张镜像像你吗？</p>
                <div>
                  {[
                    ["very_like", "挺像我"],
                    ["somewhat_like", "有一点像"],
                    ["not_like", "不太像"],
                  ].map(([value, label]) => (
                    <button
                      className={feedback === value ? "selected" : ""}
                      disabled={busy}
                      key={value}
                      onClick={() => rate(value)}
                    >
                      {feedback === value && <Check size={13} />} {label}
                    </button>
                  ))}
                </div>
                {feedback && (
                  <small role="status">已记下你的反馈，谢谢你。</small>
                )}
                {feedbackError && <Notice>{feedbackError}</Notice>}
              </div>
            </section>
          </div>
          <div className="next-step-banner">
            <span className="round-icon">
              <Heart size={25} />
            </span>
            <div>
              <h2>朋友眼里的你，也是这样吗？</h2>
              <p>邀请朋友，各用 3 个问题，给你一个新的视角。</p>
            </div>
            <ActionLink to="/invite">
              听听朋友怎么想
              <ArrowRight size={18} />
            </ActionLink>
          </div>
          <ResultShare kind="self" summary={result.summary} />
          <div className="result-bottom">
            <Link className="text-link" to="/today">
              今天再留一个小选择 <ArrowRight size={16} />
            </Link>
            <Link className="text-link muted" to="/self">
              重新回答
            </Link>
          </div>
          <PrivacyNote>
            这不是心理诊断，也不能用 8 个选择定义一个人。
          </PrivacyNote>
        </>
      )}
    </div>
  );
}
