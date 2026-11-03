// KID-442/KID-452: the board-approved Sunshine Daycare privacy policy (verdicts card
// 8fd5452a, item privacy_policy = approve, 2026-11-02T21:17:46Z), served as a
// standalone document on every host at /privacy. Content lineage: approved artifact
// privacy-policy.draft.html (KID-449 attachment 2f4677cd, sha256
// bc5196cb75a392b9ab3e9ef926e1ba0dd1b0a4f63a388d21ab300dca0c481272). The only
// differences from that artifact are draft scaffolding removals documented on
// KID-452: the DRAFT banner/comments/(DRAFT) markers, their .banner CSS rule, the
// [DATE] placeholder set to the board's approval date, and the two address
// parentheticals resolved by the board's support_contact approve. The policy
// wording itself is byte-for-byte the approved text; the Play listing (KID-442)
// cites this single URL.
const POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sunshine Daycare — Privacy Policy</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6}h1{font-size:1.6em}</style>
</head>
<body>
<h1>Sunshine Daycare app — Privacy Policy</h1>
<p><strong>App:</strong> Sunshine Daycare (<code>net.kiddyapp.sunshine</code>), a wrapper of <code>https://sunshine.kiddyapp.net</code>.<br>
<strong>Last updated:</strong> November 2, 2026</p>
<h2>1. What this app is</h2>
<p>Sunshine Daycare is the parent app for families registered at Sunshine Daycare. Your daycare creates your account. There is no public sign-up in the app.</p>
<h2>2. Data we handle</h2>
<ul>
<li><strong>Account data:</strong> your email address and password, used only to sign you in. Sessions are kept in a login cookie on your device so you stay signed in.</li>
<li><strong>Child data:</strong> the app shows parents the children linked to their own account (names and the daycare's records for those children). A parent only sees their own linked children — never other families' children.</li>
<li><strong>Support-chat data:</strong> if you use the in-app support chat, your messages and basic device/browser information needed to deliver the chat are processed by our chat provider (Chatwoot) so we can answer you.</li>
</ul>
<h2>3. What we do NOT do</h2>
<ul>
<li>No advertising in the app.</li>
<li>No advertising trackers and no third-party analytics SDKs were found in the shipped app code. The app loads only its own web service and the Chatwoot chat script when chat is enabled.</li>
<li>We do not sell personal data.</li>
</ul>
<h2>4. How data is used</h2>
<p>Data is used only to operate the app: sign-in, showing your linked children, signing out, and answering support messages. Access is limited to you, your daycare, and the platform team operating the service.</p>
<h2>5. Children</h2>
<p>The app is used by parents and guardians. The daycare — not the app — decides which children are linked to which parent account. If a link looks wrong, contact your daycare.</p>
<h2>6. Retention and deletion</h2>
<p>Account and child records exist while your family is registered at the daycare. To ask for correction or deletion, contact your daycare or email <code>info@kiddyapp.net</code>. Support messages are kept as needed to resolve your request.</p>
<h2>7. Security</h2>
<p>Sign-in is account-based and sessions end on sign-out. Never share your password. The app is served over HTTPS.</p>
<h2>8. Changes</h2>
<p>Material changes will be posted at the policy URL above with a new date. Continued use after the date means you accept the update.</p>
<h2>9. Contact</h2>
<p>Questions about this policy: <code>info@kiddyapp.net</code>. For account or child-record questions, contact Sunshine Daycare directly.</p>
</body>
</html>
`;

export async function GET() {
  return new Response(POLICY_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
