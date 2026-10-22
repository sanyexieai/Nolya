// DOM component-test harness. Production components, router, session provider,
// and API implementation are bundled together so tests exercise their real effects.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { SelfResultPage } from "../src/Self";
import { RecoverPage } from "../src/Security";
import { GuessNewPage, GuessPage } from "../src/Guess";
import { InvitePage } from "../src/Friends";
import { HistoryPage } from "../src/History";
import { JournalPage } from "../src/Daily";
import { SpacePage } from "../src/Account";
import { AccountPage } from "../src/Account";
import { SessionProvider, useSession } from "../src/session";
import { post } from "../src/api";

let session: ReturnType<typeof useSession>;
let navigate: ReturnType<typeof useNavigate>;
let location = "";
function Probe() {
  session = useSession();
  navigate = useNavigate();
  location = useLocation().pathname;
  return <Link to="/other">离开此页</Link>;
}

function KeyedInvite() {
  const { user } = useSession();
  return <InvitePage key={user?.id || "signed-out"} />;
}
export { act, post };
export const currentSession = () => session;
export const currentPath = () => location;
export const go = (path: string) => navigate(path);
export function mount(element: HTMLElement) {
  const root = createRoot(element);
  root.render(
    <React.StrictMode>
      <SessionProvider>
        <MemoryRouter
          initialEntries={["/account"]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Probe />
          <Routes>
            <Route path="/account" element={<AccountPage />} />
            <Route path="/recover" element={<RecoverPage />} />
            <Route path="/self/history" element={<HistoryPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/self/result" element={<SelfResultPage />} />
            <Route path="/guess/new" element={<GuessNewPage />} />
            <Route path="/guess/:token" element={<GuessPage />} />
            <Route path="/invite" element={<KeyedInvite />} />
            <Route path="/manage" element={<SpacePage />} />
            <Route path="/space" element={<p>账户空间已打开</p>} />
            <Route path="/other" element={<p>另一页</p>} />
            <Route path="/" element={<p>首页</p>} />
            <Route path="/today" element={<p>今天</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </React.StrictMode>,
  );
  return root;
}
