"use client";

import { useState } from "react";
import { addStaffAction } from "@/lib/actions";

type Room = { id: string; name: string };

export type AddStaffFormLabels = {
  title: string;
  hint: string;
  fullNameLabel: string;
  roleLabel: string;
  carer: string;
  admin: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  generate: string;
  roomAccess: string;
  submit: string;
};

const DEFAULT_LABELS: AddStaffFormLabels = {
  title: "Add a staff member",
  hint: "Adding an email creates a login for this staff member. Give them the email and password below so they can sign in (they can reset it later).",
  fullNameLabel: "Full name",
  roleLabel: "Role",
  carer: "Carer",
  admin: "Admin",
  emailLabel: "Login email",
  emailPlaceholder: "staff@yourdaycare.eg",
  passwordLabel: "Temporary password",
  passwordPlaceholder: "At least 6 characters",
  generate: "Generate",
  roomAccess: "Room access",
  submit: "Add staff",
};

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) out += alphabet[(bytes[i] || Math.random() * 1e9) % alphabet.length];
  return out;
}

export default function AddStaffForm({ rooms, labels = DEFAULT_LABELS }: { rooms: Room[]; labels?: AddStaffFormLabels }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form className="card mb-4" action={addStaffAction}>
      <h2 className="subtitle">{labels.title}</h2>
      <p className="muted small">{labels.hint}</p>
      <div className="row mt-2">
        <div className="col field"><label className="label">{labels.fullNameLabel}</label><input className="input" name="fullName" required /></div>
        <div className="col field"><label className="label">{labels.roleLabel}</label>
          <select className="select" name="role"><option value="carer">{labels.carer}</option><option value="admin">{labels.admin}</option></select>
        </div>
      </div>
      <div className="row">
        <div className="col field">
          <label className="label">{labels.emailLabel}</label>
          <input className="input" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={labels.emailPlaceholder} />
        </div>
        <div className="col field">
          <label className="label">{labels.passwordLabel}</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" name="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder={labels.passwordPlaceholder} />
            <button type="button" className="btn btn-ghost" onClick={() => setPassword(generatePassword())}>
              {labels.generate}
            </button>
          </div>
        </div>
      </div>
      <div className="field">
        <label className="label">{labels.roomAccess}</label>
        <div className="row">
          {rooms.map((r) => (
            <label key={r.id} className="row small" style={{ gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="roomIds" value={r.id} /> {r.name}
            </label>
          ))}
        </div>
      </div>
      <button className="btn btn-primary" type="submit">{labels.submit}</button>
    </form>
  );
}
