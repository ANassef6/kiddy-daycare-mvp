// KID-493: the tenant's uploaded brand image (institute.brand_image_url) tops
// every page as a responsive banner. Rendered from the branding the root
// layout already resolves — nothing renders (no wrapper, no gap, no layout
// shift) when a daycare has no image set, and the alt text names the daycare
// so screen readers announce a content image rather than "image".
export default function BrandBanner({
  src,
  name,
  alt,
}: {
  src: string | null;
  name: string;
  alt: string;
}) {
  if (!src) return null;
  return (
    <div className="brand-banner">
      {/* Minimal fetch-size image: the file lands in the public Supabase
          bucket at upload time, so <img> with max-height + cover is the
          responsive rule on every page. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt || `${name} brand image`} />
    </div>
  );
}
