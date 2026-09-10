export function normalizePath(value) {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "").toUpperCase();
}

export function title(value) {
  const normalized = normalizePath(value);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function stem(value) {
  const name = title(value);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function replaceExtension(value, extension) {
  const path = normalizePath(value);
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return (dot > slash ? path.slice(0, dot) : path) + extension.toUpperCase();
}

export function safeStem(value) {
  return stem(value).replace(/[^A-Z0-9_]/g, "_").slice(0, 24) || "EVOTRACK";
}
