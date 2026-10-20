import React, { useRef } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import Home from "./Home";
import { SelfPage, SelfResultPage } from "./Self";
import { FriendPage, InvitePage, MirrorPage } from "./Friends";
import { TodayPage, JournalPage } from "./Daily";
import { GuessNewPage, GuessPage } from "./Guess";
import { AccountPage, SpacePage } from "./Account";
import { ActionLink, Empty, Layout } from "./ui";
import "./styles.css";
import { RecoverPage } from "./Security";
import { HelpPage } from "./Help";
import { HistoryPage } from "./History";
function App() {
  const location = useLocation();
  const { user } = useSession();
  const identity = useRef(user?.id);
  const identityEpoch = useRef(0);
  if (identity.current && identity.current !== user?.id)
    identityEpoch.current += 1;
  identity.current = user?.id;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/self"
          element={<SelfPage key={identityEpoch.current} />}
        />
        <Route
          path="/self/result"
          element={<SelfResultPage key={user?.id || "signed-out"} />}
        />
        <Route
          path="/self/history"
          element={<HistoryPage key={user?.id || "signed-out"} />}
        />
        <Route
          path="/invite"
          element={<InvitePage key={user?.id || "signed-out"} />}
        />
        <Route
          path="/friend/:token"
          element={
            <FriendPage key={`${location.pathname}:${identityEpoch.current}`} />
          }
        />
        <Route
          path="/mirror"
          element={<MirrorPage key={user?.id || "signed-out"} />}
        />
        <Route
          path="/today"
          element={<TodayPage key={identityEpoch.current} />}
        />
        <Route
          path="/journal"
          element={<JournalPage key={user?.id || "signed-out"} />}
        />
        <Route
          path="/guess/new"
          element={
            <GuessNewPage key={`${location.search}:${identityEpoch.current}`} />
          }
        />
        <Route
          path="/guess/:token"
          element={
            <GuessPage key={`${location.pathname}:${identityEpoch.current}`} />
          }
        />
        <Route
          path="/space"
          element={<SpacePage key={user?.id || "signed-out"} />}
        />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route
          path="*"
          element={
            <div className="container narrow-page">
              <Empty
                title="这一页还没找到"
                action={<ActionLink to="/">回到首页</ActionLink>}
              >
                也许是链接有一点点偏差，先回去看看吧。
              </Empty>
            </div>
          }
        />
      </Routes>
    </Layout>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
