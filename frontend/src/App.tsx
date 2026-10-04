import { Route, Routes } from "react-router-dom";
import ScriptList from "@/pages/ScriptList";
import Editor from "@/pages/Editor";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<ScriptList />} />
        <Route path="/scripts/:id" element={<Editor />} />
      </Routes>
    </ErrorBoundary>
  );
}
