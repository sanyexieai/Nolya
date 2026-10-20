import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Fingerprint,
  HeartHandshake,
  Sparkles,
  Sprout,
} from "lucide-react";
import { ActionLink, Badge, HeroArt, SmallArrowLink } from "./ui";
import { useSession } from "./session";
export default function Home() {
  const { user } = useSession();
  return (
    <div className="home">
      <section className="home-hero container">
        <div className="hero-copy">
          <Badge>一个更真实的你，正等着被发现</Badge>
          <h1>
            你以为你了解自己，
            <br />
            其实你还没见过
            <br />
            <em>朋友眼中的你。</em>
          </h1>
          <p>
            从 8 个轻松的生活选择开始。
            <br />
            再借朋友的眼睛，看看那个熟悉、意外，
            <br className="desktop-break" />
            又值得被发现的自己。
          </p>
          <div className="hero-actions">
            <ActionLink to="/self">
              开始我的第一次镜像 <ArrowUpRight size={20} />
            </ActionLink>
            <SmallArrowLink to="/mirror">看看我的镜像</SmallArrowLink>
          </div>
          <div className="micro-benefits">
            <span>
              <Check size={14} />约 1 分钟
            </span>
            <span>
              <Check size={14} />
              无需注册
            </span>
            <span>
              <Check size={14} />
              没有标准答案
            </span>
          </div>
        </div>
        <HeroArt />
      </section>
      <section className="steps-section container" aria-label="如何开始">
        <div className="step-card">
          <span className="step-number">01</span>
          <span className="step-icon violet">
            <Fingerprint size={30} />
          </span>
          <div>
            <h3>先看见自己</h3>
            <p>
              8 个真实生活选择，
              <br />
              拼出你的第一张镜像卡。
            </p>
          </div>
        </div>
        <div className="step-card">
          <span className="step-number">02</span>
          <span className="step-icon rose">
            <HeartHandshake size={30} />
          </span>
          <div>
            <h3>再听听朋友怎么想</h3>
            <p>
              每人 3 个小问题，
              <br />
              发现彼此看见的不同侧面。
            </p>
          </div>
        </div>
        <div className="step-card">
          <span className="step-number">03</span>
          <span className="step-icon sage">
            <Sprout size={30} />
          </span>
          <div>
            <h3>把变化留下来</h3>
            <p>
              每天一个小选择，
              <br />
              慢慢遇见更完整的自己。
            </p>
          </div>
        </div>
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
