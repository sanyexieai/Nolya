import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesColumnIncreasing,
  Check,
  Heart,
  Sparkles,
  Star,
  Sun,
  Users,
} from "lucide-react";
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
  PrivacyNote,
  useResource,
} from "./ui";
import "./design-daily-space.css";

function DailyArtwork() {
  return (
    <div
      className="pulse-question-art"
      role="img"
      aria-label="Nolya 品牌情境插图：在阳光下的咖啡馆，留一点时间给自己；不是用户照片或评价。"
    >
      {/* Page15 supplies only composite references. Clip just the artwork, never its UI. */}
      <picture>
        <source
          media="(max-width: 760px)"
          srcSet="/design/daily-question-mobile-reference.png"
        />
        <img src="/design/daily-question-desktop-reference.png" alt="" />
      </picture>
    </div>
  );
}

function ResultArtwork({ choice }: { choice: Choice }) {
  return (
    <figure className="pulse-result-art">
      <div className="pulse-portrait-frame">
        <img
          src="/design/daily-result-riverside.png"
          alt="Nolya 品牌情境插图：阳光下的河畔，不是用户照片。"
        />
        <figcaption>一张生活切片</figcaption>
      </div>
      <span className="pulse-portrait-tag">
        <Sparkles size={16} /> 你选的是 {choice}
      </span>
      <Heart className="pulse-portrait-heart" size={42} aria-hidden="true" />
      <span className="pulse-portrait-note">把这一刻，留给以后的自己。</span>
    </figure>
  );
}

function CrowdStats({ pulse }: { pulse: PulseResult }) {
  if (!pulse.answer || !pulse.crowd) return null;
  const crowd = pulse.crowd;
  const hasPercentages =
    crowd.mode === "percentage" &&
    crowd.a_percent !== null &&
    crowd.b_percent !== null;
  return (
    <section
      className="card crowd-card pulse-crowd"
      aria-label="今天的真实参与统计"
    >
      <Badge>在今天的参与者中</Badge>
      <h2>{hasPercentages ? "你和多少人想在一起？" : "不同选择，正在汇聚"}</h2>
      {hasPercentages ? (
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
                  {c === "A" ? crowd.a_percent : crowd.b_percent}%
                </strong>
              </div>
              <div className="bar-track">
                <span
                  style={{
                    width: `${c === "A" ? crowd.a_percent : crowd.b_percent}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="crowd-waiting">
          <Users size={28} aria-hidden="true" />
          <p>
            {crowd.sample_size < 2
              ? "你留下了今天的第一个视角。"
              : "已经有一些人留下了今天的选择。"}
            <br />
            样本还少，先不展示百分比。
          </p>
        </div>
      )}
      <small className="muted">
        本期真实参与样本：{crowd.sample_size} ·{" "}
        {pulse.region === "CN" ? "中国区" : pulse.region}
        <br />
        仅代表本次参与者，不代表所有人。
      </small>
    </section>
  );
}

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
  const submitting = useRef(false);
  const pulse = resource.data;
  async function submit() {
    if (!pulse || !choice || submitting.current) return;
    submitting.current = true;
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
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className={`container daily-page nolya-daily-design ${pulse?.answer ? "pulse-saved-page" : "pulse-input-page"}`}
    >
      {resource.loading || sessionLoading ? (
        <Loading text="正在准备今天的小问题…" />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !pulse ? (
        <Empty title="今天的问题还没准备好">请稍后重试。</Empty>
      ) : pulse.answer ? (
        <>
          <div className="pulse-saved-layout">
            <div className="pulse-saved-main">
              <header className="daily-editorial-heading">
                <Badge>今天的一面 · 已记录</Badge>
                <h1>
                  今天，你留下了
                  <br />
                  <em>一个真实的选择。</em>
                </h1>
                <p>
                  你选了「
                  {pulse.answer.choice === "A"
                    ? pulse.question.choice_a
                    : pulse.question.choice_b}
                  」。这是今天的你，不用急着给自己下定义。
                </p>
              </header>
              <section className="card daily-question pulse-saved-card">
                <div className="daily-meta">
                  <span className="daily-date">
                    <Sun size={17} />
                    今天的这一题
                  </span>
                  <span className="pulse-saved-pill">
                    <Check size={16} />
                    你的选择已收好
                  </span>
                </div>
                <h2>{pulse.question.prompt}</h2>
                <div className="pulse-saved-options">
                  {(["A", "B"] as const).map((c) => (
                    <div
                      className={`pulse-saved-option ${pulse.answer?.choice === c ? "selected saved-choice" : ""}`}
                      key={c}
                    >
                      {pulse.answer?.choice === c ? (
                        <span className="pulse-choice-label">
                          <Check size={14} />
                          今天的选择
                        </span>
                      ) : (
                        <span className="pulse-choice-spacer" />
                      )}
                      <strong className="pulse-choice-letter">{c}</strong>
                      <span>
                        {c === "A"
                          ? pulse.question.choice_a
                          : pulse.question.choice_b}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pulse-reflection">
                  <Sparkles size={19} />
                  这一刻的想法，也值得被好好记住。
                </div>
                <p className="pulse-evidence-note">
                  这一题记录的是此刻的你，并不代表你永远会这样选。
                </p>
                <span className="pulse-timestamp">
                  {formatDate(pulse.date)} · 已保存
                </span>
              </section>
            </div>
            <aside className="pulse-saved-aside">
              <ResultArtwork choice={pulse.answer.choice} />
              <CrowdStats pulse={pulse} />
            </aside>
          </div>
          <div className="pulse-after-grid">
            <section className="card pulse-history-card">
              <span className="eyebrow">不必一次看懂自己</span>
              <h2>今天这一笔，留下了。</h2>
              <p>
                你已留下 {pulse.saved_count}{" "}
                个真实选择。不必连续打卡，以后想起时，再回来看看。
              </p>
              <PrivacyNote>
                你的选择，只属于你。除非你主动分享或发起竞猜，否则不会自动把答案公开给朋友。
              </PrivacyNote>
              <ActionLink to="/journal">
                看看我的选择记录 <ArrowRight size={17} />
              </ActionLink>
            </section>
            <section className="card pulse-social-card">
              <span className="eyebrow">如果想拉个人一起玩</span>
              <h2>熟悉你的人，会猜中这一题吗？</h2>
              <p>把刚才这道题发给 TA。先让 TA 猜，提交后才揭晓你的选择。</p>
              <ActionLink
                secondary
                to={`/guess/new?answer=${encodeURIComponent(pulse.answer.id)}`}
              >
                让朋友猜这道题 <ArrowRight size={17} />
              </ActionLink>
              <p className="pulse-evidence-note">
                一个人也能继续玩，明天再来选一题也很好。
              </p>
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="pulse-input-layout">
            <DailyArtwork />
            <div className="pulse-input-main">
              <header className="daily-editorial-heading">
                <Badge>每天一题</Badge>
                <h1>
                  今天这道
                  <em>
                    小选择，
                    <br />
                    你会怎么选？
                  </em>
                </h1>
                <p>
                  不用等朋友。先留下你此刻的真实选择，慢慢看见自己的模式。答完以后，也可以再让熟悉你的人来猜。
                </p>
              </header>
              <section className="card daily-question pulse-input-card">
                <div className="daily-meta">
                  <span className="daily-date">
                    <Sun size={19} />
                    今日题目
                  </span>
                  <span className="topic-tag">
                    {pulse.topic} · {formatDate(pulse.date)}
                  </span>
                </div>
                <h2>{pulse.question.prompt}</h2>
                <Options
                  question={pulse.question}
                  selected={choice}
                  onSelect={(c) => {
                    setChoice(c);
                    key.current = newKey();
                  }}
                  disabled={busy}
                />
                <PrivacyNote>
                  你的答案会先保留，提交后才进入下一步。不影响你的自我镜像。
                </PrivacyNote>
                <Button disabled={!choice} busy={busy} onClick={submit}>
                  留下今天的选择 <ArrowRight size={18} />
                </Button>
                {error && <Notice>{error}</Notice>}
                <div className="pulse-question-footer">
                  <span>每天一题，不必想太久。</span>
                  <Link className="text-link" to="/mirror">
                    回到镜像 <ArrowRight size={16} />
                  </Link>
                </div>
              </section>
              <div className="pulse-benefits">
                <div>
                  <Star size={22} />
                  <span>
                    <strong>一个人也能玩</strong>
                    <small>随时打开，轻松参与</small>
                  </span>
                </div>
                <div>
                  <ChartNoAxesColumnIncreasing size={22} />
                  <span>
                    <strong>选择会慢慢累积</strong>
                    <small>看见真实的自己</small>
                  </span>
                </div>
                <div>
                  <Heart size={22} />
                  <span>
                    <strong>今天的你也值得被看见</strong>
                    <small>每一种选择都很珍贵</small>
                  </span>
                </div>
              </div>
              <Link className="text-link pulse-existing-count" to="/journal">
                <BookOpen size={16} />
                {pulse.saved_count} 个选择已留下，翻翻我的选择日记{" "}
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
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
    <div className="container journal-page nolya-daily-design">
      <header className="daily-editorial-heading journal-editorial-heading">
        <div>
          <Badge>属于你的时间切片</Badge>
          <h1>
            <em>
              有些小选择，
              <br />
              值得留给以后的自己。
            </em>
          </h1>
          <p>
            不急着知道答案意味着什么。先把真实的选择留下来，隔一段时间，再回来看看。
          </p>
        </div>
        <span className="journal-thought">一个人，也能慢慢认识自己。</span>
      </header>
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
        <>
          <div className="journal-grid">
            <section className="card journal-list">
              <div className="journal-record-heading">
                <div>
                  <h2>我的选择记录</h2>
                  <p>只记录你真正选过的。</p>
                </div>
                <span className="pulse-saved-pill">
                  <Check size={15} />
                  {journal.data.total} 条真实记录
                </span>
              </div>
              {journal.data.entries.map((entry) => (
                <article className="journal-entry" key={entry.answer_id}>
                  <div className="journal-date">
                    <span>
                      <Sparkles size={15} />
                      {formatDate(entry.date)}
                    </span>
                    <span>已保存</span>
                  </div>
                  <div className="journal-entry-body">
                    <span className="eyebrow">
                      <Sun size={17} /> 这一天的小选择
                    </span>
                    <h3>{entry.question.prompt}</h3>
                    <div className="journal-choice-pill">
                      <span className="journal-choice-letter">
                        {entry.choice}
                      </span>
                      <div>
                        <small>你当时选了</small>
                        <p>
                          {entry.choice === "A"
                            ? entry.question.choice_a
                            : entry.question.choice_b}
                        </p>
                      </div>
                    </div>
                    <p className="journal-record-note">
                      这只是当时的一个选择，不代表你总会这样。
                    </p>
                  </div>
                  <details className="journal-record-details">
                    <summary>
                      看看这次选择 <ArrowRight size={15} />
                    </summary>
                    <div>
                      <strong>这一次，是真实的你。</strong>
                      <p>
                        保存在 {formatDate(entry.answered_at)}
                        。本页只回看你已经提交的答案，不会因为一次选择就替你定义性格。
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
                  </details>
                </article>
              ))}
              {journal.data.next_cursor && (
                <Button secondary busy={busy} onClick={more}>
                  再往前翻翻
                </Button>
              )}
              {moreError && <Notice>{moreError}</Notice>}
            </section>
            <aside className="journal-editorial-aside">
              <section
                className="journal-scrapbook"
                aria-label="留给未来的自己"
              >
                <Heart
                  className="journal-scrap-heart"
                  size={35}
                  aria-hidden="true"
                />
                <div className="journal-paper">
                  <span className="eyebrow">给未来的自己</span>
                  <h2>今天这一笔，先收好。</h2>
                  <p>让时间替你慢慢补完后面的故事。</p>
                  <img
                    src="/design/journal-small-reference.png"
                    alt="Nolya 品牌插图，不是用户照片。"
                  />
                  <div className="journal-paper-line" />
                  <p>你的记录，不是给别人看的成绩单。</p>
                  <span className="journal-handwriting">慢一点，也挺好。</span>
                </div>
                <p className="journal-scrap-caption">
                  不是谁更了解你，而是你愿意继续看看自己。
                </p>
                <Sparkles
                  className="journal-scrap-star"
                  size={25}
                  aria-hidden="true"
                />
              </section>
              <section className="card solo-card">
                <Badge>慢慢拼出更多的你</Badge>
                <h2>
                  {solo.data?.eligible
                    ? "这些天的你，有什么不同？"
                    : "不必连续打卡，慢慢积累就好。"}
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
                        —{" "}
                        {solo.data.window_end &&
                          formatDate(solo.data.window_end)}
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
              </section>
            </aside>
          </div>
          <section className="journal-return-panel">
            <div>
              <span className="eyebrow">下次想起来，就回来</span>
              <h2>明天的你，也许会选另一边。</h2>
              <p>不必等朋友，也不用跟谁比较。想玩的时候，再做一次选择。</p>
            </div>
            <div className="journal-return-actions">
              <ActionLink to="/today">
                回到今天 <ArrowRight size={17} />
              </ActionLink>
              {journal.data.entries[0]?.share_eligible && (
                <ActionLink
                  secondary
                  to={`/guess/new?answer=${encodeURIComponent(journal.data.entries[0].answer_id)}`}
                >
                  让朋友猜这一题
                </ActionLink>
              )}
            </div>
          </section>
          <div className="journal-privacy">
            <PrivacyNote>
              除非你主动发起竞猜，否则不会自动公开你的答案。
            </PrivacyNote>
            {user?.kind === "guest" && (
              <p>
                访客记录的保存与找回，以当前会话与实际身份规则为准。
                <Link className="text-link" to="/account">
                  保存我的空间 <ArrowRight size={14} />
                </Link>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
