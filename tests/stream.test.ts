import { describe, expect, it } from "vitest";
import {
  customerBaseFrom,
  handleStream,
  isStreamPath,
  playbackUrls,
  type StreamEnv,
} from "../src/stream";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

describe("stream path routing", () => {
  it("matches create, status, and playback", () => {
    expect(isStreamPath("/stream/create")).toBe(true);
    expect(isStreamPath("/stream/status")).toBe(true);
    expect(isStreamPath("/stream/status/abc")).toBe(true);
    expect(isStreamPath("/stream/playback/abc")).toBe(true);
    expect(isStreamPath("/health")).toBe(false);
    expect(isStreamPath("/telegram")).toBe(false);
  });
});

describe("customer hostname parsing", () => {
  it("accepts a customer subdomain", () => {
    expect(customerBaseFrom("customer-abc.cloudflarestream.com")).toBe(
      "https://customer-abc.cloudflarestream.com"
    );
  });

  it("rejects non-Stream hosts", () => {
    expect(customerBaseFrom("https://stream.rotationtv.com/live")).toBeNull();
    expect(customerBaseFrom("evil.example")).toBeNull();
  });

  it("extracts the host from a WHIP URL", () => {
    expect(
      customerBaseFrom(undefined, "https://customer-xyz.cloudflarestream.com/uid/webRTC/publish")
    ).toBe("https://customer-xyz.cloudflarestream.com");
  });
});

describe("playback URL construction", () => {
  it("builds HLS and DASH manifests from the asset id or token", () => {
    const urls = playbackUrls("https://customer-abc.cloudflarestream.com", "tok_123");
    expect(urls.hls).toBe("https://customer-abc.cloudflarestream.com/tok_123/manifest/video.m3u8");
    expect(urls.dash).toBe("https://customer-abc.cloudflarestream.com/tok_123/manifest/video.mpd");
  });
});

describe("handleStream request contract", () => {
  it("requires an admin bearer token to create a live input", async () => {
    const env: StreamEnv = { ADMIN_SECRET: "secret" };
    const res = await handleStream(
      new Request("https://gateway.test/stream/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_id: "alice" }),
      }),
      env,
      cors
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("does not mint fake ingest URLs when Stream credentials are missing", async () => {
    const env: StreamEnv = { ADMIN_SECRET: "secret" };
    const res = await handleStream(
      new Request("https://gateway.test/stream/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
        body: JSON.stringify({ creator_id: "alice" }),
      }),
      env,
      cors
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("stream_not_configured");
  });

  it("rejects create without creator_id/name", async () => {
    const env: StreamEnv = {
      ADMIN_SECRET: "secret",
      CF_ACCOUNT_ID: "acct",
      CF_STREAM_API_TOKEN: "tok",
    };
    const res = await handleStream(
      new Request("https://gateway.test/stream/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
        body: JSON.stringify({}),
      }),
      env,
      cors
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("creator_id required");
  });

  it("requires an id for status", async () => {
    const res = await handleStream(
      new Request("https://gateway.test/stream/status"),
      {},
      cors
    );
    expect(res.status).toBe(400);
  });

  it("rejects short playback ids", async () => {
    const res = await handleStream(
      new Request("https://gateway.test/stream/playback/ab"),
      {},
      cors
    );
    expect(res.status).toBe(400);
  });
});
