// KID-2478 + KID-2477: the per-daycare Settings → Bulk upload tab renders
// the card in both locales, with the two template downloads and upload forms.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: () => ({ get: (key: string) => h.headers[key.toLowerCase()] ?? null }),
  cookies: () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import DaycareBulkUploadPage from "@/app/platform/daycares/[id]/settings/bulk-upload/page";
import { createSessionToken, sessionCookieHeader } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let operatorId: string;

beforeEach(async () => {
  await seedFixture();
  const operator = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
  operatorId = String(operator!.id);
  const cookie = sessionCookieHeader({
    accountId: operatorId,
    role: "platform",
    email: "superadmin@kiddy.test",
    emailConfirmed: true,
  })["Set-Cookie"].split(";")[0];
  h.headers = { cookie };
});

async function renderBulkUpload() {
  const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  return renderToStaticMarkup(
    await DaycareBulkUploadPage({
      params: Promise.resolve({ id: iid }),
      searchParams: Promise.resolve({}),
    })
  );
}

describe("KID-2478 Settings → Bulk upload card", () => {
  it("renders both approved template downloads and both upload forms in English", async () => {
    const html = await renderBulkUpload();
    expect(html).toContain("Bulk upload");
    expect(html).toContain("/api/platform/bulk-upload/template/children");
    expect(html).toContain("/api/platform/bulk-upload/template/staff");
    expect(html).toContain("Upload children");
    expect(html).toContain("Upload staff");
    expect(html).toContain('type="file"');
    expect(html).toContain("Children template (.xlsx)");
  });

  it("renders the Arabic card when the operator account is Arabic", async () => {
    await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", operatorId);
    const html = await renderBulkUpload();
    expect(html).toContain("الرفع المجمّع");
    expect(html).toContain("قالب الأطفال (.xlsx)");
    expect(html).toContain("رفع الأطفال");
    expect(html).toContain("رفع الموظفين");
  });

  it("shows the localized size error banner for ?error=size", async () => {
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    const html = renderToStaticMarkup(
      await DaycareBulkUploadPage({
        params: Promise.resolve({ id: iid }),
        searchParams: Promise.resolve({ error: "size" }),
      })
    );
    expect(html).toContain("The file is larger than 5 MB.");
  });
});
