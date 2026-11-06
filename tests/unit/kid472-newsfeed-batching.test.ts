// KID-472: listNewsfeed used to run one tags query + one comments query PER
// post (N+1). The batched implementation must keep the exact per-post payload
// shape while pinning the query count: with N posts there is exactly one
// batched tags query and one batched comments query, no matter how large N
// grows. Real queries run through the module-mock wrapper; only counting is
// intercepted, so this doubles as a behavioral regression net for tags and
// comment grouping/ordering.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    queryAll: vi.fn((sql: string, ...args: unknown[]) => actual.queryAll(sql, ...args)),
  };
});

import * as store from "@/lib/store";
import { queryAll, queryGet } from "@/lib/db";
import { createAccount } from "@/lib/auth";
import { seedFixture } from "../helpers";

const queryAllMock = queryAll as unknown as ReturnType<typeof vi.fn>;
const countSql = (needle: string) => queryAllMock.mock.calls.filter(([sql]) => String(sql).includes(needle)).length;

let iid: string;

beforeEach(async () => {
  await seedFixture();
  queryAllMock.mockClear();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

describe("listNewsfeed batched tags + comments (KID-472)", () => {
  it("tags/comment lookups do not scale with post count", async () => {
    const poster = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
    const children = (
      await queryAll("SELECT id FROM child WHERE institute_id = ? LIMIT 2", iid)
    ).map((r) => String(r.id));

    const posts = [];
    for (let i = 0; i < 5; i++) {
      posts.push(
        await store.createNewsfeedPost({
          instituteId: iid,
          accountId: poster,
          body: `post ${i}`,
          tagChildIds: i % 2 === 0 ? [children[0]] : [],
        })
      );
      for (let c = 0; c <= i; c++) {
        await store.addComment(String(posts[i].id), poster, `comment ${c} on ${i}`);
      }
    }

    // reset so fixture/setup queries do not pollute the count
    queryAllMock.mockClear();
    const all = await store.listNewsfeed(iid);
    const createdIds = new Set(posts.map((p) => String(p.id)));
    const results = all.filter((r) => createdIds.has(String(r.id)));
    expect(new Set(results.map((r) => String(r.id)))).toEqual(createdIds);
    // two fixed batched queries, NOT 2*5 per-post queries
    expect(countSql("FROM newsfeed_tag t JOIN child c")).toBe(1);
    expect(countSql("FROM newsfeed_comment c JOIN account a")).toBe(1);
  });

  it("tags and comments stay grouped and ordered exactly like the N+1 output", async () => {
    const poster = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
    const children = (
      await queryAll("SELECT id FROM child WHERE institute_id = ? LIMIT 3", iid)
    ).map((r) => String(r.id));
    const [a, b] = children;

    const tagged = await store.createNewsfeedPost({
      instituteId: iid,
      accountId: poster,
      body: "tagged post",
      tagChildIds: [a, b],
    });
    await store.addComment(String(tagged.id), poster, "first");
    await store.addComment(String(tagged.id), poster, "second");
    const untagged = await store.createNewsfeedPost({
      instituteId: iid,
      accountId: poster,
      body: "untagged post",
    });

    const results = await store.listNewsfeed(iid);
    const byId = new Map(results.map((r) => [String(r.id), r]));

    const taggedRow = byId.get(String(tagged.id))!;
    const tagIds = (taggedRow.tags as Array<{ id: string }>).map((t) => String(t.id));
    expect(tagIds.sort()).toEqual([String(a), String(b)].sort());
    expect((taggedRow.comments as Array<{ full_name?: string; body: string }>).map((c) => c.body)).toEqual([
      "first",
      "second",
    ]);
    expect((taggedRow.comments as Array<{ full_name?: string }>)[0].full_name).toBe("Maria Lopez");

    const untaggedRow = byId.get(String(untagged.id))!;
    expect((untaggedRow.tags as unknown[]).length).toBe(0);
    expect((untaggedRow.comments as unknown[]).length).toBe(0);
  });
});
