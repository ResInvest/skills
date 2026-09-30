import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { createQueryClient } from "./app/query";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Brak elementu #root");
const queryClient = createQueryClient();
createRoot(root).render(<StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>);
