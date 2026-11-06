// KID-472: instant loading boundary for the staff portal newsfeed (see
// components/NewsfeedSkeleton.tsx for why this is static and language-neutral).
import { NewsfeedSkeleton } from "@/components/NewsfeedSkeleton";

export default function PortalNewsfeedLoading() {
  return <NewsfeedSkeleton />;
}
