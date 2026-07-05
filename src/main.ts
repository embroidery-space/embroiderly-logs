import { Api } from "grammy";
import { z } from "zod/mini";

const HttpsUrlSchema = z.url({ protocol: /^https$/u });

const PayloadSchema = z.object({
  gitInfo: z.object({
    url: HttpsUrlSchema,
    hash: z.string(),
    branch: z.string(),
    message: z.string(),
  }),
  previewUrl: HttpsUrlSchema,
  aliasUrl: z.optional(HttpsUrlSchema),
});
type Payload = z.infer<typeof PayloadSchema>;

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const secret = request.headers.get("x-webhook-secret") ?? "";
    if (!verifySecret(secret, env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const payload = PayloadSchema.safeParse(body);
    if (!payload.success) return new Response("Invalid payload", { status: 400 });

    const api = new Api(env.TELEGRAM_BOT_TOKEN);
    try {
      await api.sendMessage(env.TELEGRAM_CHANNEL_ID, renderMessage(payload.data), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.error("Cannot send message to Telegram:", err);
      return new Response("Upstream error", { status: 502 });
    }

    return new Response(null, { status: 204 });
  },
} satisfies ExportedHandler<Env>;

function verifySecret(provided: string, expected: string) {
  const encoder = new TextEncoder();

  const a = encoder.encode(provided);
  const b = encoder.encode(expected);

  // Do not return early when lengths differ — that leaks the secret's length through timing.
  // Instead, always perform a constant-time comparison:
  // - when the lengths match compare directly;
  // - otherwise compare the user input against itself (always true) and negate.
  const lengthsMatch = a.byteLength === b.byteLength;
  return lengthsMatch ? crypto.subtle.timingSafeEqual(a, b) : !crypto.subtle.timingSafeEqual(a, a);
}

function getPrUrl(gitUrl: string, prNumber: string): string | null {
  try {
    const url = new URL(gitUrl);
    if (url.hostname === "github.com" || url.hostname === "www.github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const [owner, repo] = parts;
        return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
      }
    }
  } catch {
    // Ignore invalid URL
  }
  return null;
}

function renderMessage(payload: Payload): string {
  const { gitInfo, previewUrl, aliasUrl } = payload;

  const lines = ["🚀 <b>New Embroiderly deployment:</b>"];

  if (aliasUrl) {
    lines.push(`<a href="${previewUrl}">Commit Preview URL</a> | <a href="${aliasUrl}">Branch Preview URL</a>`);
  } else {
    lines.push(`<a href="${previewUrl}">Preview URL</a>`);
  }

  const ref = `${gitInfo.hash.slice(0, 7)}@${gitInfo.branch}`;
  const message = gitInfo.message.replace(/\(#(\d+)\)\s*$/u, (match, prNumber) => {
    const prUrl = getPrUrl(gitInfo.url, prNumber);
    return prUrl ? `(<a href="${prUrl}">#${prNumber}</a>)` : match;
  });

  lines.push("", `<a href="${gitInfo.url}">${ref}</a> — ${message}`);

  return lines.join("\n");
}
