export const ADAPTATION_RULE_IDS = [9001, 9002, 9003, 9004];

export function translatePlan(plan) {
  if (plan.mode === "normal" || plan.tabId === null) return [];
  if (
    !["economy", "restricted"].includes(plan.mode) ||
    !Number.isInteger(plan.tabId) ||
    plan.tabId < 0
  )
    throw new Error("Plano de adaptação inválido.");
  const rule = (id, condition) => ({
    id,
    priority: 1,
    action: { type: "block" },
    condition: { tabIds: [plan.tabId], ...condition },
  });
  const rules = [
    rule(9001, { resourceTypes: ["media"] }),
    // Covers common media URLs fetched through Fetch/XHR without blocking generic APIs.
    rule(9002, {
      resourceTypes: ["xmlhttprequest", "other"],
      regexFilter:
        "^https?://[^/?#]+/[^?#]*\\.(mp4|webm|m4v|mov|mp3|wav|ogg|oga|opus|aac|m4a|m3u8|mpd|m4s)([?]|$)",
      isUrlFilterCaseSensitive: false,
    }),
  ];
  if (plan.mode === "restricted")
    rules.push(
      rule(9003, { resourceTypes: ["image"] }),
      rule(9004, {
        resourceTypes: ["xmlhttprequest", "other"],
        regexFilter:
          "^https?://[^/?#]+/[^?#]*\\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)([?]|$)",
        isUrlFilterCaseSensitive: false,
      }),
    );
  return rules;
}
