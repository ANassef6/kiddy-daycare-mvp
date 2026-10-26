// Public marketing-site identity.
//
// The marketing site is always branded "Kiddy" — it must never inherit the
// seeded demo daycare's white-label name ("Sunshine Daycare"). The portal
// remains white-label per daycare; this constant is for the public pages only.
export const SITE_BRAND = "Kiddy";

// Primary market: Egyptian daycares first (founder, 2026-09-17).
export const SITE_MARKET = "Egyptian daycares";

export const SITE_TAGLINE = `Childcare management software for ${SITE_MARKET}`;

// KID-238: the platform's public contact/demo inbox. The literal below is the
// built-in default and must appear exactly once in the codebase — every
// surface (the /contact page, the site footer, the disabled-daycare message,
// and the new-inquiry notification) renders this constant, and a deployment
// can point it at another address with PLATFORM_CONTACT_EMAIL.
export const PLATFORM_CONTACT_EMAIL =
  process.env.PLATFORM_CONTACT_EMAIL?.trim() || "info@kiddyapp.net";
