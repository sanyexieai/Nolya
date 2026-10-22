import { useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Fingerprint,
  HeartHandshake,
  Sparkles,
  Sprout,
} from "lucide-react";
import { ActionLink, Badge, HeroArt } from "./ui";
import copy from "./home.zh-CN.json";
import { selectHomeHero } from "./home-copy";
import { useSession } from "./session";
export default function Home() {
  const { user } = useSession();
  // A route exit unmounts Home. Returning (including Back/Forward) draws again.
  // Keep the committed choice through session updates and StrictMode replay.
  const heroRef = useRef<(typeof copy.hero.variants)[number] | null>(null);
  if (heroRef.current === null)
    heroRef.current = selectHomeHero(copy.hero.variants);
  const hero = heroRef.current;
  return (
    <div className="home">
      <section className="home-hero container" data-hero-variant={hero.id}>
        <div className="hero-copy">
          <Badge>{hero.eyebrow}</Badge>
          <h1>
            {hero.headline.split("\n").map((line, index) =>
              index === 2 ? (
                <em key={line}>{line}</em>
              ) : (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ),
            )}
          </h1>
          <p>{hero.subheadline}</p>
          <div className="hero-actions">
            <ActionLink to="/self">
              {copy.hero.primaryCTA}
              <ArrowUpRight size={20} />
            </ActionLink>
            <ActionLink to="/mirror" secondary>
              {copy.hero.secondaryCTA}
            </ActionLink>
          </div>
          <div className="micro-benefits">
            {copy.microBenefits.map((benefit) => (
              <span key={benefit}>
                <Check size={14} />
                {benefit}
              </span>
            ))}
          </div>
        </div>
        <HeroArt />
      </section>
      <section className="steps-section container" aria-label="如何开始">
        {copy.steps.map((step, index) => {
          const Icon = [Fingerprint, HeartHandshake, Sprout][index];
          return (
            <div className="step-card" key={step.index}>
              <span className="step-number">{step.index}</span>
              <span className={`step-icon ${index === 1 ? "rose" : "violet"}`}>
                <Icon size={30} />
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </div>
          );
        })}
      </section>
      <section className="home-bottom container">
        <div>
          <span className="eyebrow">每日问题</span>
          <h2>回答今日问题</h2>
          <p>选择符合你实际情况的答案，并在我的空间查看记录。</p>
        </div>
        <Link to="/today" className="daily-teaser">
          <span className="teaser-icon">
            <Sparkles size={23} />
          </span>
          <div>
            <span>每日选择</span>
            <strong>{user ? "查看今日问题" : "回答今日问题"}</strong>
          </div>
          <ArrowUpRight size={23} />
        </Link>
      </section>
    </div>
  );
}
