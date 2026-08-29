import { createRoot } from "react-dom/client";
import { Workbench } from "./Workbench";
import { WorkbenchBoundary } from "./components/WorkbenchBoundary";

createRoot(document.getElementById("root")!).render(
  <WorkbenchBoundary>
    <Workbench />
  </WorkbenchBoundary>,
);
