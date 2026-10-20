import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Heart,
  Lightbulb,
  Shuffle,
  Sparkles,
} from "lucide-react";
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
  CopyLink,
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
  choice: Choice;
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
          choice: e.choice,
        })),
        ...(self?.answers.flatMap((a) => {
          const q = questions.questions.find((q) => q.id === a.question_id);
          return q
            ? [
                {
                  id: a.id,
                  type: "self" as const,
                  question: q,
                  choice: a.choice,
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
          choice: e.choice,
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
  const selected = resource.data?.answers.find((a) => a.id === selectedId);
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
    <div className="container narrow-page">
      <PageHeading
        eyebrow="GUESS ME · 猜猜我的选择"
        title="你觉得，TA 猜得中吗？"
        description="挑一个你已经做过的真实选择，让朋友试着猜猜。"
      />
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !resource.data?.answers.length ? (
        <Empty
          title="先留下一个真实答案"
          action={
            <ActionLink to="/today">
              去做今天的小选择
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
          <Badge>谜底已经收好</Badge>
          <h2>让朋友凭直觉猜一猜</h2>
          <p>{selected?.question.prompt}</p>
          <CopyLink value={shareUrl(link, "guess")} label="复制猜测邀请链接" />
          <PrivacyNote>朋友提交猜测后，才会看到你选的答案。</PrivacyNote>
          <Link className="text-link" to="/space">
            回到我的空间 <ArrowRight size={16} />
          </Link>
        </section>
      ) : (
        <section className="card guess-picker">
          <h2>选一个想分享的问题</h2>
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
                selected={selectedId === answer.id}
                onSelect={() => {
                  setSelectedId(answer.id);
                  key.current = newKey();
                }}
              />
            ))}
          </div>
          {resource.data.next_cursor && (
            <Button secondary busy={loadingMore} disabled={busy} onClick={more}>
              加载更早的每日选择
            </Button>
          )}
          {moreError && <Notice>{moreError}</Notice>}
          <div className="privacy-box">
            <Lightbulb size={22} />
            <p>
              创建邀请表示你愿意向参与猜测的人揭晓这个答案。分享前，再确认它是你愿意让朋友知道的选择。
            </p>
          </div>
          <Button disabled={!selected} busy={busy} onClick={create}>
            收好谜底，生成邀请 <ArrowRight size={18} />
          </Button>
          {error && <Notice>{error}</Notice>}
        </section>
      )}
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
        <p>
          我的选择：
          {answer.choice === "A"
            ? answer.question.choice_a
            : answer.question.choice_b}
        </p>
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
  return (
    <div className="container narrow-page">
      {sessionLoading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <>
          <PageHeading eyebrow="猜测邀请" title="暂时打不开这个问题" />
          <Notice onRetry={resource.reload}>{resource.error}</Notice>
        </>
      ) : !context || context.status !== "active" ? (
        <Empty
          title="这次猜测已经结束"
          action={
            <ActionLink to="/today">
              留一个自己的选择 <ArrowRight size={17} />
            </ActionLink>
          }
        >
          链接可能已过期或被撤回，可以向朋友要一个新的邀请。
        </Empty>
      ) : context.is_owner ? (
        <>
          <PageHeading
            eyebrow="这是你的猜测邀请"
            title="你的答案，已经好好收起来了。"
            description="把链接发给朋友吧。你不能猜自己的答案。"
          />
          <section className="card">
            <h2>{context.question.prompt}</h2>
            <CopyLink
              value={`${window.location.origin}/guess/${token}`}
              label="复制猜测邀请链接"
            />
            <PrivacyNote>朋友提交猜测后才会看到你的答案。</PrivacyNote>
          </section>
        </>
      ) : result ? (
        <>
          <PageHeading
            eyebrow={result.correct ? "想到一起了" : "原来，你看见的是另一面"}
            title={
              result.correct ? "这一次，你猜中了。" : "这一次，答案有一点意外。"
            }
            description={
              result.correct
                ? "一个小选择里，藏着一点熟悉。"
                : "没有猜中也没关系，这就是多了解一点的开始。"
            }
          />
          <section className="card reveal-card">
            <span
              className={`reveal-symbol ${result.correct ? "correct" : ""}`}
            >
              {result.correct ? <Heart size={36} /> : <Sparkles size={36} />}
            </span>
            <h2>{context.question.prompt}</h2>
            <div className="reveal-comparison">
              <div>
                <small>你的猜测</small>
                <span>{result.guessed_choice}</span>
                <strong>
                  {result.guessed_choice === "A"
                    ? context.question.choice_a
                    : context.question.choice_b}
                </strong>
              </div>
              <div className="actual-choice">
                <small>{owner} 的真实选择</small>
                <span>{result.actual_choice}</span>
                <strong>
                  {result.actual_choice === "A"
                    ? context.question.choice_a
                    : context.question.choice_b}
                </strong>
              </div>
            </div>
            <div className="relationship-note">
              {result.relationship.display_mode === "getting_started" ? (
                <>
                  <Sparkles size={17} />
                  你们还在慢慢摸清彼此。一个选择，不代表全部。
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
          {result.can_reverse && (
            <section className="card reverse-card">
              {reverseLink ? (
                <>
                  <Badge>现在，换 TA 来猜</Badge>
                  <h2>你的反向邀请准备好了</h2>
                  <CopyLink
                    value={shareUrl(reverseLink, "guess")}
                    label="复制反向猜测链接"
                  />
                  <p className="small muted">
                    发给刚才邀请你的那位朋友。只面向原邀请人。
                  </p>
                </>
              ) : reverseOpen ? (
                <>
                  <Badge>这一回，选你自己的答案</Badge>
                  <h2>同一个问题，你会怎么选？</h2>
                  <Options
                    question={context.question}
                    selected={ownChoice}
                    onSelect={(c) => {
                      setOwnChoice(c);
                      reverseKey.current = newKey();
                    }}
                    disabled={busy}
                  />
                  <p className="small muted">
                    选好并创建后，TA
                    提交猜测就能看到你的答案。这个选择不会改写自我镜像或每日记录。
                  </p>
                  <Button disabled={!ownChoice} busy={busy} onClick={reverse}>
                    保存我的答案，让 TA 猜 <ArrowRight size={18} />
                  </Button>
                </>
              ) : (
                <>
                  <div>
                    <Shuffle size={24} />
                    <h2>要不要，也让 TA 猜猜你？</h2>
                    <p>同一个小问题，换个方向，再发现一点。</p>
                  </div>
                  <Button onClick={() => setReverseOpen(true)}>
                    换 TA 来猜我 <ArrowRight size={18} />
                  </Button>
                </>
              )}
              {error && <Notice>{error}</Notice>}
            </section>
          )}
          <div className="subtle-link-row">
            <Link to="/today">
              继续今天的小选择 <ArrowRight size={16} />
            </Link>
          </div>
        </>
      ) : (
        <>
          <PageHeading
            eyebrow={`来自 ${owner} 的一个小问题`}
            title="这一次，你能猜中 TA 吗？"
            description="答案已经提前选好。选完以后，一起揭晓。"
          />
          <section className="question-card guess-question">
            <Badge pink>猜猜 TA 的真实选择</Badge>
            <h2>{context.question.prompt}</h2>
            <Options
              question={context.question}
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
        </>
      )}
    </div>
  );
}
