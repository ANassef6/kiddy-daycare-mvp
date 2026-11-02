"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/lib/actions";
import type { Dict, Locale } from "@/lib/i18n";
import AuthBrand from "@/components/AuthBrand";
import AuthLangToggle from "@/components/AuthLangToggle";
import { dirFor } from "@/lib/i18n";

export type ForgotCopy = Dict["forgot"];

// KID-437: the form stays client-side; the brand header is the shared
// AuthBrand, per-origin like /login — the server page (page.tsx) resolves the
// tenant's own name for the first paint, and the client fetch keeps it live
// (KID-368 acceptance).
//
// KID-443 (defect 3): every string now comes from the lib/i18n forgot section
// (server-resolved from the kiddy_lang cookie) so the page follows the same
// pre-sign-in EN/AR toggle /login offers.
export default function ForgotPasswordForm({
  brandName,
  copy,
  toggle,
  locale,
}: {
  brandName: string;
  copy: ForgotCopy;
  toggle: { locale: Locale; label: string; en: string; ar: string };
  locale: Locale;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }} dir={dirFor(locale)}>
      <AuthBrand brandName={brandName} />
      <AuthLangToggle locale={toggle.locale} label={toggle.label} en={toggle.en} ar={toggle.ar} />
      <h1 className="title mt-4">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      {sent ? (
        <div className="card" dir="auto">
          <h2 className="title" style={{ fontSize: 18 }}>{copy.sentTitle}</h2>
          <p className="muted small mt-1">{copy.sentBody}</p>
          <p className="muted small mt-2">{copy.sentRetry}</p>
        </div>
      ) : (
        <form
          className="card"
          action={async (fd) => {
            const res = await requestPasswordResetAction(fd);
            if (res?.error) setError(res.error);
            else setSent(true);
          }}
        >
          {error && <p style={{ color: "#dc2626", marginBottom: 12 }} dir="auto">{error}</p>}
          <div className="field">
            <label className="label">{copy.emailLabel}</label>
            <input className="input" name="email" type="email" required autoComplete="email" />
          </div>
          <button className="btn btn-primary btn-block" type="submit">{copy.sendBtn}</button>
        </form>
      )}
      <p className="small mt-3">
        <Link href="/login">{copy.backToSignin}</Link>
      </p>
    </div>
  );
}
