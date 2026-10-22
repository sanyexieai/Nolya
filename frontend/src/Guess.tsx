import "./design-guess.css";
import { invitationShareKind } from "./share-core";
import { SocialShare } from "./Share";
import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Lightbulb, Sparkles } from "lucide-react";
import { api, errorMessage, mutate, newKey, shareUrl } from "./api";
import type {
  Choice,
  GuessContext,
  JournalEntry,
  Question,
  Reveal,
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
  useResource,
} from "./ui";
interface SourceAnswer {
  id: string;
  type: "self" | "pulse";
  question: Question;
}
export function GuessNewPage() {
  const { user, loading } = useSession();
  const [params] = useSearchParams();
  const sourceId = params.get("answer");
  const resource = useResource(async () => {
    if (!user)
      return {
        answers: [] as SourceAnswer[],
        next_cursor: null as string | null,
      };
    const [self, questions, journal] = await Promise.all([
      api<SelfResult | null>("/self/latest"),
      api<{ questions: Question[] }>("/self/questions"),
      api<{ entries: JournalEntry[]; next_cursor: string | null }>(
        "/journal?limit=20",
      ),
    ]);
    if (
      sourceId &&
      !journal.entries.some((entry) => entry.answer_id === sourceId) &&
      !self?.answers.some((answer) => answer.id === sourceId)
    ) {
      journal.entries.unshift(
        await api<JournalEntry>(
          `/journal/entries/${encodeURIComponent(sourceId)}`,
        ),
      );
    }
    return {
      next_cursor: journal.next_cursor,
      answers: [
        ...journal.entries.map((e) => ({
          id: e.answer_id,
          type: "pulse" as const,
          question: e.question,
        })),
        ...(self?.answers.flatMap((a) => {
          const q = questions.questions.find((q) => q.id === a.question_id);
          return q
            ? [
                {
                  id: a.id,
                  type: "self" as const,
                  question: q,
                },
              ]
            : [];
        }) || []),
      ],
    };
  }, [user?.id, sourceId]);
  const [selectedId, setSelectedId] = useState(sourceId || "");
  const [link, setLink] = useState<ShareLink>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newKey());
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const identity = useRef(user?.id);
  identity.current = user?.id;
  async function more() {
    if (!resource.data?.next_cursor || loadingMore) return;
    const owner = user?.id;
    setLoadingMore(true);
    setMoreError("");
    try {
      const next = await api<{
        entries: JournalEntry[];
        next_cursor: string | null;
      }>(
        `/journal?limit=20&cursor=${encodeURIComponent(resource.data.next_cursor)}`,
      );
      if (identity.current !== owner) return;
      const seen = new Set(resource.data.answers.map((a) => a.id));
      const answers = next.entries
        .filter((e) => !seen.has(e.answer_id))
        .map((e) => ({
          id: e.answer_id,
          type: "pulse" as const,
          question: e.question,
        }));
      resource.setData({
        answers: [...resource.data.answers, ...answers],
        next_cursor: next.next_cursor,
      });
    } catch (e) {
      if (identity.current === owner) setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }
  const selected =
    resource.data?.answers.find((a) => a.id === selectedId) ??
    resource.data?.answers[0];
  function changeQuestion() {
    const answers = resource.data?.answers || [];
    if (!answers.length) return;
    const index = answers.findIndex((answer) => answer.id === selected?.id);
    setSelectedId(answers[(index + 1) % answers.length].id);
    key.current = newKey();
  }
  async function create() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      setLink(
        await mutate<ShareLink>(
          "/guesses",
          { source_type: selected.type, answer_id: selected.id },
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
    <div className="container guess-launch-page">
      <div className="guess-launch-editorial">
        <div className="guess-launch-copy">
          <PageHeading
            eyebrow="GUESS ME · 猜猜我的选择"
            title="选择一道题，邀请朋友猜答案"
            description="从已回答的题目中选择一道，邀请朋友猜测。朋友提交后才会看到你的答案。"
          />
          {loading || resource.loading ? (
            <Loading />
          ) : resource.error ? (
            <Notice onRetry={resource.reload}>{resource.error}</Notice>
          ) : !resource.data?.answers.length ? (
            <Empty
              title="请先回答一道问题"
              action={
                <ActionLink to="/today">
                  回答今日问题
                  <ArrowRight size={17} />
                </ActionLink>
              }
            >
              猜测的答案来自你真实的选择，而不是临时为朋友设置的谜底。
            </Empty>
          ) : link ? (
            <section className="card success-card">
              <span className="success-icon">
                <Sparkles size={31} />
              </span>
              <Badge>答案已保存</Badge>
              <h2>朋友将猜测这道题</h2>
              <p>{selected?.question.prompt}</p>
              <SocialShare value={shareUrl(link, "guess")} kind="guess" />
              <PrivacyNote>朋友提交猜测后，才会看到你选的答案。</PrivacyNote>
              <Link className="text-link" to="/space">
                回到我的空间 <ArrowRight size={16} />
              </Link>
            </section>
          ) : (
            <section className="card guess-picker">
              {selected && (
                <section
                  className="guess-readonly-question"
                  aria-label="这次让朋友猜的题"
                >
                  <span className="eyebrow">这次让朋友猜的题</span>
                  <h2>{selected.question.prompt}</h2>
                  <div className="guess-option-previews">
                    <div>
                      <strong>A</strong>
                      <span>{selected.question.choice_a}</span>
                    </div>
                    <div>
                      <strong>B</strong>
                      <span>{selected.question.choice_b}</span>
                    </div>
                  </div>
                  <PrivacyNote>
                    你的选择已保存。朋友提交预测后，才会看到真实答案。
                  </PrivacyNote>
                </section>
              )}
              <details className="guess-source-picker">
                <summary>从已答过的题里选择</summary>
                <div
                  className="source-list"
                  role="radiogroup"
                  aria-label="选择要分享的真实答案"
                >
                  {resource.data.answers.map((answer) => (
                    <SourceOption
                      key={answer.id}
                      answer={answer}
                      disabled={busy}
                      selected={selected?.id === answer.id}
                      onSelect={() => {
                        setSelectedId(answer.id);
                        key.current = newKey();
                      }}
                    />
                  ))}
                </div>
                {resource.data.next_cursor && (
                  <Button
                    secondary
                    busy={loadingMore}
                    disabled={busy}
                    onClick={more}
                  >
                    加载更早的每日选择
                  </Button>
                )}
                {moreError && <Notice>{moreError}</Notice>}
              </details>
              <div className="privacy-box">
                <Lightbulb size={22} />
                <p>
                  创建邀请表示你愿意向参与猜测的人揭晓这个答案。分享前，再确认它是你愿意让朋友知道的选择。
                </p>
              </div>
              <div className="guess-launch-actions">
                <Button disabled={!selected} busy={busy} onClick={create}>
                  发给朋友猜猜 <ArrowRight size={18} />
                </Button>
                <Button
                  secondary
                  disabled={busy || resource.data.answers.length < 2}
                  onClick={changeQuestion}
                >
                  换一道题
                </Button>
              </div>
              {error && <Notice>{error}</Notice>}
            </section>
          )}
          <Link className="guess-solo-link text-link" to="/today">
            暂时不邀请？也可以先回到今天。 <ArrowRight size={16} />
          </Link>
        </div>
        <figure className="guess-launch-portrait">
          <img
            src="/design/guess-outdoor.png"
            width="1122"
            height="1402"
            alt="春日河畔的品牌示意人物，非真实用户结果"
          />
          <figcaption>
            提交猜测后揭晓答案。 <Sparkles size={20} aria-hidden="true" />
          </figcaption>
        </figure>
      </div>
      <section className="guess-launch-steps" aria-label="猜测如何进行">
        <article>
          <span>01</span>
          <div>
            <h3>你的选择，先保密</h3>
            <p>只用你真正答过的题</p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <h3>朋友先猜，再提交</h3>
            <p>猜之前，看不到你的答案</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <h3>提交后查看答案</h3>
            <p>对照猜测与原答案</p>
          </div>
        </article>
      </section>
    </div>
  );
}
function SourceOption({
  answer,
  selected,
  onSelect,
  disabled,
}: {
  answer: SourceAnswer;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`source-option ${selected ? "selected" : ""}`}
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="source-radio">{selected && <Check size={13} />}</span>
      <div>
        <small>{answer.type === "pulse" ? "每日选择" : "自我镜像"}</small>
        <strong>{answer.question.prompt}</strong>
      </div>
    </button>
  );
}
export function GuessPage() {
  const { token = "" } = useParams();
  const { ensureGuest, user, loading: sessionLoading } = useSession();
  const resource = useResource(
    () => api<GuessContext>(`/guesses/${encodeURIComponent(token)}`),
    [token, user?.id],
  );
  const [choice, setChoice] = useState<Choice>();
  const [reveal, setReveal] = useState<Reveal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reverseOpen, setReverseOpen] = useState(false);
  const [ownChoice, setOwnChoice] = useState<Choice>();
  const [reverseLink, setReverseLink] = useState<ShareLink>();
  const submitKey = useRef(newKey());
  const reverseKey = useRef(newKey());
  const context = resource.data;
  const result = reveal || context?.reveal;
  const owner = context?.owner_display_name || "TA";
  async function submit() {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      await ensureGuest();
      setReveal(
        await mutate<Reveal>(
          `/guesses/${token}/answers`,
          { choice },
          submitKey.current,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reverse() {
    if (!ownChoice) return;
    setBusy(true);
    setError("");
    try {
      setReverseLink(
        await mutate<ShareLink>(
          `/guesses/${token}/reverse`,
          { choice: ownChoice },
          reverseKey.current,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const question = context?.question;
  const isReverse = !!context?.is_directed;
  const ready =
    reverseLink || (context?.is_owner && isReverse ? { token } : undefined);
  return (
    <div className="container guess-flow-page">
      {sessionLoading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <>
          <PageHeading eyebrow="猜测邀请" title="暂时打不开这个问题" />
          <Notice onRetry={resource.reload}>{resource.error}</Notice>
        </>
      ) : !context || !question || context.status !== "active" ? (
        <Empty
          title="这次猜测已经结束"
          action={
            <ActionLink to="/today">
              回答今日问题 <ArrowRight size={17} />
            </ActionLink>
          }
        >
          链接可能已过期或被撤回，可以向朋友要一个新的邀请。
        </Empty>
      ) : ready ? (
        <>
          <div
            className="guess-flow-grid reverse-ready-layout"
            data-design-page="12"
          >
            <div className="reverse-ready-scene">
              <GuessArtwork scene="ready" />
              <PageHeading
                eyebrow="反向邀请 · 题目已准备"
                title="题目准备好了，发给 TA 吧。"
                description="你的真实选择已保存。只发给刚才邀请你的那位朋友，等 TA 提交猜测后再揭晓。"
              />
            </div>
            <div className="guess-flow-content">
              <section className="card guess-preview-card">
                <Badge>这次你让 TA 猜的是</Badge>
                <h2>{question.prompt}</h2>
                <ReadOnlyQuestion question={question} />
                <PrivacyNote>
                  答案已保密。链接创建成功不代表消息已经送达。
                </PrivacyNote>
              </section>
              <section className="card reverse-status-card">
                <h2>接下来的步骤</h2>
                <ol>
                  <li aria-current="step">
                    <strong>01 题目已准备</strong>
                    <span>你的答案已保存</span>
                  </li>
                  <li>
                    <strong>02 由你分享</strong>
                    <span>请私发给原邀请人</span>
                  </li>
                  <li>
                    <strong>03 TA 提交猜测</strong>
                    <span>提交后才揭晓答案</span>
                  </li>
                </ol>
              </section>
            </div>
          </div>
          <section className="card reverse-share-ready">
            <h2>你的反向邀请准备好了</h2>
            <SocialShare
              value={`${window.location.origin}/guess/${encodeURIComponent(ready.token)}`}
              kind="reverse"
            />
          </section>
          <div className="guess-flow-exits">
            <Link to="/mirror">
              看看我的镜像 <ArrowRight size={16} />
            </Link>
            <Link to="/today">
              回到今天 <ArrowRight size={16} />
            </Link>
          </div>
        </>
      ) : context.is_owner ? (
        <div className="guess-flow-grid">
          <div className="guess-flow-content">
            <PageHeading
              eyebrow="这是你的猜测邀请"
              title="答案已保存，等待朋友猜测"
              description="把链接发给朋友吧。你不能猜自己的答案。"
            />
            <section className="card">
              <h2>{question.prompt}</h2>
              <ReadOnlyQuestion question={question} />
              <SocialShare
                value={`${window.location.origin}/guess/${encodeURIComponent(token)}`}
                kind={invitationShareKind("guess", context)}
              />
              <PrivacyNote>朋友提交猜测后才会看到你的答案。</PrivacyNote>
            </section>
          </div>
          <GuessArtwork scene="start" />
        </div>
      ) : result && reverseOpen ? (
        <>
          <div className="guess-flow-grid" data-design-page="11">
            <div className="guess-flow-content">
              <PageHeading
                eyebrow="刚才你猜了 TA · 现在换个方向"
                title="刚才你猜了 TA。现在，换 TA 猜你。"
                description="回答同一道生活题，再把邀请发送给 TA。TA 提交猜测后才会看到你的答案。"
              />
              <section className="question-card reverse-answer-card">
                <Badge>只需回答这一题</Badge>
                <h2>{question.prompt}</h2>
                <Options
                  question={question}
                  selected={ownChoice}
                  onSelect={(c) => {
                    setOwnChoice(c);
                    reverseKey.current = newKey();
                  }}
                  disabled={busy}
                />
                <PrivacyNote>
                  TA
                  提交猜测前看不到你的答案。这个选择不会改写自我镜像或每日记录。
                </PrivacyNote>
                <Button disabled={!ownChoice} busy={busy} onClick={reverse}>
                  保存我的答案，让 TA 猜 <ArrowRight size={18} />
                </Button>
                {error && <Notice>{error}</Notice>}
              </section>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setReverseOpen(false)}
              >
                暂不发送，返回上次结果
              </button>
            </div>
            <GuessArtwork scene="start" />
          </div>
          <GuessFlowSteps />
        </>
      ) : result ? (
        <>
          <div
            className={`guess-flow-grid guess-reveal-layout ${isReverse ? "is-reverse-reveal" : ""}`}
            data-design-page={isReverse ? "14" : "10"}
          >
            <div className="guess-flow-content">
              <PageHeading
                eyebrow={
                  isReverse
                    ? "反向竞猜 · 答案揭晓"
                    : "关于 TA 的选择 · 答案揭晓"
                }
                title={result.correct ? "这一次，你猜中了。" : "这次没有猜中"}
                description={
                  result.correct
                    ? "你的猜测与 TA 的答案一致。"
                    : "你的猜测与 TA 的答案不同，可在下方查看。"
                }
              />
              <section
                className={`card reveal-card guess-designed-reveal ${result.correct ? "is-match" : "is-different"}`}
              >
                <Badge pink>
                  {result.correct ? "猜测与答案一致" : "猜测与答案不同"}
                </Badge>
                <h2>{question.prompt}</h2>
                <div className="reveal-comparison">
                  <div>
                    <small>你的猜测</small>
                    <span>{result.guessed_choice}</span>
                    <strong>
                      {result.guessed_choice === "A"
                        ? question.choice_a
                        : question.choice_b}
                    </strong>
                  </div>
                  <span
                    className="guess-result-relation"
                    aria-label={result.correct ? "相同" : "不同"}
                  >
                    {result.correct ? "=" : "≠"}
                  </span>
                  <div className="actual-choice">
                    <small>{owner} 的真实选择</small>
                    <span>{result.actual_choice}</span>
                    <strong>
                      {result.actual_choice === "A"
                        ? question.choice_a
                        : question.choice_b}
                    </strong>
                  </div>
                </div>
                <div className="relationship-note">
                  {result.relationship.display_mode === "getting_started" ? (
                    <>
                      <Sparkles size={17} />
                      当前互动次数较少，不代表你们整体的了解程度。
                    </>
                  ) : (
                    <>
                      你已猜过 TA 的 {result.relationship.total_count}{" "}
                      个不同选择，其中 {result.relationship.correct_count}{" "}
                      次想到一起。
                    </>
                  )}
                </div>
              </section>
            </div>
            <GuessArtwork scene={isReverse ? "reverseReveal" : "reveal"} />
          </div>
          <section className="guess-next-panel">
            <div>
              <span className="eyebrow">让了解，继续发生</span>
              <h2>
                {isReverse
                  ? "再来一题，让来回更有意思。"
                  : "现在，换 TA 来猜你。"}
              </h2>
              <p>回答同一道题后，可以邀请 TA 猜测你的答案。</p>
            </div>
            <div>
              {result.can_reverse && (
                <Button onClick={() => setReverseOpen(true)}>
                  换 TA 来猜我 <ArrowRight size={18} />
                </Button>
              )}
              <Link className="text-link" to="/guess/new">
                选一道自己的生活题 <ArrowRight size={16} />
              </Link>
              <Link className="text-link" to="/today">
                回答今日问题 <ArrowRight size={16} />
              </Link>
            </div>
          </section>
          <GuessFlowSteps />
        </>
      ) : (
        <div
          className="guess-flow-grid guess-choice-layout"
          data-design-page={isReverse ? "13" : "09-choice"}
        >
          <div className="guess-flow-content">
            <PageHeading
              eyebrow={
                isReverse
                  ? "朋友发来一道反向竞猜"
                  : `来自 ${owner} 的一个小问题`
              }
              title={
                isReverse
                  ? "刚才 TA 猜了你。现在，轮到你猜 TA。"
                  : "这一次，你能猜中 TA 吗？"
              }
              description="TA 已选好真实答案，暂时不告诉你。凭你对 TA 的了解，猜猜会是哪边。"
            />
            <section className="question-card guess-question">
              <Badge pink>只需 1 题 · 猜猜 TA 的真实选择</Badge>
              <h2>{question.prompt}</h2>
              <Options
                question={question}
                selected={choice}
                onSelect={(c) => {
                  setChoice(c);
                  submitKey.current = newKey();
                }}
                disabled={busy}
              />
              <p className="small muted">
                你的猜测会记录到你们之间的互动中。提交后揭晓 TA 的答案。
              </p>
              <Button disabled={!choice} busy={busy} onClick={submit}>
                我猜好了，揭晓答案 <ArrowRight size={18} />
              </Button>
              {error && <Notice>{error}</Notice>}
              <PrivacyNote>别问答案，凭你对 TA 的了解就好。</PrivacyNote>
            </section>
            <Link className="text-link" to="/today">
              暂时不猜，回到今天
            </Link>
          </div>
          <GuessArtwork scene={isReverse ? "choice" : "start"} />
        </div>
      )}
    </div>
  );
}
function ReadOnlyQuestion({ question }: { question: Question }) {
  return (
    <div className="guess-readonly-options">
      <div>
        <b>A</b>
        <span>{question.choice_a}</span>
      </div>
      <div>
        <b>B</b>
        <span>{question.choice_b}</span>
      </div>
    </div>
  );
}
function GuessFlowSteps() {
  return (
    <section className="guess-flow-steps" aria-label="来回了解的三个步骤">
      <article>
        <span>01</span>
        <h3>查看答案对照</h3>
        <p>提交后查看是否猜中</p>
      </article>
      <article>
        <span>02</span>
        <h3>换个方向</h3>
        <p>回答同一道题，邀请 TA 猜测</p>
      </article>
      <article>
        <span>03</span>
        <h3>查看互动记录</h3>
        <p>在我的空间查看历史结果</p>
      </article>
    </section>
  );
}
function PhotoWindow({
  src,
  width,
  height,
  box,
  alt,
}: {
  src: string;
  width: number;
  height: number;
  box: [number, number, number, number];
  alt: string;
}) {
  const [x, y, right, bottom] = box;
  const w = right - x;
  const h = bottom - y;
  return (
    <div className="guess-photo-window" style={{ aspectRatio: `${w} / ${h}` }}>
      <img
        src={src}
        width={width}
        height={height}
        alt={alt}
        style={{
          width: `${(width / w) * 100}%`,
          left: `${(-x / w) * 100}%`,
          top: `${(-y / h) * 100}%`,
        }}
      />
    </div>
  );
}
function GuessArtwork({
  scene,
}: {
  scene: "start" | "reveal" | "ready" | "choice" | "reverseReveal";
}) {
  const description = "原设计中的虚拟品牌示意人物，非参与者头像";
  return (
    <figure className={`guess-artwork guess-artwork-${scene}`}>
      {scene === "ready" ? (
        <div className="guess-ready-collage">
          <PhotoWindow
            src="/design/reverse-ready-reference.png"
            width={1586}
            height={992}
            box={[125, 245, 690, 610]}
            alt={`春日咖啡馆场景，${description}`}
          />
          <div>
            <PhotoWindow
              src="/design/reverse-ready-reference.png"
              width={1586}
              height={992}
              box={[740, 190, 905, 408]}
              alt=""
            />
            <PhotoWindow
              src="/design/reverse-ready-reference.png"
              width={1586}
              height={992}
              box={[778, 480, 900, 670]}
              alt=""
            />
          </div>
        </div>
      ) : scene === "choice" ? (
        <PhotoWindow
          src="/design/reverse-choice-reference.png"
          width={1586}
          height={992}
          box={[963, 230, 1490, 748]}
          alt={`春日河畔，${description}`}
        />
      ) : scene === "reverseReveal" ? (
        <PhotoWindow
          src="/design/reverse-reveal-reference.png"
          width={1536}
          height={1024}
          box={[947, 205, 1370, 700]}
          alt={`春日户外咖啡馆，${description}`}
        />
      ) : (
        <img
          src={
            scene === "reveal"
              ? "/design/reveal-outdoor.png"
              : "/design/reverse-start-outdoor.png"
          }
          alt={`春日户外，${description}`}
        />
      )}
      <figcaption>
        {scene === "ready"
          ? "朋友提交猜测后才能查看答案。"
          : scene === "choice"
            ? "TA 这次会怎么选？"
            : scene === "reverseReveal"
              ? "查看本次猜测与答案的对照。"
              : scene === "reveal"
                ? "结果仅对应本次题目。"
                : "你也可以回答同一道题。"}
      </figcaption>
    </figure>
  );
}
