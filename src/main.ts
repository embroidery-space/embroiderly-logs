import { Api } from "grammy";

interface Payload {
  commitUrl: string;
  previewUrl: string;
  aliasUrl: string | undefined;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const secret = request.headers.get("x-webhook-secret") ?? "";
    if (verifySecret(secret, env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const payload = parsePayload(body);
    if (!payload) return new Response("Invalid payload", { status: 400 });

    const api = new Api(env.TELEGRAM_BOT_TOKEN);
    try {
      await api.sendMessage(env.TELEGRAM_CHANNEL_ID, renderMessage(payload), {
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
  return crypto.subtle.timingSafeEqual(a, b);
}

function parsePayload(body: unknown): Payload | null {
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  function isHttpsUrl(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("https://");
  }

  if (typeof body !== "object" || body === null) return null;

  const b = body as Record<string, unknown>;
  if (!isHttpsUrl(b["commitUrl"]) || !isHttpsUrl(b["previewUrl"])) return null;
  if ("aliasUrl" in b && !isHttpsUrl(b["aliasUrl"])) return null;

  return {
    commitUrl: b["commitUrl"],
    previewUrl: b["previewUrl"],
    aliasUrl: "aliasUrl" in b ? (b["aliasUrl"] as string) : undefined,
  };
}

function renderMessage(payload: Payload): string {
  const { commitUrl, previewUrl, aliasUrl } = payload;

  const lines = ["🚀 <b>New Embroiderly deployment:</b>"];

  if (aliasUrl) {
    lines.push(`<a href="${previewUrl}">Commit Preview URL</a> | <a href="${aliasUrl}">Branch Preview URL</a>`);
  } else {
    lines.push(`<a href="${previewUrl}">Preview URL</a>`);
  }

  lines.push("", `Latest commit: ${commitUrl}.`);

  return lines.join("\n");
}
