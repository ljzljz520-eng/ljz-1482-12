import { Toaster } from "react-hot-toast";
import ErrorBoundary from "./components/ErrorBoundary";
import ScriptEditorPage from "./pages/ScriptEditorPage";

const App = () => (
  <ErrorBoundary>
    <ScriptEditorPage />
    <Toaster
      position="top-right"
      toastOptions={{
        style: { borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: "12px" },
      }}
    />
  </ErrorBoundary>
);

export default App;
