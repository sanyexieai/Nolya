import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Check, Sparkles, Sun } from "lucide-react";
import { api, errorMessage, formatDate, mutate, newKey } from "./api";
import type { Choice, JournalEntry, PulseResult, SoloResult } from "./api";
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
export function TodayPage() {
  const { user, loading: sessionLoading, ensureGuest } = useSession();
  const resource = useResource(async () => {
    if (sessionLoading) return null;
    await ensureGuest();
    return api<PulseResult>("/pulse/today");
  }, [sessionLoading, user?.id]);
  const [choice, setChoice] = useState<Choice>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newKey());
  const pulse = resource.data;
  async function submit() {
    if (!pulse || !choice) return;
    setBusy(true);
    setError("");
    try {
      resource.setData(
        await mutate<PulseResult>(
          `/pulse/${pulse.id}/answers`,
          { choice },
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
    <div className="container daily-page">
      <PageHeading
        eyebrow="DAILY PULSE · 每天一个小选择"
        title={
          pulse?.answer ? "今天的选择，已经留下。" : "今天的你，会怎么选？"
        }
        description="这一刻的想法，也值得被好好记住。"
      />
      {resource.loading || sessionLoading ? (
        <Loading text="正在准备今天的小问题…" />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : pulse ? (
        <div className="daily-grid">
          <section className="card daily-question">
            <div className="daily-meta">
              <span className="daily-date">
                <Sun size={17} />
                {formatDate(pulse.date)}
              </span>
              <span className="topic-tag">{pulse.topic}</span>
            </div>
            <div className="daily-decoration">
              <div />
              <Sparkles size={26} />
            </div>
            <h2>{pulse.question.prompt}</h2>
            {pulse.answer ? (
              <>
                <div className="saved-choice">
                  <span className="option-letter">{pulse.answer.choice}</span>
                  <div>
                    <small>你今天选了</small>
                    <strong>
                      {pulse.answer.choice === "A"
                        ? pulse.question.choice_a
                        : pulse.question.choice_b}
                    </strong>
                  </div>
                  <Check size={22} />
                </div>
                <PrivacyNote>
                  已保存。这一天的选择不会被之后的心情改写。
                </PrivacyNote>
                <Link
                  className="text-link"
                  to={`/guess/new?answer=${encodeURIComponent(pulse.answer.id)}`}
                >
                  好奇朋友能不能猜中？ <ArrowRight size={16} />
                </Link>
              </>
            ) : (
              <>
                <p className="question-hint">
                  凭第一感觉就好，明天又会是新的问题。
                </p>
                <Options
                  question={pulse.question}
                  selected={choice}
                  onSelect={(c) => {
                    setChoice(c);
                    key.current = newKey();
                  }}
                  disabled={busy}
                />
                <Button disabled={!choice} busy={busy} onClick={submit}>
                  留下今天的选择 <ArrowRight size={18} />
                </Button>
                {error && <Notice onRetry={resource.reload}>{error}</Notice>}
                <PrivacyNote>
                  提交后再看本次参与者的选择，不影响你的自我镜像。
                </PrivacyNote>
              </>
            )}
          </section>
          <aside className="daily-aside">
            {pulse.answer && pulse.crowd ? (
              <section className="card crowd-card">
                <Badge>在今天的参与者中</Badge>
                <h3>
                  {pulse.crowd.mode === "percentage"
                    ? "你和多少人想在一起？"
                    : "不同选择，正在汇聚"}
                </h3>
                {pulse.crowd.mode === "percentage" &&
                pulse.crowd.a_percent !== null ? (
                  <div className="crowd-bars">
                    {(["A", "B"] as const).map((c) => (
                      <div
                        className={`crowd-row ${pulse.answer?.choice === c ? "mine" : ""}`}
                        key={c}
                      >
                        <div>
                          <span>
                            {c === "A"
                              ? pulse.question.choice_a
                              : pulse.question.choice_b}
                          </span>
                          <strong>
                            {c === "A"
                              ? pulse.crowd!.a_percent
                              : pulse.crowd!.b_percent}
                            %
                          </strong>
                        </div>
                        <div className="bar-track">
                          <span
                            style={{
                              width: `${c === "A" ? pulse.crowd!.a_percent : pulse.crowd!.b_percent}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="crowd-waiting">
                    <span>
                      <UsersGlyph />
                    </span>
                    <p>
                      {pulse.crowd.sample_size < 2
                        ? "你留下了今天的第一个视角。"
                        : "已经有一些人留下了今天的选择。"}
                      <br />
                      样本还少，先不展示百分比。
                    </p>
                  </div>
                )}
                <small className="muted">
                  本期真实参与样本：{pulse.crowd.sample_size} · 中国区
                  <br />
                  仅代表本次参与者，不代表所有人。
                </small>
              </section>
            ) : (
              <section className="card gentle-card">
                <span className="large-spark">✧</span>
                <h3>先听听自己的想法</h3>
                <p>选好之后，再看看大家这一次怎么选。</p>
              </section>
            )}
            <section className="card accumulation-card">
              <BookOpen size={22} />
              <span className="eyebrow">留给以后的自己</span>
              <h3>
                <strong>{pulse.saved_count}</strong> 个选择已留下
              </h3>
              <p>
                不必连续打卡。慢慢积累 7
                个不同日期的选择，再看看有没有新的发现。
              </p>
              <div className="day-dots">
                {Array.from({ length: 7 }, (_, i) => (
                  <span className={i < pulse.saved_count ? "done" : ""} key={i}>
                    {i < pulse.saved_count ? <Check size={12} /> : i + 1}
                  </span>
                ))}
              </div>
              <Link className="text-link" to="/journal">
                翻翻我的选择日记
                <ArrowRight size={16} />
              </Link>
            </section>
          </aside>
        </div>
      ) : (
        <Empty title="今天的问题还没准备好">请稍后重试。</Empty>
      )}
    </div>
  );
}
function UsersGlyph() {
  return <span className="people-glyph">◡ ◡ ◡</span>;
}
export function JournalPage() {
  const { user, loading } = useSession();
  const [filters, setFilters] = useState({ from: "", to: "", choice: "" });
  const [draft, setDraft] = useState(filters);
  const filterKey = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
  const pageVersion = useRef(0);
  useEffect(() => {
    pageVersion.current += 1;
    setBusy(false);
    setMoreError("");
  }, [filterKey, user?.id]);
  const journal = useResource(
    () =>
      user
        ? api<{
            entries: JournalEntry[];
            next_cursor: string | null;
            total: number;
          }>(`/journal?${filterKey}`)
        : Promise.resolve({ entries: [], next_cursor: null, total: 0 }),
    [user?.id, filterKey],
  );
  const solo = useResource(
    () => (user ? api<SoloResult>("/solo") : Promise.resolve(null)),
    [user?.id],
  );
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  async function more() {
    if (!journal.data?.next_cursor || busy) return;
    const version = pageVersion.current;
    setBusy(true);
    setMoreError("");
    try {
      const next = await api<{
        entries: JournalEntry[];
        next_cursor: string | null;
        total: number;
      }>(
        `/journal?${filterKey}&cursor=${encodeURIComponent(journal.data.next_cursor)}`,
      );
      if (version !== pageVersion.current) return;
      journal.setData({
        ...next,
        entries: [...journal.data.entries, ...next.entries],
      });
    } catch (e) {
      if (version === pageVersion.current) setMoreError(errorMessage(e));
    } finally {
      if (version === pageVersion.current) setBusy(false);
    }
  }
  return (
    <div className="container journal-page">
      <PageHeading
        eyebrow="CHOICE JOURNAL · 我的选择日记"
        title="把每一个当下，留给自己。"
        description="没有标准轨迹。这里存着你在不同日子里，真实做过的选择。"
      >
        <ActionLink to="/today" secondary>
          今天的小选择 <ArrowRight size={17} />
        </ActionLink>
      </PageHeading>
      <form
        className="card journal-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <label>
          开始日期
          <input
            aria-label="开始日期"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          结束日期
          <input
            aria-label="结束日期"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label>
          选择
          <select
            aria-label="筛选选择"
            value={draft.choice}
            onChange={(e) => setDraft({ ...draft, choice: e.target.value })}
          >
            <option value="">全部</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <Button
          type="submit"
          disabled={!!(draft.from && draft.to && draft.from > draft.to)}
        >
          筛选记录
        </Button>
        <Button
          secondary
          onClick={() => {
            const empty = { from: "", to: "", choice: "" };
            setDraft(empty);
            setFilters(empty);
          }}
        >
          重置
        </Button>
      </form>
      {loading || journal.loading ? (
        <Loading />
      ) : journal.error ? (
        <Notice onRetry={journal.reload}>{journal.error}</Notice>
      ) : !journal.data?.entries.length ? (
        <Empty
          icon="☼"
          title={filterKey ? "没有符合筛选条件的选择" : "第一笔，留给今天吧"}
          action={
            <ActionLink to="/today">
              留下今天的选择 <ArrowRight size={17} />
            </ActionLink>
          }
        >
          {filterKey
            ? "试试其他日期或清除筛选，原有记录不会改变。"
            : "当你答完一个每日问题，它就会出现在这里。"}
        </Empty>
      ) : (
        <div className="journal-grid">
          <section className="journal-list">
            <div className="section-label">
              <h2>所有选择</h2>
              <span>{journal.data.total} 条真实记录</span>
            </div>
            {journal.data.entries.map((entry) => (
              <article className="journal-entry" key={entry.answer_id}>
                <div className="journal-date">
                  <span>{formatDate(entry.date)}</span>
                  <span>{entry.date.slice(0, 4)}</span>
                </div>
                <div className="journal-entry-body">
                  <h3>{entry.question.prompt}</h3>
                  <p>
                    <span>{entry.choice}</span>
                    {entry.choice === "A"
                      ? entry.question.choice_a
                      : entry.question.choice_b}
                  </p>
                  {entry.share_eligible && (
                    <Link
                      className="text-link"
                      to={`/guess/new?answer=${encodeURIComponent(entry.answer_id)}`}
                    >
                      让朋友猜猜这个选择 <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </article>
            ))}
            {journal.data.next_cursor && (
              <Button secondary busy={busy} onClick={more}>
                再往前翻翻
              </Button>
            )}
            {moreError && <Notice>{moreError}</Notice>}
          </section>
          <aside className="card solo-card">
            <Badge>慢慢拼出更多的你</Badge>
            <div className="solo-flower">✳</div>
            <h2>
              {solo.data?.eligible
                ? "这些天的你，有什么不同？"
                : "一天看见选择，几天看见线索。"}
            </h2>
            {solo.loading ? (
              <Loading />
            ) : solo.error ? (
              <Notice onRetry={solo.reload}>{solo.error}</Notice>
            ) : solo.data ? (
              <>
                <p>{solo.data.notice}</p>
                <div className="solo-count">
                  <strong>{solo.data.answered_days}</strong>
                  <span>/ {solo.data.required_days} 个不同日期</span>
                </div>
                {solo.data.eligible && (
                  <small>
                    {solo.data.window_start &&
                      formatDate(solo.data.window_start)}{" "}
                    — {solo.data.window_end && formatDate(solo.data.window_end)}
                  </small>
                )}
                {solo.data.self_comparison && (
                  <div className="solo-insight">
                    <Sparkles size={19} />
                    <p>{solo.data.self_comparison.text}</p>
                  </div>
                )}
                {solo.data.most_aligned && (
                  <div className="solo-insight">
                    <p>
                      最想到一起的一次：
                      {solo.data.most_aligned.entry.question.prompt}
                    </p>
                    <small>
                      {solo.data.most_aligned.same_choice_percent}%
                      的本次参与者与你选了同一边
                    </small>
                  </div>
                )}
                {solo.data.most_different && (
                  <div className="solo-insight">
                    <p>
                      最有自己想法的一次：
                      {solo.data.most_different.entry.question.prompt}
                    </p>
                    <small>
                      {solo.data.most_different.same_choice_percent}%
                      的本次参与者与你选了同一边
                    </small>
                  </div>
                )}
              </>
            ) : null}
            <PrivacyNote>每日选择不会直接改写你的自我镜像。</PrivacyNote>
          </aside>
        </div>
      )}
    </div>
  );
}
