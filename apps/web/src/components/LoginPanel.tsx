import type { ReactElement } from "react";

import type { UserRole } from "../types.js";

const ROLES: readonly UserRole[] = ["REVIEWER", "APPROVER", "AUTHOR", "ADMIN"];

export interface LoginPanelProps {
  readonly onLogin: (role: UserRole) => void;
}

export function LoginPanel({ onLogin }: LoginPanelProps): ReactElement {
  return (
    <main className="login-panel" aria-labelledby="login-title">
      <section className="card">
        <p className="eyebrow">VERA locale</p>
        <h1 id="login-title">Audit desk dimostrativo</h1>
        <p>
          Seleziona un ruolo locale. Gli account e i dati sono sintetici e hanno ambito{" "}
          <code>TECHNICAL_DEMO</code>.
        </p>
        <div className="role-grid" aria-label="Ruoli demo">
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => {
                onLogin(role);
              }}
            >
              Entra come {role}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
