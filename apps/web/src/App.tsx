import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";

import { AuditDesk } from "./components/AuditDesk.js";
import { LoginPanel } from "./components/LoginPanel.js";
import type { UserRole } from "./types.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function App(): ReactElement {
  const [role, setRole] = useState<UserRole | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      {role === null ? (
        <LoginPanel
          onLogin={(nextRole) => {
            setRole(nextRole);
          }}
        />
      ) : (
        <AuditDesk
          role={role}
          onLogout={() => {
            setRole(null);
          }}
        />
      )}
    </QueryClientProvider>
  );
}
