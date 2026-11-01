import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App";
import { WorkspaceWindow } from "./Workspace";
import { IS_WINDOW } from "./store";
import "./styles.css";


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* `?ws=1`: a pop-out window (from the backend's pool); otherwise the main window */}
    <ReactFlowProvider>{IS_WINDOW ? <WorkspaceWindow /> : <App />}</ReactFlowProvider>
  </StrictMode>,
);
