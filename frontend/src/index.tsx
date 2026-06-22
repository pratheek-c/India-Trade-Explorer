import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root")!;
if (import.meta.hot) {
  (import.meta.hot.data.root ??= createRoot(root)).render(
    <StrictMode><App /></StrictMode>
  );
} else {
  createRoot(root).render(
    <StrictMode><App /></StrictMode>
  );
}
