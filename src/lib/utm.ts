export type UTM = Partial<{
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  gclid: string;
  fbclid: string;
}>;

export function getUtmFromLocation(): UTM | null {
  const params = new URLSearchParams(window.location.search);
  const keys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ] as const;

  const utm: UTM = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }

  return Object.keys(utm).length ? utm : null;
}
