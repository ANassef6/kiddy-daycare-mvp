"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { registerAction } from "@/lib/actions";
import AuthBrand from "@/components/AuthBrand";
import AuthLangToggle from "@/components/AuthLangToggle";

// KID-437: the form stays client-side (useSearchParams + the registration
// action); the brand header is the shared AuthBrand, per-origin like /login —
// the server page (page.tsx) resolves the tenant's own name for the first
// paint, and the client fetch keeps it live (KID-368 acceptance).
// KID-2400: every label comes from the server page's dict resolution
// (register.* + profile/common/login groups), and the pre-sign-in EN/AR
// toggle mirrors /login (locale travels from the kiddy_lang cookie).
export type RegisterLabels = {
  title: string;
  subtitle: string;
  inviteCodeLabel: string;
  inviteCodePlaceholder: string;
  fullNameLabel: string;
  emailLabel: string;
  passwordLabel: string;
  pinLabel: string;
  submitBtn: string;
  signInLink: string;
  langLabel: string;
  langEn: string;
  langAr: string;
};

export default function RegisterForm({
  brandName,
  locale,
  labels,
}: {
  brandName: string;
  locale: Locale;
  labels: RegisterLabels;
}) {
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const presetCode = searchParams.get("code") ?? "";
  // KID-115: invite links carry what the daycare already knows so invited
  // parents don't retype their own contact details. Values come from the
  // daycare's contact record, never from free input.
  const presetEmail = searchParams.get("email") ?? "";
  const presetName = searchParams.get("name") ?? "";

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <AuthBrand brandName={brandName} />
      <AuthLangToggle locale={locale} label={labels.langLabel} en={labels.langEn} ar={labels.langAr} />
      <h1 className="title mt-4">{labels.title}</h1>
      <p className="subtitle">{labels.subtitle}</p>
      <form
        className="card"
        action={async (fd) => {
          const res = await registerAction(fd);
          if (res?.error) setError(res.error);
        }}
      >
        {error && <p style={{ color: "#dc2626", marginBottom: 12 }}>{error}</p>}
        <div className="field">
          <label className="label">{labels.inviteCodeLabel}</label>
          <input
            className="input"
            name="inviteCode"
            placeholder={labels.inviteCodePlaceholder}
            required
            defaultValue={presetCode}
          />
        </div>
        <div className="field">
          <label className="label">{labels.fullNameLabel}</label>
          <input className="input" name="fullName" required defaultValue={presetName} />
        </div>
        <div className="field">
          <label className="label">{labels.emailLabel}</label>
          <input className="input" name="email" type="email" required defaultValue={presetEmail} />
        </div>
        <div className="field">
          <label className="label">{labels.passwordLabel}</label>
          <input className="input" name="password" type="password" required />
        </div>
        <div className="field">
          <label className="label">{labels.pinLabel}</label>
          <input className="input" name="pin" type="password" inputMode="numeric" maxLength={6} />
        </div>
        <button className="btn btn-primary btn-block" type="submit">{labels.submitBtn}</button>
      </form>
      <p className="small mt-3"><a href="/login">{labels.signInLink}</a></p>
    </div>
  );
}
