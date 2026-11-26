// KID-2487: newsfeed likers + tagging a post photo to children.
//
// Founder rules:
//   - the like count opens the list of who liked, for staff and parents;
//   - staff who can see the post can tag/untag children on its photo;
//   - the child profile media section shows the tagged photo without a
//     duplicated file (one stored object, one media row per child);
//   - untagging removes only the child link, never the post photo;
//   - a tag is refused server-side when the post's audience does not reach all
//     of that child's parents.

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccount } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import {
  createNewsfeedPost,
  createStaff,
  linkFamily,
  listMedia,
  listNewsfeed,
  newsfeedForChild,
  newsfeedPostVisibleToStaff,
  newsfeedTagAudienceAllowsChild,
  setNewsfeedPhotoTags,
  toggleLike,
} from "@/lib/store";
import { getDictionary } from "@/lib/i18n";
import { attachmentKind, mediaRefName } from "@/lib/media-limits";
import NewsfeedLikers from "@/components/NewsfeedLikers";
import { seedFixture, mustGet } from "../helpers";

let iid: string;
let ellaId: string;
let leoId: string;
let toddlersId: string;
let preschoolId: string;
let ownerId: string;
let parentId: string;

async function makeParent(email: string, childIds: string[]): Promise<string> {
  const account = await createAccount({
    email,
    password: "kiddy-parent",
    fullName: email.split("@")[0],
    role: "parent",
  });
  for (const childId of childIds) await linkFamily(String(account.id), childId);
  return String(account.id);
}

async function makeStaff(roomIds: string[], role = "carer"): Promise<string> {
  const email = `kid2487-staff-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const staff = await createStaff({
    instituteId: iid,
    fullName: "Room Teacher",
    role,
    roomIds,
  });
  const account = await createAccount({
    email,
    password: "kiddy-staff",
    fullName: "Room Teacher",
    role: "staff",
  });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(account.id));
  return String(account.id);
}

async function photoPost(tagChildIds: string[]): Promise<{ id: string; mediaUrl: string }> {
  const mediaUrl = `r2-private:newsfeed/${iid}/${crypto.randomUUID()}.jpg`;
  const post = await createNewsfeedPost({
    instituteId: iid,
    accountId: ownerId,
    body: "A photo from today",
    mediaUrl,
    tagChildIds,
  });
  return { id: String(post.id), mediaUrl };
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await mustGet("SELECT id FROM institute LIMIT 1")).id);
  ellaId = String((await mustGet("SELECT id FROM child WHERE first_name = 'Ella'")).id);
  leoId = String((await mustGet("SELECT id FROM child WHERE first_name = 'Leo'")).id);
  toddlersId = String((await mustGet("SELECT id FROM room WHERE name = 'Toddlers'")).id);
  preschoolId = String((await mustGet("SELECT id FROM room WHERE name = 'Preschool'")).id);
  ownerId = String((await mustGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1")).id);
  parentId = String((await mustGet("SELECT id FROM account WHERE role = 'parent' LIMIT 1")).id);
});

describe("KID-2487: who liked a post", () => {
  it("listNewsfeed and newsfeedForChild carry each liker's name and role", async () => {
    const post = await createNewsfeedPost({
      instituteId: iid,
      accountId: ownerId,
      body: "Like me",
      tagChildIds: [ellaId],
    });
    await toggleLike(String(post.id), parentId);
    await toggleLike(String(post.id), ownerId);

    const listed = await listNewsfeed(iid);
    const row = listed.find((p) => String(p.id) === String(post.id))!;
    expect(row.like_count).toBe(2);
    expect((row.likers as Array<{ full_name: string; role: string }>).map((l) => l.full_name).sort()).toEqual([
      "Grace Nguyen",
      "Nassef",
    ]);
    expect((row.likers as Array<{ role: string }>).map((l) => l.role).sort()).toEqual(["owner", "parent"]);

    const childFeed = await newsfeedForChild(ellaId, parentId);
    const childRow = childFeed.find((p) => String(p.id) === String(post.id))!;
    expect((childRow.likers as Array<{ full_name: string }>).map((l) => l.full_name).sort()).toEqual([
      "Grace Nguyen",
      "Nassef",
    ]);
  });

  it("renders a tappable like count that discloses the liker list (no JS)", () => {
    const html = renderToStaticMarkup(
      NewsfeedLikers({
        likers: [
          { id: "a1", full_name: "Grace Nguyen", role: "parent" },
          { id: "a2", full_name: "Nassef", role: "owner" },
        ],
        count: 2,
        dict: getDictionary("en"),
      })
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("2 likes");
    expect(html).toContain("Grace Nguyen");
    expect(html).toContain("Parent");
    expect(html).toContain("Nassef");
    expect(html).toContain("Owner");

    const arHtml = renderToStaticMarkup(
      NewsfeedLikers({
        likers: [{ id: "a1", full_name: "Grace Nguyen", role: "parent" }],
        count: 1,
        dict: getDictionary("ar"),
      })
    );
    expect(arHtml).toContain("1 إعجاب");
    expect(arHtml).toContain("ولي أمر");
  });
});

describe("KID-2487: post photo kind from its stored ref", () => {
  it("classifies R2 and legacy private refs from the URL's last segment", () => {
    const r2 = "r2-private:newsfeed/inst-1/0b8f0e0e-aaaa-4bbb-8ccc-1234567890ab.PNG";
    const legacy = "kiddy-private:newsfeed/inst-1/8b1c.png";
    const video = "r2-private:newsfeed/inst-1/8b1c.mp4";
    expect(mediaRefName(r2)).toBe("0b8f0e0e-aaaa-4bbb-8ccc-1234567890ab.PNG");
    expect(attachmentKind(mediaRefName(r2), r2)).toBe("image");
    expect(attachmentKind(mediaRefName(legacy), legacy)).toBe("image");
    expect(attachmentKind(mediaRefName(video), video)).toBe("video");
    const data = "data:image/png;base64,iVBORw0KGgo=";
    expect(attachmentKind(mediaRefName(data), data)).toBe("image");
  });
});

describe("KID-2487: tagging a post photo to children", () => {
  it("links the same stored object to each child without duplicating the file", async () => {
    const post = await photoPost([ellaId]);
    const result = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: post.id,
      childIds: [ellaId, leoId],
    });
    expect(result.ok).toBe(true);
    expect(result.blockedChildIds).toEqual([]);
    expect(result.taggedChildIds.sort()).toEqual([ellaId, leoId].sort());

    const rows = await queryAll("SELECT * FROM media WHERE post_id = ?", post.id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => String(r.url)))).toEqual(new Set([post.mediaUrl]));
    expect(String((await queryGet("SELECT media_url FROM newsfeed_post WHERE id = ?", post.id))!.media_url)).toBe(
      post.mediaUrl
    );

    const ellaMedia = await listMedia(iid, ellaId);
    const leoMedia = await listMedia(iid, leoId);
    expect(ellaMedia.some((m) => String(m.post_id) === post.id && String(m.url) === post.mediaUrl)).toBe(true);
    expect(leoMedia.some((m) => String(m.post_id) === post.id && String(m.url) === post.mediaUrl)).toBe(true);
  });

  it("links a tagged video to each child and keeps its kind", async () => {
    const mediaUrl = `r2-private:newsfeed/${iid}/${crypto.randomUUID()}.mp4`;
    const post = await createNewsfeedPost({
      instituteId: iid,
      accountId: ownerId,
      body: "A clip from today",
      mediaUrl,
      tagChildIds: [ellaId],
    });
    const result = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: String(post.id),
      childIds: [ellaId, leoId],
    });
    expect(result.ok).toBe(true);
    const rows = await queryAll("SELECT child_id, url, kind FROM media WHERE post_id = ?", post.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => String(r.url) === mediaUrl)).toBe(true);
    expect(rows.every((r) => String(r.kind) === "video")).toBe(true);
    const leoMedia = await listMedia(iid, leoId);
    expect(leoMedia.some((m) => String(m.post_id) === String(post.id) && String(m.kind) === "video")).toBe(true);
  });

  it("untags only the selected child link and keeps the post photo", async () => {
    const post = await photoPost([ellaId]);
    await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: post.id,
      childIds: [ellaId, leoId],
    });
    const result = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: post.id,
      childIds: [ellaId],
    });
    expect(result.ok).toBe(true);
    const rows = await queryAll("SELECT child_id FROM media WHERE post_id = ?", post.id);
    expect(rows.map((r) => String(r.child_id))).toEqual([ellaId]);
    const stored = await queryGet("SELECT media_url FROM newsfeed_post WHERE id = ?", post.id);
    expect(String(stored!.media_url)).toBe(post.mediaUrl);
  });

  it("refuses a tag when the post audience does not reach the child's parents", async () => {
    // A parent linked only to Leo — outside a post tagged only to Ella.
    await makeParent("leo-only@example.test", [leoId]);
    const post = await photoPost([ellaId]);

    expect(await newsfeedTagAudienceAllowsChild(post.id, leoId)).toBe(false);
    expect(await newsfeedTagAudienceAllowsChild(post.id, ellaId)).toBe(true);

    const result = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: post.id,
      childIds: [ellaId, leoId],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("audience");
    expect(result.blockedChildIds).toEqual([leoId]);
    expect(result.taggedChildIds).toEqual([ellaId]);
    const rows = await queryAll("SELECT child_id FROM media WHERE post_id = ?", post.id);
    expect(rows.map((r) => String(r.child_id))).toEqual([ellaId]);
  });

  it("allows a center-wide post because every parent is already in its audience", async () => {
    await makeParent("leo-only@example.test", [leoId]);
    const post = await photoPost([]);
    const result = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: post.id,
      childIds: [leoId],
    });
    expect(result.ok).toBe(true);
    expect(result.blockedChildIds).toEqual([]);
  });

  it("mirrors KID-2480: assigned room staff manage only their own classroom's post", async () => {
    const toddlerStaff = await makeStaff([toddlersId]);
    const ellaPost = await photoPost([ellaId]);
    const leoPost = await photoPost([leoId]);

    expect(await newsfeedPostVisibleToStaff(iid, toddlerStaff, "staff", ellaPost.id)).toBe(true);
    expect(await newsfeedPostVisibleToStaff(iid, toddlerStaff, "staff", leoPost.id)).toBe(false);

    const allowed = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: toddlerStaff,
      role: "staff",
      postId: ellaPost.id,
      childIds: [ellaId],
    });
    expect(allowed.ok).toBe(true);

    const refused = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: toddlerStaff,
      role: "staff",
      postId: leoPost.id,
      childIds: [leoId],
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("forbidden");
    expect(await queryAll("SELECT id FROM media WHERE post_id = ?", leoPost.id)).toHaveLength(0);
  });

  it("keeps another classroom's existing tag when a scoped teacher saves", async () => {
    const post = await photoPost([ellaId]);
    // Grace is a parent of both children, so the post audience reaches Leo too.
    await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: ownerId,
      role: "owner",
      postId: post.id,
      childIds: [ellaId, leoId],
    });
    const toddlerStaff = await makeStaff([toddlersId]);
    const saved = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: toddlerStaff,
      role: "staff",
      postId: post.id,
      childIds: [ellaId, leoId],
    });
    expect(saved.ok).toBe(true);
    // Unchecking the other classroom's child must not delete that link either.
    const afterUntick = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: toddlerStaff,
      role: "staff",
      postId: post.id,
      childIds: [ellaId],
    });
    expect(afterUntick.ok).toBe(true);
    const rows = await queryAll("SELECT child_id FROM media WHERE post_id = ? ORDER BY child_id", post.id);
    expect(rows.map((r) => String(r.child_id)).sort()).toEqual([ellaId, leoId].sort());
  });

  it("refuses a child outside the staff member's classroom even on a visible post", async () => {
    const toddlerStaff = await makeStaff([toddlersId]);
    const post = await photoPost([ellaId]);
    const result = await setNewsfeedPhotoTags({
      instituteId: iid,
      accountId: toddlerStaff,
      role: "staff",
      postId: post.id,
      childIds: [leoId],
    });
    expect(result.ok).toBe(false);
    expect(result.blockedChildIds).toEqual([leoId]);
    expect(await queryAll("SELECT id FROM media WHERE post_id = ?", post.id)).toHaveLength(0);
  });
});
