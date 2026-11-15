#!/usr/bin/env python3
"""KID-2414 route-matrix render scanner (independent QA re-run of the KID-2402 battery).

Usage: kid2414-scan.py <role> <locale> <out.json>
  role: owner|admin|teacher|parent|anon
  locale: en|ar
Reads tokens from /tmp/kid2414-cookies.json (except anon).
Checks per 200 response: html dir/lang, MISSING:*, raw role keys, dictionary
leakage (EN values on AR pages / Arabic residue on EN pages), English date
tokens on AR pages, English-sentence heuristic on AR pages.
Redirects (30x) are recorded, not followed. Non-200 recorded as status rows.
"""
import json, os, re, sys, html as htmllib
import urllib.request, urllib.error
from html.parser import HTMLParser

BASE = os.environ.get("QA_BASE", "http://127.0.0.1:4124")
ROLE, LOCALE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

_IDS = json.load(open("/tmp/kid2414-ids.json"))
CHILD = _IDS["child"]
ROOM = _IDS["room"]
STAFF = _IDS["staff"]
STAFF_OWN = _IDS["staff_own"]

PORTAL = [
    "/portal/dashboard", "/portal/attendance", "/portal/calendar", "/portal/children",
    f"/portal/children/{CHILD}", f"/portal/children/{CHILD}/billing",
    f"/portal/children/{CHILD}/development", "/portal/children/development",
    "/portal/drive", "/portal/finance", "/portal/forms", "/portal/incidents",
    "/portal/inquiries", "/portal/learning", "/portal/learning/curriculum",
    "/portal/learning/activities", "/portal/learning/homework", "/portal/reports",
    "/portal/rooms", f"/portal/rooms/{ROOM}", "/portal/staff", f"/portal/staff/{STAFF}",
    "/portal/staff/hours", "/portal/staff/schedule", "/portal/support-inbox",
    "/portal/surveys", "/portal/tags", "/portal/messages", "/portal/newsfeed",
    "/portal/events", "/portal/consents", "/portal/settings", "/portal/notifications",
    "/portal/account", "/portal/account-billing", "/portal/report-center",
    "/portal/performance", "/portal/supplies", "/portal/enhancements",
    "/portal/support", "/portal/audit",
]
TEACHER_PORTAL = [r.replace(f"/portal/staff/{STAFF}", f"/portal/staff/{STAFF_OWN}") for r in PORTAL]
PARENT = [
    "/child", f"/child/{CHILD}", "/child/consents", "/child/drive", "/child/events",
    "/child/forms", "/child/incidents", "/child/learning", "/child/messages",
    "/child/newsfeed", "/child/notifications", "/child/settings", "/child/support",
]
PUBLIC = [
    "/login", "/register", "/forgot-password", "/reset-password", "/welcome",
    "/unknown-daycare", "/", "/features", "/for-centers", "/for-parents", "/contact",
]

ROUTES = {"owner": PORTAL, "admin": PORTAL, "teacher": TEACHER_PORTAL,
          "parent": PARENT, "anon": PUBLIC}[ROLE]

# ---- dictionary ----
END = json.load(open("/tmp/kid2414-en-dict.json"))
# EN values worth searching (>=4 chars, has a letter)
EN_VALS = sorted({v for v in END.values() if len(v) >= 4 and re.search(r"[A-Za-z]", v)},
                 key=len, reverse=True)

ALLOW_EN_SUBSTR = [  # allowed English on AR pages (brand/data/units per KID-2402)
    "Maple Grove", "Blue Horizon", "Kiddy", "kiddy", "Instapay", "Vikunja", "Excel",
    "Aria", "Theo", "Nova", "Imani", "maple", "Maple Owner", "horizon", "Horizon",
    "USD", "EGP", "CSV", "PDF", "English", "@kiddy-retest.test", "mwhmz",
    "http://", "https://", "localhost", "font", "Font",
]
ALLOW_AR_ON_EN = ["العربية", "عربي"]  # language option only

MONTHS_EN = r"\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\b"
WEEKDAYS_EN = r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b"
AMPM_EN = r"\b(AM|PM|am|pm)\b"
DATE_TOKEN_AR = re.compile(f"({MONTHS_EN}|{WEEKDAYS_EN}|{AMPM_EN})")
AR_DIGITS = re.compile(r"[\u0660-\u0669]")
AR_WORD = re.compile(r"[\u0600-\u06FF]")
MISSING_RE = re.compile(r"MISSING:[A-Za-z0-9_.]+")
RAW_ROLE_RE = re.compile(r"\(roles\.[a-z]+\)|roles\.(teacher|caregiver|carer|admin|staff)\b")
# English sentence heuristic: >=6 consecutive simple words in visible text
SENT_RE = re.compile(r"\b(?:[A-Za-z][A-Za-z'’-]*\s+){5,}[A-Za-z][A-Za-z'’-]*\b")


class TextExtract(HTMLParser):
    """Visible body text + form/attr values; scripts/styles/head excluded."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
        # NOTE: `value` deliberately excluded — <option value="parent"> is not
        # visible text; only what the user can actually see is checked.
        self.attrs_wanted = ("placeholder", "title", "aria-label", "alt", "label")
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "head"):
            self.skip += 1
        for k, v in attrs:
            if k in self.attrs_wanted and v and not self.skip:
                self.parts.append(v)
    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "head") and self.skip:
            self.skip -= 1
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def visible_text(doc: str) -> str:
    p = TextExtract()
    p.feed(doc)
    return " ".join(p.parts)


def html_attrs(doc: str):
    m = re.search(r"<html[^>]*>", doc, re.I)
    tag = m.group(0) if m else ""
    lang = re.search(r'lang="([^"]+)"', tag)
    dir_ = re.search(r'dir="([^"]+)"', tag)
    return (lang.group(1) if lang else None, dir_.group(1) if dir_ else None)


def allowed_en(hit: str) -> bool:
    return any(a.lower() in hit.lower() for a in ALLOW_EN_SUBSTR)


def scan_doc(doc: str):
    lang, dir_ = html_attrs(doc)
    text = visible_text(doc)
    findings = {"lang": lang, "dir": dir_, "missing": [], "raw_role": [],
                "en_dict_hits": [], "date_tokens": [], "ar_on_en": [], "sentences": []}
    findings["missing"] = sorted(set(MISSING_RE.findall(doc)))
    findings["raw_role"] = sorted(set(RAW_ROLE_RE.findall(doc)))

    if LOCALE == "ar":
        # dictionary leakage: EN dict values present in visible text/attrs.
        # A value only counts as a leak when at least one occurrence sits in a
        # window with no allowed brand/data marker (names, emails, brands).
        low = text.lower()
        hits = []
        for v in EN_VALS:
            if not (v.lower() in low) or allowed_en(v):
                continue
            start, clean = 0, False
            while True:
                i = low.find(v.lower(), start)
                if i < 0:
                    break
                s, e = max(0, i - 45), min(len(text), i + len(v) + 45)
                win = text[s:e].lower()
                if not any(a.lower() in win for a in ALLOW_EN_SUBSTR) and "@" not in win:
                    clean = True
                    break
                start = i + 1
            if clean:
                hits.append(v)
        findings["en_dict_hits"] = sorted(set(hits))
        # date tokens in visible text — no context filter: a locale-less
        # English month/weekday/AM-PM in an AR UI is a bug-5 candidate and
        # gets hand-reviewed (fixture-data mentions are reviewed separately)
        dt = []
        for m in DATE_TOKEN_AR.finditer(text):
            tok = m.group(0)
            if allowed_en(tok):
                continue
            if tok.lower() in ("am", "pm"):
                if re.search(rf"\d[:\s]?\d*\s*{tok}\b", text, re.I):
                    dt.append(tok)
            else:
                dt.append(tok)
        findings["date_tokens"] = sorted(set(dt))
        # sentence heuristic
        sents = []
        for m in SENT_RE.finditer(text):
            s = m.group(0).strip()
            if not allowed_en(s):
                sents.append(s[:160])
        findings["sentences"] = sorted(set(sents))[:20]
    else:
        # EN pages: Arabic residue in visible text/attrs
        ar_hits = []
        for m in AR_WORD.finditer(text):
            # capture arabic run
            start = m.start()
            end = m.end()
            while end < len(text) and AR_WORD.match(text[end]):
                end += 1
            run = text[start:end].strip()
            stripped = re.sub(r"[\u200C\u200D\u200E\u200F\uFEFF]", "", run)
            if stripped and not any(a in stripped or stripped in a for a in ALLOW_AR_ON_EN):
                ar_hits.append(run)
        findings["ar_on_en"] = sorted(set(ar_hits))[:30]
        # Arabic dict values leaking into EN pages
        ar_leak = []
        # light check: distinctive Arabic dict values (>=6 chars) present
        # (loaded lazily once)
        for v in AR_VALS:
            if v in text and re.search(r"[\u0600-\u06FF]", v) and not any(a in v for a in ALLOW_AR_ON_EN):
                ar_leak.append(v)
        findings["ar_dict_hits"] = sorted(set(ar_leak))[:30]
    return findings


# Arabic dictionary values for EN-page leak check
AR_VALS = []
try:
    ARD = json.load(open("/tmp/kid2414-ar-dict.json"))
    AR_VALS = sorted({v for v in ARD.values() if len(v) >= 6}, key=len, reverse=True)[:4000]
except Exception:
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(NoRedirect)


def fetch(path: str, cookie: str | None):
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": "kid2414-qa"})
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with _OPENER.open(req, timeout=45) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, "", body, dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace") if e.fp else ""
        loc = e.headers.get("Location", "")
        if e.code in (301, 302, 303, 307, 308) and loc.startswith("/"):
            # make absolute for the record
            pass
        return e.code, loc, body, dict(e.headers)
    except Exception as e:
        return 0, "", f"CLIENT_ERROR: {e}", {}


def main():
    tokens = json.load(open("/tmp/kid2414-cookies.json"))
    email = {"owner": "maple-owner", "admin": "maple-admin", "teacher": "maple-teacher",
             "parent": "maple-parent"}[ROLE] + "@kiddy-retest.test" if ROLE != "anon" else None
    if ROLE == "anon":
        cookie = f"kiddy_lang={LOCALE}"
    else:
        cookie = f"kiddy_sess={tokens[email]}"
    # ensure account language matches (set externally before run; verify once)
    rows = []
    for path in ROUTES:
        status, final, body, hdrs = fetch(path, cookie)
        row = {"path": path, "status": status}
        if status in (301, 302, 303, 307, 308):
            row["location"] = final or hdrs.get("Location", "")
        elif status == 200:
            row.update(scan_doc(body))
            # classify problems compactly
            probs = []
            exp_lang, exp_dir = ("ar", "rtl") if LOCALE == "ar" else ("en", "ltr")
            if row.get("lang") != exp_lang or row.get("dir") != exp_dir:
                probs.append(f"dir/lang={row.get('lang')}/{row.get('dir')}")
            if row.get("missing"):
                probs.append("MISSING:" + ",".join(row["missing"]))
            if row.get("raw_role"):
                probs.append("raw-role")
            if LOCALE == "ar":
                if row.get("en_dict_hits"):
                    probs.append(f"en-dict({len(row['en_dict_hits'])})")
                if row.get("date_tokens"):
                    probs.append("date-tokens:" + ",".join(row["date_tokens"][:8]))
                if row.get("sentences"):
                    probs.append(f"en-sentences({len(row['sentences'])})")
            else:
                if row.get("ar_on_en"):
                    probs.append(f"ar-residue({len(row['ar_on_en'])})")
                if row.get("ar_dict_hits"):
                    probs.append(f"ar-dict({len(row['ar_dict_hits'])})")
            row["problems"] = probs
        else:
            row["problems"] = [f"HTTP {status}"]
        rows.append(row)
        print(f"{status} {path} {'; '.join(row.get('problems', []))}", flush=True)
    json.dump({"role": ROLE, "locale": LOCALE, "rows": rows}, open(OUT, "w"), indent=1, ensure_ascii=False)
    nprob = sum(1 for r in rows if r.get("problems"))
    print(f"DONE {ROLE}/{LOCALE}: {len(rows)} routes, {nprob} with problems -> {OUT}")


if __name__ == "__main__":
    main()
