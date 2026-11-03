// KID-443 (defect 2 of the Sunshine TWA QA round): Digital Asset Links for the
// tenant-owned TWA apps, served as CODE from the platform (not a per-tenant
// static file a deployment can forget).
//
// The verifier (https://sunshine.kiddyapp.net/.well-known/assetlinks.json) is
// wired with a next.config rewrites entry to the app/api/assetlinks route,
// which resolves the statement set per REQUEST HOST through the SAME
// per-origin tenancy rule every tenant surface uses (lib/subdomain.ts
// splitSubdomainHost + the slug registry below). Adding a tenant's TWA later
// is a one-line registry entry — no redeploy per tenant, no Vercel static
// file to keep in sync.
//
// The certificate fingerprint is PUBLIC information (it is published in this
// file by design, like a TLS cert fingerprint), so a constant is fine here;
// it is NOT a secret and there is no keystore material in this module. The
// signing keystore lives outside the repo (docs/WHITE_LABEL_APPS.md,
// docs/SUNSHINE_TWA_BUILD.md) and its derivation command is in the build doc.
import { splitSubdomainHost } from "./subdomain";

export const TWA_RELATION = "delegate_permission/common.handle_all_urls";
export const TWA_NAMESPACE = "android_app";

/** The SHA-256 fingerprint of the current shared release certificate, in the
 *  exact form assetlinks.json wants: base64 of the RAW digest bytes (not the
 *  hex string keytool prints). Derived (never hand-copied) from the release
 *  keystore via:
 *
 *    keytool -exportcert -keystore <jks> -alias kiddy-release -rfc \
 *      | openssl x509 -outform der \
 *      | openssl dgst -sha256 -binary \
 *      | base64 -w0
 *
 *  QA (KID-441) recorded the same cert as hex
 *  8ce12814125fd35db0f662dc56d6f3d5e5a3f714bc2c2656483f30263d5001bd — the
 *  base64 rendering of that digest must match this constant. */
export const KIDDY_RELEASE_CERT_SHA256_BASE64 =
  "jOEoFBJf012w9mLcVtbz1eWj9xS8LCZWSD8wJj1QAb0=";

export interface TwaApp {
  packageNames: string[];
  sha256CertFingerprints: string[];
}

/** Per-daycare Android packages that the host's host assetlinks must bless.
 *  KID-459 (2026-11-03): the board's Play package naming rule is
 *  `<daycare>.kiddy.app`; sunshine.kiddy.app is the Play app record package.
 *  The legacy entries stay published so fielded builds keep re-targeting the
 *  host without breaking verification:
 *   - net.kiddyapp.sunshine — the KID-440/443/446/454/456 test TWA/APK lineage;
 *   - com.kiddy.app — the KID-251 control build still installed on QA devices.
 *  Every package is signed with the SAME release certificate (single-keystore
 *  rule), so one fingerprint serves all statements. */
const TWA_PACKAGES_BY_SUBDOMAIN: Record<string, string[]> = {
  sunshine: ["sunshine.kiddy.app", "net.kiddyapp.sunshine", "com.kiddy.app"],
};

export type AssetLinksStatement = {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
};

function statementsFor(packageName: string): AssetLinksStatement[] {
  return [
    {
      relation: [TWA_RELATION],
      target: {
        namespace: TWA_NAMESPACE,
        package_name: packageName,
        sha256_cert_fingerprints: [KIDDY_RELEASE_CERT_SHA256_BASE64],
      },
    },
  ];
}

/** The statement set the REQUEST host must publish, or null when the host
 *  carries no TWA (apex / legacy / preview / unknown subdomains get the same
 *  fail-closed neutral treatment as the tenant surfaces). */
export function assetLinksForHost(host: string | null | undefined): AssetLinksStatement[] | null {
  const ctx = splitSubdomainHost(host);
  if (ctx.kind !== "subdomain") return null;
  const packageNames = TWA_PACKAGES_BY_SUBDOMAIN[ctx.slug];
  if (!packageNames) return null;
  return packageNames.flatMap(statementsFor);
}
