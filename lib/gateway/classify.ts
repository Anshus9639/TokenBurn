import {
  messageText,
  type GatewayChatRequest,
  type TaskClassification,
  type TaskKind,
} from "./types";

/**
 * Heuristic task classifier. It inspects the system prompt and the most recent user turn for
 * intent keywords, code fences and structured-output requests. This is deliberately a rule-based
 * classifier: it is fast, deterministic and never claims benchmark-level accuracy.
 */
const KEYWORDS: Record<Exclude<TaskKind, "chat">, Array<{ pattern: RegExp; weight: number; signal: string }>> = {
  classification: [
    { pattern: /\bclassif(y|ication)\b/i, weight: 3, signal: "classify" },
    { pattern: /\bcategori[sz]e\b|\bcategory\b/i, weight: 2, signal: "category" },
    { pattern: /\bsentiment\b/i, weight: 3, signal: "sentiment" },
    { pattern: /\blabel(s|led|ling)?\b/i, weight: 2, signal: "label" },
    { pattern: /\bintent\b|\broute this\b|\btriage\b/i, weight: 2, signal: "intent" },
  ],
  extraction: [
    { pattern: /\bextract\b|\bextraction\b/i, weight: 3, signal: "extract" },
    { pattern: /\bparse\b|\bstructured\b/i, weight: 2, signal: "parse" },
    { pattern: /\breturn (valid )?json\b|\bjson only\b|\bas json\b/i, weight: 3, signal: "json output" },
    { pattern: /\bschema\b|\bfields?\b|\bkey[- ]value\b/i, weight: 1, signal: "schema" },
    { pattern: /\binvoice\b|\breceipt\b|\bform\b|\bentities\b/i, weight: 1, signal: "entities" },
  ],
  summarization: [
    { pattern: /\bsummari[sz]e\b|\bsummary\b/i, weight: 3, signal: "summarize" },
    { pattern: /\btl;?dr\b|\bcondense\b|\bshorten\b/i, weight: 3, signal: "condense" },
    { pattern: /\bkey (points|takeaways)\b|\bbullet points\b/i, weight: 2, signal: "key points" },
    { pattern: /\brecap\b|\bdigest\b/i, weight: 2, signal: "recap" },
  ],
  code: [
    { pattern: /\b(code|function|class|method|api|sdk)\b/i, weight: 2, signal: "code" },
    { pattern: /\btypescript\b|\bjavascript\b|\bpython\b|\b(sql|regex|bash|go|rust|java)\b/i, weight: 2, signal: "language" },
    { pattern: /\bdebug\b|\brefactor\b|\bunit test\b|\bcompile\b|\bstack trace\b/i, weight: 3, signal: "debug" },
    { pattern: /```/, weight: 3, signal: "code fence" },
    { pattern: /\bimplement\b|\bfix this\b|\bwrite a (script|query|component)\b/i, weight: 2, signal: "implement" },
  ],
  reasoning: [
    { pattern: /\bprove\b|\bproof\b|\bderive\b/i, weight: 3, signal: "prove" },
    { pattern: /\bstep[- ]by[- ]step\b|\bchain of thought\b|\bthink through\b/i, weight: 3, signal: "step by step" },
    { pattern: /\banaly[sz]e\b|\bwhy\b|\broot cause\b|\btrade-?offs?\b/i, weight: 2, signal: "analysis" },
    { pattern: /\bcalculate\b|\bequation\b|\bprobability\b|\bmath\b/i, weight: 2, signal: "math" },
    { pattern: /\bplan\b|\bstrategy\b|\bcompare and\b/i, weight: 1, signal: "planning" },
  ],
  translation: [
    { pattern: /\btranslate\b|\btranslation\b/i, weight: 4, signal: "translate" },
    { pattern: /\binto (english|french|spanish|german|hindi|japanese|chinese|portuguese|arabic)\b/i, weight: 3, signal: "target language" },
    { pattern: /\blocali[sz]e\b|\bbilingual\b/i, weight: 2, signal: "localize" },
  ],
  creative: [
    { pattern: /\b(write|draft) (a|an) (story|poem|email|post|essay|ad|headline|slogan)\b/i, weight: 3, signal: "draft" },
    { pattern: /\bmarketing copy\b|\bcopywriting\b|\bbrainstorm\b|\bcreative\b/i, weight: 3, signal: "marketing" },
    { pattern: /\btone\b|\bpersona\b|\bcatchy\b|\bheadline\b/i, weight: 2, signal: "tone" },
    { pattern: /\bblog\b|\bnewsletter\b|\btweet\b|\bcaption\b/i, weight: 2, signal: "content" },
  ],
};

const QUALITY_FLOORS: Record<TaskKind, number> = {
  reasoning: 82,
  code: 70,
  extraction: 62,
  summarization: 55,
  classification: 50,
  translation: 55,
  creative: 55,
  chat: 45,
};

export function classifyTask(request: GatewayChatRequest): TaskClassification {
  const systemText = request.messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => messageText(message.content))
    .join("\n");
  const userTurns = request.messages.filter((message) => message.role === "user");
  const latestUser = userTurns.length ? messageText(userTurns[userTurns.length - 1].content) : "";
  const haystack = `${systemText}\n${latestUser}`;

  const scores = new Map<TaskKind, number>();
  const signals = new Set<string>();
  for (const [kind, rules] of Object.entries(KEYWORDS) as Array<
    [Exclude<TaskKind, "chat">, (typeof KEYWORDS)[Exclude<TaskKind, "chat">]]
  >) {
    let score = 0;
    for (const rule of rules) {
      if (rule.pattern.test(haystack)) {
        score += rule.weight;
        signals.add(rule.signal);
      }
    }
    if (score > 0) scores.set(kind, score);
  }

  if (request.response_format?.type === "json_object" || request.response_format?.type === "json_schema") {
    scores.set("extraction", (scores.get("extraction") ?? 0) + 2);
    signals.add("json response format");
  }
  if (request.tools?.length) signals.add("tools");

  let kind: TaskKind = "chat";
  let best = 0;
  for (const [candidate, score] of scores) {
    if (score > best) {
      best = score;
      kind = candidate;
    }
  }

  const chars = haystack.length;
  const complexity: TaskClassification["complexity"] =
    chars > 8_000 || (kind === "reasoning" && chars > 2_000) || (kind === "code" && chars > 5_000)
      ? "high"
      : chars > 1_200
        ? "medium"
        : "low";

  const matched = [...signals].slice(0, 6);
  return {
    kind,
    complexity,
    confidence: kind === "chat" ? (chars > 0 ? 0.35 : 0.2) : Math.min(0.95, 0.45 + best * 0.1),
    signals: matched,
    minQuality: QUALITY_FLOORS[kind],
  };
}
