export const RESOURCE_TYPES = [
  "document",
  "stylesheet",
  "script",
  "image",
  "audio",
  "video",
  "media",
  "font",
  "fetch",
  "other",
];

export function classifyResource(type = "", mime = "") {
  mime = mime.toLowerCase().split(";")[0];
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  const types = {
    Document: "document",
    Stylesheet: "stylesheet",
    Script: "script",
    Image: "image",
    Media: "media",
    Font: "font",
    Fetch: "fetch",
    XHR: "fetch",
  };
  if (types[type]) return types[type];
  if (mime === "text/html") return "document";
  if (mime === "text/css") return "stylesheet";
  if (/javascript/.test(mime)) return "script";
  if (mime.startsWith("font/")) return "font";
  return "other";
}
