"use client";

import { useState } from "react";
import { addStaffAction } from "@/lib/actions";

type Room = { id: string; name: string };

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) out += alphabet[(bytes[i] || Math.random() * 1e9) % alphabet.length];
  return out;
}

export default function AddStaffForm({ rooms }: { rooms: Room[] }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form className="card mb-4" action={addStaffAction}>
      <h2 className="subtitle">Add a staff member</h2>
      <p className="muted small">
        Adding an email creates a login for this staff member. Give them the
        email and password below so they can sign in (they can reset it later).
      </p>
      <div className="row mt-2">
        <div className="col field"><label className="label">Full name</label><input className="input" name="fullName" required /></div>
        <div className="col field"><label className="label">Role</label>
          <select className="select" name="role"><option value="carer">Carer</option><option value="admin">Admin</option></select>
        </div>
      </div>
      <div className="row">
        <div className="col field">
          <label className="label">Login email</label>
          <input className="input" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@yourdaycare.eg" />
        </div>
        <div className="col field">
          <label className="label">Temporary password</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" name="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="At least 6 characters" />
            <button type="button" className="btn btn-ghost" onClick={() => setPassword(generatePassword())}>
              Generate
            </button>
          </div>
        </div>
      </div>
      <div className="field">
        <label className="label">Room access</label>
        <div className="row">
          {rooms.map((r) => (
            <label key={r.id} className="row small" style={{ gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="roomIds" value={r.id} /> {r.name}
            </label>
          ))}
        </div>
      </div>
      <button className="btn btn-primary" type="submit">Add staff</button>
    </form>
  );
}
