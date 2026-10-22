import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import Home from "../src/Home";
import { SessionProvider, useSession } from "../src/session";
let navigate: ReturnType<typeof useNavigate>;
let session: ReturnType<typeof useSession>;
function Probe() {
  navigate = useNavigate();
  session = useSession();
  return null;
}
export { act };
export const go = (path: string | number) =>
  typeof path === "number" ? navigate(path) : navigate(path);
export const refresh = () => session.refresh();
export function mount(element: HTMLElement) {
  const root = createRoot(element);
  root.render(
    <React.StrictMode>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SessionProvider>
          <Probe />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/other" element={<p>另一页</p>} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </React.StrictMode>,
  );
  return root;
}
