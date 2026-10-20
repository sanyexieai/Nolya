import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, post, setCsrfToken, errorMessage } from "./api";
import type { Session, User } from "./api";
interface SessionContextValue {
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<Session>;
  ensureGuest: () => Promise<User>;
  acceptSession: (session: Session) => void;
}
const Context = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const guestPromise = useRef<Promise<User> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const snapshot = useRef<Session>({ user: null, csrf_token: null });
  const acceptSession = useCallback((session: Session) => {
    if (
      snapshot.current.user &&
      snapshot.current.user.id !== session.user?.id
    ) {
      try {
        sessionStorage.removeItem("nolya-self-draft");
      } catch {
        /* Storage may be disabled; never block identity changes. */
      }
    }
    revision.current += 1;
    snapshot.current = session;
    setUser(session.user);
    setCsrfToken(session.csrf_token);
    setError("");
  }, []);
  const refresh = useCallback(async () => {
    const version = ++revision.current;
    const session = await api<Session>("/session");
    if (version !== revision.current) return snapshot.current;
    acceptSession(session);
    return session;
  }, [acceptSession]);
  useEffect(() => {
    refresh()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === "hidden" || guestPromise.current) return;
      void refresh().catch(() => {
        /* Preserve existing state on network failures. */
      });
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [refresh]);
  const ensureGuest = async () => {
    if (user) return user;
    if (guestPromise.current) return guestPromise.current;
    const version = revision.current;
    guestPromise.current = post<Session>("/session/guest")
      .then((session) => {
        if (version !== revision.current) {
          if (snapshot.current.user) return snapshot.current.user;
          throw new Error("账户状态已改变，请重新开始。 ");
        }
        acceptSession(session);
        if (!session.user) throw new Error("没有建立访客会话，请重试。");
        return session.user;
      })
      .finally(() => {
        guestPromise.current = null;
      });
    return guestPromise.current;
  };
  return (
    <Context.Provider
      value={{ user, loading, error, refresh, ensureGuest, acceptSession }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const context = useContext(Context);
  if (!context) throw new Error("SessionProvider missing");
  return context;
}
