"use client";

import { useState } from "react";

// KID-733: the Add a child form can create (or link) the parent login with a
// temporary password sent to the guardian email typed on this form. The
// password block only appears once a guardian email is present — there is no
// way to enter a password without an email address, and the server still
// validates the pair before creating anything (rejects write nothing).
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) out += alphabet[(bytes[i] || Math.random() * 1e9) % alphabet.length];
  return out;
}

export default function AddChildParentLoginFields({
  labels,
}: {
  labels: Record<string, string>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const showLogin = email.trim() !== "" || password !== "";
  const missingEmail = password !== "" && email.trim() === "";

  return (
    <div className="row">
      <div className="col field">
        <label className="label">{labels.emailLabel}</label>
        <input
          className="input"
          name="guardianEmail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {showLogin && (
        <div className="col field">
          <label className="label">{labels.passwordLabel}</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              name="parentLoginPassword"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder={labels.passwordPlaceholder}
            />
            <button type="button" className="btn btn-ghost" onClick={() => setPassword(generatePassword())}>
              {labels.generateBtn}
            </button>
          </div>
          {missingEmail && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8, marginBottom: 0 }}>
              {labels.emailRequiredHint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
