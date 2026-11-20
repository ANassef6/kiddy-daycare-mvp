// KID-2453: provider-agnostic storage contract. The app talks to this shape
// (through lib/storage.ts) so R2 and Supabase Storage can coexist during the
// migration window. Every provider keeps objects private; reads happen only
// through short-lived signed URLs minted after the caller's auth checks.

export type StorageProviderId = "r2" | "supabase";

export type StorageError = { message: string };

export type PutResult = {
  error: StorageError | null;
  key: string;
  ref?: string;
};

export type HeadResult = {
  size: number;
  contentType: string | null;
} | null;

export type SignedPut = {
  url: string;
  /** Headers the client MUST send; they are part of the signature. */
  headers: Record<string, string>;
  expiresIn: number;
};

export interface PrivateObjectStore {
  readonly id: StorageProviderId;
  configured(): boolean;
  put(key: string, body: BodyInit | Buffer, contentType: string): Promise<StorageError | null>;
  head(key: string): Promise<HeadResult>;
  remove(key: string): Promise<void>;
  signedGet(key: string, ttlSeconds: number): Promise<string | null>;
  signedPut(key: string, contentType: string, ttlSeconds: number): Promise<SignedPut | null>;
}
