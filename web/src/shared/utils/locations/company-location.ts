const administrativeDetailPattern =
  /(?:district\b|city\s+center\b|ward\b|commune\b|township\b|quận|huyện|phường|xã|thị\s+xã)/iu;
const countryPattern = /^(?:vietnam|việt\s+nam)$/iu;

/**
 * Project a free-form company address to the province/city level used by the
 * Candidate Company directory. Company addresses are stored as text, so the
 * last segment is the region for the supported `district, city` format. The
 * detail-first format (`city, district`) is handled as a safe fallback.
 */
export function companyLocationRegion(
  value: string | null | undefined,
): string | null {
  const segments = (value ?? "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return null;

  let region = segments.at(-1) ?? "";
  if (countryPattern.test(region) && segments.length > 1) {
    region = segments.at(-2) ?? region;
  }
  if (administrativeDetailPattern.test(region) && segments.length > 1) {
    region = segments.at(-2) ?? region;
  }
  return region || null;
}

export function companyLocationRegions(
  values: readonly (string | null | undefined)[],
): string[] {
  return [
    ...new Set(
      values
        .map(companyLocationRegion)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function normalizeLocationKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/đ/gu, "d")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** Search variants for public province/city text stored in legacy formats. */
export function companyLocationSearchTerms(value: string | null | undefined) {
  const region = companyLocationRegion(value);
  if (!region) return [];
  const key = normalizeLocationKey(region);
  const known: Record<string, string[]> = {
    danang: ["Da Nang", "Đà Nẵng", "danang"],
    hochiminhcity: ["Ho Chi Minh City", "Hồ Chí Minh", "hochiminhcity"],
    hochiminh: ["Ho Chi Minh City", "Hồ Chí Minh", "hochiminh"],
    hanoi: ["Hanoi", "Hà Nội", "hanoi"],
  };
  return known[key] ?? [region];
}
