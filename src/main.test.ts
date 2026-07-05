/// <reference types="@cloudflare/vitest-pool-workers" />

// @ts-expect-error This is a known issue: https://github.com/cloudflare/cloudflare-docs/issues/30069.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "./main";

const COMMIT_URL = "https://github.com/embroidery-space/embroiderly/commit/abc123def456";
const COMMIT_HASH = "abc123def456";
const BRANCH = "main";
const COMMIT_MESSAGE = "fix button alignment";
const VALID_GIT_INFO = { url: COMMIT_URL, hash: COMMIT_HASH, branch: BRANCH, message: COMMIT_MESSAGE };

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
    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: PREVIEW_URL }, "wrong-secret");
    expect(res.status).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("authenticates with the correct secret", async () => {
    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: PREVIEW_URL });
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

  it("rejects a missing gitInfo", async () => {
    const res = await post({ previewUrl: PREVIEW_URL });
    expect(res.status).toBe(400);
  });

  it("rejects a non-https gitInfo.url", async () => {
    const res = await post({ gitInfo: { ...VALID_GIT_INFO, url: "http://example.com" }, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(400);
  });

  it("rejects a missing previewUrl", async () => {
    const res = await post({ gitInfo: VALID_GIT_INFO });
    expect(res.status).toBe(400);
  });

  it("rejects a non-https previewUrl", async () => {
    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: "http://example.com" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-https aliasUrl", async () => {
    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: PREVIEW_URL, aliasUrl: "http://example.com" });
    expect(res.status).toBe(400);
  });
});

describe("publishing", () => {
  it("successfully sends a message without the Branch Preview URL", async () => {
    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(204);
    expect(mockSendMessage).toHaveBeenCalledOnce();

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain(COMMIT_URL);
    expect(text).toContain(PREVIEW_URL);
    expect(text).toContain(`${COMMIT_HASH.slice(0, 7)}@${BRANCH}`);
    expect(text).toContain(COMMIT_MESSAGE);
    expect(text).not.toContain("Branch Preview URL");
  });

  it("includes the Branch Preview URL when aliasUrl is provided", async () => {
    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: PREVIEW_URL, aliasUrl: ALIAS_URL });
    expect(res.status).toBe(204);

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain(ALIAS_URL);
    expect(text).toContain("Branch Preview URL");
  });

  it("handles Telegram errors", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("network timeout"));

    const res = await post({ gitInfo: VALID_GIT_INFO, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Upstream error");
  });
});

describe("PR linkage", () => {
  it("successfully links a PR number in parentheses at the end of the commit message", async () => {
    const gitInfo = { ...VALID_GIT_INFO, message: "update dependencies (#10)" };

    const res = await post({ gitInfo, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(204);

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain(
      'update dependencies (<a href="https://github.com/embroidery-space/embroiderly/pull/10">#10</a>)',
    );
  });

  it("does not link a PR number if it is not in parentheses", async () => {
    const gitInfo = { ...VALID_GIT_INFO, message: "update dependencies #10" };

    const res = await post({ gitInfo, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(204);

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain("update dependencies #10");
  });

  it.for(["fixes #10 in the middle of message", "update dependencies (#10) with suffix"])(
    "does not link a PR number if it is not at the end of the commit message",
    async (message) => {
      const gitInfo = { ...VALID_GIT_INFO, message };

      const res = await post({ gitInfo, previewUrl: PREVIEW_URL });
      expect(res.status).toBe(204);

      const text = mockSendMessage.mock.calls[0]![1] as string;
      expect(text).toContain(message);
    },
  );

  it("does not link the PR number if the git URL is not a GitHub URL", async () => {
    const gitInfo = {
      ...VALID_GIT_INFO,
      url: "https://gitlab.com/embroidery-space/embroiderly/commit/abc123def456",
      message: "update dependencies (#10)",
    };

    const res = await post({ gitInfo, previewUrl: PREVIEW_URL });
    expect(res.status).toBe(204);

    const text = mockSendMessage.mock.calls[0]![1] as string;
    expect(text).toContain("update dependencies (#10)");
  });
});
