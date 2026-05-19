export function slugifyInstanceUrlSegment(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isProperlySlugified(value) {
  if (value == null || typeof value !== "string") {
    return true;
  }
  return value === slugifyInstanceUrlSegment(value);
}

export function instanceAliasFromSegment(segment) {
  return `instance/${segment}`;
}
