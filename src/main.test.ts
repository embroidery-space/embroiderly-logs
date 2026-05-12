/// <reference types="@cloudflare/vitest-pool-workers" />

// @ts-expect-error This is a known issue: https://github.com/cloudflare/cloudflare-docs/issues/30069.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "./main";

const COMMIT_URL = "https://github.com/embroidery-space/embroiderly/commit/abc123";
const PREVIEW_URL = "https://abc123-embroiderly.nazarantoniuk18.workers.dev";
const ALIAS_URL = "https://main-embroiderly.nazarantoniuk18.workers.dev";

async function post(body: unknown, secret = "test-secret"): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://worker.example/", {
      method: "POST",
      headers: { "x-webhook-secret": secret, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue({}),
}));
vi.mock("grammy", () => ({
  Api: class {
    sendMessage = mockSendMessage;
  },
}));
beforeEach(() => mockSendMessage.mockClear());

describe("routing", () => {
  it("rejects unknown paths", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://worker.example/health"), env as Env, ctx);
    expect(res.status).toBe(404);
  });

  it("rejects non-POST methods", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://worker.example/"), env as Env, ctx);
    expect(res.status).toBe(405);
  });
});

describe("authentication", () => {
  it("rejects a missing secret", async () => {
    const ctx = createExecutionContext();

    const res = await worker.fetch(new Request("https://worker.example/", { method: "POST" }), env as Env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const res = await post({ commitUrl: COMMIT_URL, previewUrl: PREVIEW_URL }, "wrong-secret");
    expect(res.status).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("authenticates with the correct secret", async () => {
    const res = await post({ commitUrl: COMMIT_URL, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(204);
    expect(mockSendMessage).toHaveBeenCalled();
  });
});

describe("payload validation", () => {
  it("rejects malformed JSON", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://worker.example/", {
        method: "POST",
        headers: { "x-webhook-secret": "test-secret" },
        body: "not json",
      }),
      env as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("rejects a missing commitUrl", async () => {
    const res = await post({ previewUrl: PREVIEW_URL });
    expect(res.status).toBe(400);
  });

  it("rejects a missing previewUrl", async () => {
    const res = await post({ commitUrl: COMMIT_URL });
    expect(res.status).toBe(400);
  });

  it("rejects a non-https commitUrl", async () => {
    const res = await post({ commitUrl: "http://example.com", previewUrl: PREVIEW_URL });
    expect(res.status).toBe(400);
  });

  it("rejects a non-https previewUrl", async () => {
    const res = await post({ commitUrl: COMMIT_URL, previewUrl: "http://example.com" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-https aliasUrl", async () => {
    const res = await post({ commitUrl: COMMIT_URL, previewUrl: PREVIEW_URL, aliasUrl: "http://example.com" });
    expect(res.status).toBe(400);
  });
});

describe("publishing", () => {
  it("sucessfully sends a message without the Branch Preview URL", async () => {
    const res = await post({ commitUrl: COMMIT_URL, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(204);
    expect(mockSendMessage).toHaveBeenCalledOnce();

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain(COMMIT_URL);
    expect(text).toContain(PREVIEW_URL);
    expect(text).not.toContain("Branch Preview URL");
  });

  it("includes the Branch Preview URL when aliasUrl is provided", async () => {
    const res = await post({ commitUrl: COMMIT_URL, previewUrl: PREVIEW_URL, aliasUrl: ALIAS_URL });
    expect(res.status).toBe(204);

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain(ALIAS_URL);
    expect(text).toContain("Branch Preview URL");
  });

  it("handles Telegram errors", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("network timeout"));

    const res = await post({ commitUrl: COMMIT_URL, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Upstream error");
  });
});
