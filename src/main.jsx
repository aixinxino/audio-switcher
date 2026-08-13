import React from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { MainWindow } from "./components/IslandWindow";
import { useAudioSwitcher } from "./hooks/useAudioSwitcher";

function App() {
  const model = useAudioSwitcher();
  return <MainWindow model={model} />;
}

createRoot(document.querySelector("#app")).render(<App />);
