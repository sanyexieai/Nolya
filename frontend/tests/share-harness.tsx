import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ShareKind } from "../src/share-core";
import { SharePanel } from "../src/Share";
export { act };
export function mount(
  element: HTMLElement,
  value: string,
  kind: ShareKind = "friend",
) {
  const root = createRoot(element);
  const render = (next: string) =>
    root.render(<SharePanel key={next} value={next} kind={kind} />);
  render(value);
  return { unmount: () => root.unmount(), render };
}
