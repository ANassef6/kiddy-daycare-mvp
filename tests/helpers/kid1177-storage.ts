// KID-1177: service-key storage stand-in for tests of flows that now upload
// into kiddy-private and mint signed URLs. The helper keeps its state as a
// module singleton, so vi.mock("@/lib/storage", ...) can import it lazily
// inside the factory (no hoisting games) and the test file can import the
// same singleton for assertions.
//
// The public shape mirrors lib/storage.ts: uploads/removes are recorded,
// signed URLs (single + batch) are deterministic, and the resolution helpers
// (isPrivateRef/privateRefPath/storageSrcFor/signedURLs…) keep the real
// semantics so pages exercise exactly the production path.

export const PREFIX = "kiddy-private:";

export const storage1177 = {
  uploads: [] as Array<{ bucket: string; path: string; body: unknown }>,
  removed: [] as Array<{ bucket: string; path: string }>,
  count: 0,
  uploadError: null as { message: string } | null,
  downloadBodies: new Map<string, string>(),
};

function resetStorage1177(): void {
  storage1177.uploads = [];
  storage1177.removed = [];
  storage1177.count = 0;
  storage1177.uploadError = null;
  storage1177.downloadBodies = new Map();
}

function storage1177Client() {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown) => {
          if (storage1177.uploadError) return { error: storage1177.uploadError };
          storage1177.uploads.push({ bucket, path, body });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) storage1177.removed.push({ bucket, path });
          return { error: null };
        },
        download: async (path: string) => ({
          data: new Blob([storage1177.downloadBodies.get(path) ?? "placeholder"], {
            type: "application/octet-stream",
          }),
          error: null,
        }),
        createSignedUrl: async (path: string) => {
          storage1177.count += 1;
          return {
            data: { signedUrl: `https://storage.test/storage/v1/object/sign/${bucket}/${path}?token=signed-${storage1177.count}` },
            error: null,
          };
        },
        createSignedUrls: async (paths: string[]) => {
          const data = paths.map((path) => {
            storage1177.count += 1;
            return {
              signedUrl: `https://storage.test/storage/v1/object/sign/${bucket}/${path}?token=signed-${storage1177.count}`,
            };
          });
          return { data, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
      }),
    },
  };
}

async function signedUrlForRef(ref: string, ttl = 3600): Promise<string | null> {
  void ttl;
  if (typeof ref !== "string" || !ref.startsWith(PREFIX)) return null;
  const got = await storage1177Client().storage.from("kiddy-private").createSignedUrl(ref.slice(PREFIX.length));
  return got.data?.signedUrl ?? null;
}

async function storageSrcFor(stored: string | null | undefined, ttl = 3600): Promise<string | null> {
  const value = stored ? String(stored) : "";
  if (!value) return null;
  if (value.startsWith(PREFIX)) return signedUrlForRef(value, ttl);
  return value;
}

async function signedUrlsForRefs(refs: string[], ttl = 3600): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const privateRefs = refs.filter((r) => typeof r === "string" && r.startsWith(PREFIX));
  const { data } = await storage1177Client()
    .storage.from("kiddy-private")
    .createSignedUrls(privateRefs.map((r) => r.slice(PREFIX.length)));
  (data ?? []).forEach((row, i) => out.set(privateRefs[i]!, row.signedUrl));
  for (const ref of refs) {
    if (typeof ref !== "string" || !ref.startsWith(PREFIX)) out.set(ref, ref || null);
  }
  return out;
}

export const kid1177StorageMock = {
  storageAdminConfigured: () => true,
  getStorageAdmin: storage1177Client,
  PRIVATE_BUCKET: "kiddy-private",
  PUBLIC_BUCKET: "kiddy-public",
  PRIVATE_REF_PREFIX: PREFIX,
  privateRef: (path: string) => `${PREFIX}${path}`,
  publicUrl: async (path: string) => `https://storage.test/kiddy-public/${path}`,
  uploadPrivateObject: async (path: string, body: unknown) => {
    const { error } = await storage1177Client().storage.from("kiddy-private").upload(path, body);
    return { error, path };
  },
  isPrivateRef: (value: unknown) => typeof value === "string" && value.startsWith(PREFIX),
  privateRefPath: (value: string) => value.slice(PREFIX.length),
  SIGNED_URL_TTL_SECONDS: 3600,
  signedUrlForRef,
  storageSrcFor,
  signedUrlsForRefs,
  resetFn: resetStorage1177,
} as const;

// vi.mock("@/lib/storage", ...) with a `reset` escape hatch — no-op field so
// the mock object can also spread resetFn safely.
void storage1177;
