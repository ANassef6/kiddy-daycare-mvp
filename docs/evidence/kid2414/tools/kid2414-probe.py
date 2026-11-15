#!/usr/bin/env python3
"""KID-2414 deterministic server-error probes (KID-2402 check-4 battery)."""
import json, re, sys, urllib.request, urllib.error, urllib.parse
import sqlite3

BASE = "http://127.0.0.1:4124"
DB = "/var/tmp/kid2414-qa/data/retest-fixture.db"
_IDS = json.load(open("/tmp/kid2414-ids.json"))
CHILD = _IDS["child"]
ROOM = _IDS["room"]
LINK_STAFF = None  # filled after insert

STR = {
  "form-title": {"en": "Add a title before creating the form.", "ar": "أضف عنوانًا قبل إنشاء النموذج."},
  "incident-desc": {"en": "Add a description before logging the incident.", "ar": "أضف وصفًا قبل تسجيل الحادث."},
  "guardian": {"en": "A parent/guardian (name, relationship, and a phone or email) is required before a child can be added.",
               "ar": "ولي الأمر (الاسم وصلة القرابة ورقم هاتف أو بريد) مطلوب قبل إضافة الطفل."},
  "paymentlink": {"en": "The payment link must be a valid http or https URL. The invoice was not created.",
                  "ar": "يجب أن يكون رابط الدفع عنوان http أو https صالحًا. لم تُنشأ الفاتورة."},
  "link-password": {"en": "Set a password of at least 8 characters.", "ar": "حدد كلمة مرور من 8 أحرف على الأقل."},
}

def tokens():
    return json.load(open("/tmp/kid2414-cookies.json"))

def req(method, path, cookie, data=None, action=None):
    url = BASE + path
    headers = {"User-Agent": "kid2414-qa", "Cookie": cookie}
    body = None
    if data is not None:
        boundary = "----kidqa"
        parts = []
        if action:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_{action}"\r\n\r\n\r\n')
        for k, v in data.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n')
        parts.append(f'--{boundary}--\r\n')
        body = "".join(parts).encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    class NoRedir(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    opener = urllib.request.build_opener(NoRedir)
    try:
        with opener.open(r, timeout=45) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), (e.read().decode("utf-8", "replace") if e.fp else "")

def counts():
    db = sqlite3.connect(DB)
    q = lambda s: db.execute(s).fetchone()[0]
    out = {
        "forms": q("SELECT COUNT(*) FROM form_template"),
        "incidents": q("SELECT COUNT(*) FROM incident_report"),
        "children": q("SELECT COUNT(*) FROM child"),
        "billing": q("SELECT COUNT(*) FROM child_billing"),
        "accounts": q("SELECT COUNT(*) FROM account"),
        "staff": q("SELECT COUNT(*) FROM staff"),
    }
    db.close()
    return out

def set_lang(email, lang):
    db = sqlite3.connect(DB)
    db.execute("UPDATE account SET language=? WHERE email=?", (lang, email))
    db.commit(); db.close()

def ensure_linkless_staff():
    """Insert a login-less staff row for the linkStaffLogin probe (mirrors the
    KID-2402 fixture shape). Returns its id."""
    global LINK_STAFF
    db = sqlite3.connect(DB)
    row = db.execute("SELECT id FROM staff WHERE email='probe-linkless@kiddy-retest.test'").fetchone()
    if row:
        LINK_STAFF = row[0]
    else:
        import uuid
        sid = "probe" + uuid.uuid4().hex[:12]
        db.execute(
            "INSERT INTO staff (id, institute_id, full_name, role, email, active, created_at) VALUES (?,?,?,?,?,1,datetime('now'))",
            (sid, _IDS["institute"], "Probe Linkless", "teacher", "probe-linkless@kiddy-retest.test"),
        )
        db.commit()
        LINK_STAFF = sid
    db.close()
    return LINK_STAFF

def main():
    tok = tokens()
    owner = "maple-owner@kiddy-retest.test"
    ensure_linkless_staff()
    results = []
    c0 = counts()

    def probe(name, method, path, action, fields, expect_loc, expect_key, dbkey):
        before = counts()[dbkey]
        status, hdrs, body = req(method, path, f"kiddy_sess={tok[owner]}", fields, action)
        loc = hdrs.get("Location", "")
        ok_status = status in (303, 302, 307, 308)
        ok_loc = expect_loc in loc
        # follow redirect target for banner
        banner_txt, banner_ok = "", False
        if ok_loc:
            g_status, _, g_body = req("GET", loc if loc.startswith("/") else "/", f"kiddy_sess={tok[owner]}")
            banner_txt = g_body
            banner_ok = STR[expect_key][LANG] in _visible(g_body)
        after = counts()[dbkey]
        row = {
            "probe": name, "locale": LANG, "post_status": status, "location": loc,
            "status_ok": ok_status, "loc_ok": ok_loc, "banner_ok": banner_ok,
            "db_unchanged": after == before, "db_before": before, "db_after": after,
        }
        if not banner_ok:
            # keep a snippet for debugging
            row["banner_contains_key_string"] = STR[expect_key][LANG][:30] in banner_txt
        results.append(row)
        print(f"{LANG} {name}: POST {status} loc={loc!r} banner_ok={banner_ok} db_ok={after==before}", flush=True)

    from html.parser import HTMLParser
    class V(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True); self.parts=[]; self.skip=0
        def handle_starttag(self, t, a):
            if t in ("script","style","head"): self.skip += 1
        def handle_endtag(self, t):
            if t in ("script","style","head") and self.skip: self.skip -= 1
        def handle_data(self, d):
            if not self.skip: self.parts.append(d)
    def _visible(html):
        p = V(); p.feed(html); return " ".join(p.parts)

    for LANG_ in ("ar", "en"):
        globals()["LANG"] = LANG_
        set_lang(owner, LANG_)
        # refresh action ids (build-stable, but re-extract to be safe)
        _, _, forms_html = req("GET", "/portal/forms", f"kiddy_sess={tok[owner]}")
        a_forms = re.search(r'\$ACTION_ID_([a-f0-9]+)', forms_html).group(1)
        _, _, ch_html = req("GET", f"/portal/children/{CHILD}?tab=incident", f"kiddy_sess={tok[owner]}")
        # incident form = the one whose form block has description input
        a_inc = None
        for m in re.finditer(r'<form[^>]*>', ch_html):
            seg = ch_html[m.start():m.start()+900]
            if 'name="description"' in seg and 'childId' in seg:
                a_inc = re.search(r'\$ACTION_ID_([a-f0-9]+)', seg).group(1); break
        _, _, children_html = req("GET", "/portal/children", f"kiddy_sess={tok[owner]}")
        a_child = None
        for m in re.finditer(r'<form[^>]*>', children_html):
            seg = children_html[m.start():m.start()+900]
            if 'name="firstName"' in seg:
                a_child = re.search(r'\$ACTION_ID_([a-f0-9]+)', seg).group(1); break
        _, _, bill_html = req("GET", f"/portal/children/{CHILD}/billing", f"kiddy_sess={tok[owner]}")
        a_bill = None
        for m in re.finditer(r'<form[^>]*>', bill_html):
            seg = bill_html[m.start():m.start()+3000]
            if 'name="paymentLink"' in seg:
                a_bill = re.search(r'\$ACTION_ID_([a-f0-9]+)', seg).group(1); break
        _, _, staff_html = req("GET", f"/portal/staff/{LINK_STAFF}", f"kiddy_sess={tok[owner]}")
        a_link = None
        pw_pos = staff_html.find('name="password"')
        if pw_pos > 0:
            form_start = staff_html.rfind('<form', 0, pw_pos)
            seg = staff_html[form_start:pw_pos + 500]
            m_id = re.search(r'\$ACTION_ID_([a-f0-9]+)', seg)
            if m_id and 'name="staffId"' in seg:
                a_link = m_id.group(1)

        assert a_forms and a_inc and a_child and a_bill and a_link, (a_forms, a_inc, a_child, a_bill, a_link)

        probe("bug7a-forms-empty-title", "POST", "/portal/forms", a_forms,
              {"title": "", "kind": "form"}, "error=form-title", "form-title", "forms")
        probe("bug7b-incident-empty-desc", "POST", f"/portal/children/{CHILD}?tab=incident", a_inc,
              {"childId": CHILD, "type": "incident", "description": ""},
              "error=incident-description", "incident-desc", "incidents")
        probe("reg-children-missing-guardian", "POST", "/portal/children", a_child,
              {"firstName": "QAProbe", "lastName": "Row", "dob": "2022-01-01", "roomId": ROOM, "allergies": ""},
              "error=guardian", "guardian", "children")
        probe("reg-billing-invalid-paymentlink", "POST", f"/portal/children/{CHILD}/billing", a_bill,
              {"childId": CHILD, "description": "QA probe invoice", "amountCents": "500",
               "period": "", "dueDate": "", "currency": "USD", "status": "pending",
               "paymentLink": "not-a-url"},
              "error=paymentlink", "paymentlink", "billing")
        probe("reg-staff-link-short-password", "POST", f"/portal/staff/{LINK_STAFF}", a_link,
              {"staffId": LINK_STAFF, "email": "probe-linkless@kiddy-retest.test", "password": "abc"},
              "error=password", "link-password", "accounts")

    set_lang(owner, "en")
    out = {"results": results, "counts_start": c0, "counts_end": counts()}
    json.dump(out, open("/tmp/kid2414-scans/probes.json", "w"), indent=1, ensure_ascii=False)
    fails = [r for r in results if not (r["status_ok"] and r["loc_ok"] and r["banner_ok"] and r["db_unchanged"])]
    print(f"PROBES: {len(results)} run, {len(fails)} failed")
    sys.exit(1 if fails else 0)

main()
