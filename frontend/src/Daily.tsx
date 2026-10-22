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
      aria-label="Nolya 咖啡馆品牌插图，非用户照片或评价。"
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
        <figcaption>今日答题</figcaption>
      </div>
      <span className="pulse-portrait-tag">
        <Sparkles size={16} /> 你的答案： {choice}
      </span>
      <Heart className="pulse-portrait-heart" size={42} aria-hidden="true" />
      <span className="pulse-portrait-note">可在答题记录中查看。</span>
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
    <section className="card crowd-card pulse-crowd" aria-label="今日答题统计">
      <Badge>本期答题统计</Badge>
      <h2>{hasPercentages ? "参与者答案分布" : "参与人数不足"}</h2>
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
              ? "你是本期第一位答题者。"
              : "已有参与者完成本期答题。"}
            <br />
            样本量不足，暂不展示百分比。
          </p>
        </div>
      )}
      <small className="muted">
        本期参与人数：{crowd.sample_size} ·{" "}
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
        <Loading text="正在加载今日题目…" />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !pulse ? (
        <Empty title="今日题目暂不可用">请稍后重试。</Empty>
      ) : pulse.answer ? (
        <>
          <div className="pulse-saved-layout">
            <div className="pulse-saved-main">
              <header className="daily-editorial-heading">
                <Badge>今日答题结果</Badge>
                <h1>
                  今日答案
                  <br />
                  <em>已保存</em>
                </h1>
                <p>
                  你选了「
                  {pulse.answer.choice === "A"
                    ? pulse.question.choice_a
                    : pulse.question.choice_b}
                  」。你可以查看本期统计，或在答题记录中回顾答案。
                </p>
              </header>
              <section className="card daily-question pulse-saved-card">
                <div className="daily-meta">
                  <span className="daily-date">
                    <Sun size={17} />
                    今日题目
                  </span>
                  <span className="pulse-saved-pill">
                    <Check size={16} />
                    答案已保存
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
                          你的答案
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
                  本次答案已加入答题记录。
                </div>
                <p className="pulse-evidence-note">
                  单次答案只记录本次选择，不能用于判断固定性格。
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
              <span className="eyebrow">我的答题记录</span>
              <h2>查看已保存的答案</h2>
              <p>
                已保存 {pulse.saved_count}{" "}
                次每日答题。你可以按日期或选项查找历史记录。
              </p>
              <PrivacyNote>
                答案默认不公开。只有你主动分享或发起竞猜，朋友才会看到相应内容。
              </PrivacyNote>
              <ActionLink to="/journal">
                查看答题记录 <ArrowRight size={17} />
              </ActionLink>
            </section>
            <section className="card pulse-social-card">
              <span className="eyebrow">邀请朋友竞猜</span>
              <h2>让朋友猜你的答案</h2>
              <p>
                创建竞猜邀请后，朋友可以回答这道题；提交猜测后才能查看你的答案。
              </p>
              <ActionLink
                secondary
                to={`/guess/new?answer=${encodeURIComponent(pulse.answer.id)}`}
              >
                创建竞猜邀请 <ArrowRight size={17} />
              </ActionLink>
              <p className="pulse-evidence-note">
                邀请朋友是可选的，不影响你继续每日答题。
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
                  今日答题
                  <br />
                  <em>请选择答案</em>
                </h1>
                <p>
                  每天回答一道二选一题目。提交后可查看统计，也可邀请朋友猜你的答案。
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
                  选择选项后点击提交。每日答题不会修改你的自我镜像结果。
                </PrivacyNote>
                <Button disabled={!choice} busy={busy} onClick={submit}>
                  提交答案 <ArrowRight size={18} />
                </Button>
                {error && <Notice>{error}</Notice>}
                <div className="pulse-question-footer">
                  <span>每天可回答一道题目。</span>
                  <Link className="text-link" to="/mirror">
                    回到镜像 <ArrowRight size={16} />
                  </Link>
                </div>
              </section>
              <div className="pulse-benefits">
                <div>
                  <Star size={22} />
                  <span>
                    <strong>可独立答题</strong>
                    <small>无需邀请朋友</small>
                  </span>
                </div>
                <div>
                  <ChartNoAxesColumnIncreasing size={22} />
                  <span>
                    <strong>保留答题记录</strong>
                    <small>按日期查看答案</small>
                  </span>
                </div>
                <div>
                  <Heart size={22} />
                  <span>
                    <strong>答案默认私密</strong>
                    <small>由你决定是否分享</small>
                  </span>
                </div>
              </div>
              <Link className="text-link pulse-existing-count" to="/journal">
                <BookOpen size={16} />
                {pulse.saved_count} 条答题记录 · 查看记录{" "}
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
          <Badge>每日答题记录</Badge>
          <h1>
            <em>答题记录</em>
          </h1>
          <p>按日期和选项筛选记录，查看每次提交的题目与答案。</p>
        </div>
        <span className="journal-thought">记录默认仅你可见</span>
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
          title={filterKey ? "没有符合筛选条件的记录" : "暂无答题记录"}
          action={
            <ActionLink to="/today">
              开始今日答题 <ArrowRight size={17} />
            </ActionLink>
          }
        >
          {filterKey
            ? "试试其他日期或清除筛选，原有记录不会改变。"
            : "完成今日答题后，题目和答案会保存在这里。"}
        </Empty>
      ) : (
        <>
          <div className="journal-grid">
            <section className="card journal-list">
              <div className="journal-record-heading">
                <div>
                  <h2>我的答题记录</h2>
                  <p>以下为你已提交的答案。</p>
                </div>
                <span className="pulse-saved-pill">
                  <Check size={15} />
                  {journal.data.total} 条记录
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
                      <Sun size={17} /> 当日题目
                    </span>
                    <h3>{entry.question.prompt}</h3>
                    <div className="journal-choice-pill">
                      <span className="journal-choice-letter">
                        {entry.choice}
                      </span>
                      <div>
                        <small>当时的答案</small>
                        <p>
                          {entry.choice === "A"
                            ? entry.question.choice_a
                            : entry.question.choice_b}
                        </p>
                      </div>
                    </div>
                    <p className="journal-record-note">
                      此记录保留提交时的答案，不代表固定性格。
                    </p>
                  </div>
                  <details className="journal-record-details">
                    <summary>
                      查看记录详情 <ArrowRight size={15} />
                    </summary>
                    <div>
                      <strong>答题详情</strong>
                      <p>
                        保存在 {formatDate(entry.answered_at)}
                        。记录不会因之后的答题而改变。
                      </p>
                      {entry.share_eligible && (
                        <Link
                          className="text-link"
                          to={`/guess/new?answer=${encodeURIComponent(entry.answer_id)}`}
                        >
                          邀请朋友猜此答案 <ArrowRight size={14} />
                        </Link>
                      )}
                    </div>
                  </details>
                </article>
              ))}
              {journal.data.next_cursor && (
                <Button secondary busy={busy} onClick={more}>
                  加载更早记录
                </Button>
              )}
              {moreError && <Notice>{moreError}</Notice>}
            </section>
            <aside className="journal-editorial-aside">
              <section className="journal-scrapbook" aria-label="答题记录说明">
                <Heart
                  className="journal-scrap-heart"
                  size={35}
                  aria-hidden="true"
                />
                <div className="journal-paper">
                  <span className="eyebrow">已保存的记录</span>
                  <h2>按日期查看答案</h2>
                  <p>每条记录包含题目、答案和提交日期。</p>
                  <img
                    src="/design/journal-small-reference.png"
                    alt="Nolya 品牌插图，不是用户照片。"
                  />
                  <div className="journal-paper-line" />
                  <p>记录不会自动公开给朋友。</p>
                  <span className="journal-handwriting">随时查看</span>
                </div>
                <p className="journal-scrap-caption">
                  你可以选择一条符合条件的记录，邀请朋友竞猜。
                </p>
                <Sparkles
                  className="journal-scrap-star"
                  size={25}
                  aria-hidden="true"
                />
              </section>
              <section className="card solo-card">
                <Badge>答题统计</Badge>
                <h2>{solo.data?.eligible ? "近期答题汇总" : "累计答题进度"}</h2>
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
                          相同答案占比最高的题目：
                          {solo.data.most_aligned.entry.question.prompt}
                        </p>
                        <small>
                          {solo.data.most_aligned.same_choice_percent}%
                          的本期参与者与你选择相同
                        </small>
                      </div>
                    )}
                    {solo.data.most_different && (
                      <div className="solo-insight">
                        <p>
                          相同答案占比最低的题目：
                          {solo.data.most_different.entry.question.prompt}
                        </p>
                        <small>
                          {solo.data.most_different.same_choice_percent}%
                          的本期参与者与你选择相同
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
              <span className="eyebrow">继续答题</span>
              <h2>查看今日题目</h2>
              <p>返回今日题目查看作答状态，或邀请朋友猜一条已保存的答案。</p>
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
                  邀请朋友竞猜
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
                  注册并保留记录 <ArrowRight size={14} />
                </Link>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
