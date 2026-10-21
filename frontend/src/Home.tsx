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
import { useSession } from "./session";
export default function Home() {
  const { user } = useSession();
  return (
    <div className="home">
      <section className="home-hero container">
        <div className="hero-copy">
          <Badge>{copy.hero.eyebrow}</Badge>
          <h1>
            {copy.hero.headline.split("\n").map((line, index) =>
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
          <p>{copy.hero.subheadline}</p>
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
          <span className="eyebrow">A LITTLE CHOICE, EVERY DAY</span>
          <h2>今天的你，会怎么选？</h2>
          <p>不急着定义自己。一个人，也可以慢慢发现。</p>
        </div>
        <Link to="/today" className="daily-teaser">
          <span className="teaser-icon">
            <Sparkles size={23} />
          </span>
          <div>
            <span>DAILY PULSE</span>
            <strong>
              {user ? "继续今天的小选择" : "留给今天的一个小问题"}
            </strong>
          </div>
          <ArrowUpRight size={23} />
        </Link>
      </section>
    </div>
  );
}
