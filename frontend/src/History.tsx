import { BrandCompanion } from "./ui";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, formatDate } from "./api";
import type { SelfResult } from "./api";
import { useSession } from "./session";
import { Button, Empty, Loading, Notice, PageHeading, useResource } from "./ui";
interface History {
  assessments: SelfResult[];
  next_cursor: string | null;
  total: number;
}
export function HistoryPage() {
  const { user } = useSession();
  const resource = useResource(
    () =>
      user
        ? api<History>("/self/history")
        : Promise.resolve({ assessments: [], next_cursor: null, total: 0 }),
    [user?.id],
  );
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = useRef(user?.id);
  identity.current = user?.id;
  const latest = resource.data?.assessments[0];
  const previous =
    resource.data?.assessments.find((a) => a.id === selected) ||
    resource.data?.assessments[1];
  async function more() {
    if (!resource.data?.next_cursor || busy) return;
    const owner = user?.id;
    setBusy(true);
    setError("");
    try {
      const next = await api<History>(
        `/self/history?cursor=${encodeURIComponent(resource.data.next_cursor)}`,
      );
      if (owner === identity.current)
        resource.setData({
          ...next,
          assessments: [...resource.data.assessments, ...next.assessments],
        });
    } catch (e) {
      if (owner === identity.current) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container journal-page">
      <BrandCompanion label="不同时间，也有不同面的自己" />
      <PageHeading
        eyebrow="SELF HISTORY · 镜像历史"
        title="在变化里，重新认识自己。"
        description="每次镜像独立保存。这里比较你自己在不同时间的选择，不评判成长或退步。"
      />
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !latest ? (
        <Empty
          title="还没有镜像记录"
          action={
            <Link className="button" to="/self">
              开始第一次镜像
            </Link>
          }
        >
          完成 8 个生活选择后，就可以在这里回顾。
        </Empty>
      ) : (
        <>
          <section className="card history-comparison">
            <h2>最近一次与过去的我</h2>
            <p>
              最新记录：{formatDate(latest.created_at)} ·{" "}
              {latest.created_at.slice(0, 4)}
            </p>
            {previous ? (
              <>
                <label htmlFor="compare-assessment">选择对比记录</label>
                <select
                  id="compare-assessment"
                  value={previous.id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {resource.data?.assessments.slice(1).map((a, i) => (
                    <option key={a.id} value={a.id}>
                      {a.created_at.slice(0, 10)} · 第{" "}
                      {resource.data!.total - i - 1} 次镜像
                    </option>
                  ))}
                </select>
                {latest.version !== previous.version && (
                  <Notice kind="info">
                    这两次镜像使用不同版本的问题，仅保留各自记录，不直接比较偏好变化。
                  </Notice>
                )}
                <div className="history-dimensions">
                  {latest.dimensions.map((d) => {
                    const before = previous.dimensions.find(
                      (p) => p.dimension === d.dimension,
                    );
                    return (
                      <article key={d.dimension}>
                        <h3>
                          {d.dimension === "D1"
                            ? "生活的节奏"
                            : d.dimension === "D2"
                              ? "表达的方式"
                              : d.dimension === "D3"
                                ? "面对新鲜事"
                                : "情绪的流动"}
                        </h3>
                        <p>之前：{before?.label || "暂无可比结果"}</p>
                        <p>现在：{d.label}</p>
                        <span className="badge">
                          {latest.version !== previous.version || !before
                            ? "暂无可比结果"
                            : before.score === d.score
                              ? "这一次，偏好相近"
                              : "这一次，有些不同"}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <p>
                目前只有一次镜像。将来再回答时，可以回来看当下的选择有哪些变化。
              </p>
            )}
            <Link className="text-link" to="/self">
              再做一次镜像
            </Link>
          </section>
          <section className="card">
            <h2>全部 {resource.data?.total} 次记录</h2>
            {resource.data?.assessments.map((a) => (
              <details key={a.id} className="history-entry">
                <summary>
                  {a.created_at.slice(0, 10)} · {a.summary}
                </summary>
                <ul>
                  {a.dimensions.map((d) => (
                    <li key={d.dimension}>{d.label}</li>
                  ))}
                </ul>
                {a.observations.map((text, i) => (
                  <p key={i}>{text}</p>
                ))}
              </details>
            ))}
            {resource.data?.next_cursor && (
              <Button secondary busy={busy} onClick={more}>
                加载更早镜像
              </Button>
            )}
            {error && <Notice>{error}</Notice>}
          </section>
        </>
      )}
    </div>
  );
}
