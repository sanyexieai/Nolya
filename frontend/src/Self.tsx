import "./design-self-friends.css";
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
    <div className="container flow-page design-self-question">
      <div className="flow-intro">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          返回首页
        </Link>
        <PageHeading
          eyebrow="自我测评 · 8 道题"
          title={
            <>
              回答问题，
              <br />
              选择符合你的答案。
            </>
          }
          description="共 8 道生活情境题，请按你的实际情况选择。"
        />
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
                  ? "提交并查看结果"
                  : "下一题"}
                <ArrowRight size={19} />
              </Button>
            </div>
          </>
        ) : (
          <Empty title="暂时还没有题目">请稍后重试。</Empty>
        )}
      </div>
      <figure className="design-self-portrait">
        <img
          src="/design/self-question-portrait.jpg"
          alt="日常饮品场景中的品牌人物"
          width="1165"
          height="860"
        />
        <figcaption>请根据题目情境选择答案。</figcaption>
      </figure>
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
    <div className="container result-page design-self-result">
      <PageHeading
        eyebrow="自我测评结果"
        title="你的自我测评结果"
        description="结果基于本次 8 道题的答案，不代表完整的人格评价。"
      />
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !result ? (
        <Empty
          title="你还没有完成自我测评"
          action={
            <ActionLink to="/self">
              开始 8 道生活题
              <ArrowRight size={17} />
            </ActionLink>
          }
        >
          完成 8 道题后，可在这里查看结果。
        </Empty>
      ) : (
        <>
          <div className="result-grid">
            <figure className="design-result-portrait">
              <picture>
                <source
                  media="(max-width: 700px)"
                  srcSet="/design/self-result-mobile.jpg"
                />
                <img
                  className="design-result-main"
                  src="/design/ambassador-cafe.jpg"
                  alt="日常场景中的品牌人物"
                  width="1122"
                  height="1402"
                />
              </picture>
              <img
                className="design-result-inset"
                src="/design/ambassador-outdoor.jpg"
                alt=""
                width="1122"
                height="1402"
              />
              <figcaption>
                这只是你在这些情境里的选择，不是全部的你。
              </figcaption>
            </figure>
            <section className="card evidence-card">
              <Badge>本次回答结果</Badge>
              <h2>{result.summary}</h2>
              <div className="observations">
                {result.observations.map((text, i) => (
                  <div className="observation" key={i}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
              <div className="feedback">
                <p>这个结果符合你的实际情况吗？</p>
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
                {feedback && <small role="status">反馈已保存。</small>}
                {feedbackError && <Notice>{feedbackError}</Notice>}
              </div>
            </section>
          </div>
          <div className="next-step-banner">
            <span className="round-icon">
              <Heart size={25} />
            </span>
            <div>
              <h2>邀请朋友提供反馈</h2>
              <p>每位朋友回答 3 道题，完成后可对照你们的选择。</p>
            </div>
            <ActionLink to="/invite">
              邀请朋友回答
              <ArrowRight size={18} />
            </ActionLink>
          </div>
          <ResultShare kind="self" summary={result.summary} />
          <div className="result-bottom">
            <Link className="text-link" to="/today">
              回答今日问题 <ArrowRight size={16} />
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
