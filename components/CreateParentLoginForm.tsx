"use client";

import { useState } from "react";
import { createParentLoginAction } from "@/lib/actions";

type Kid = { id: string; first_name: string; last_name: string };

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) out += alphabet[(bytes[i] || Math.random() * 1e9) % alphabet.length];
  return out;
}

// KID-495: admin-created parent login beside the invite flow. The daycare
// enters or generates a temporary password, shares it in person, and the
// parent is asked to change it after the first sign-in (must_change_password).
// The relationship dropdown stays a server component, passed in as a node.
export default function CreateParentLoginForm({
  labels,
  kids,
  relationship,
}: {
  labels: Record<string, string>;
  kids: Kid[];
  relationship: React.ReactNode;
}) {
  const [password, setPassword] = useState("");

  return (
    <form className="card mt-3" action={createParentLoginAction}>
      <p className="small muted">{labels.hint}</p>
      <div className="row">
        <div className="col field">
          <label className="label">{labels.childLabel}</label>
          <select className="select" name="childId">
            <option value="">{labels.childAny}</option>
            {kids.map((k) => <option key={k.id} value={String(k.id)}>{k.first_name} {k.last_name}</option>)}
          </select>
        </div>
        <div className="col field"><label className="label">{labels.nameLabel}</label><input className="input" name="fullName" required /></div>
        <div className="col field"><label className="label">{labels.emailLabel}</label><input className="input" name="email" type="email" required /></div>
      </div>
      <div className="row">
        <div className="col field"><label className="label">{labels.relationshipLabel}</label>{relationship}</div>
        <div className="col field">
          <label className="label">{labels.passwordLabel}</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" name="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder={labels.passwordPlaceholder} />
            <button type="button" className="btn btn-ghost" onClick={() => setPassword(generatePassword())}>
              {labels.generateBtn}
            </button>
          </div>
        </div>
      </div>
      <button className="btn btn-accent mt-3" type="submit">{labels.submitBtn}</button>
    </form>
  );
}
