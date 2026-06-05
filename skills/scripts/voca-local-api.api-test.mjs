import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiScript = path.join(scriptDir, "voca-local-api.mjs");
const sharedTokenPath = path.resolve(scriptDir, "../../packages/voca-core/src/auth/token.ts");

async function readSharedDefaultToken() {
  const content = await readFile(sharedTokenPath, "utf8");
  const match = content.match(/DEFAULT_VOCA_API_TOKEN\s*=\s*"([^"]+)"/);
  assert.ok(match?.[1], "Shared default token must be readable.");
  return match[1];
}

async function waitForServer(origin, token) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
    } catch {
      // Keep polling until the spawned server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Timed out waiting for test API server.");
}

async function withApiServer(fn, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "voca-api-test-"));
  const port = 24000 + Math.floor(Math.random() * 1000);
  const token = options.useSharedDefaultToken ? await readSharedDefaultToken() : "test-token";
  const origin = `http://127.0.0.1:${port}`;
  await mkdir(path.join(root, "cards"), { recursive: true });
  await mkdir(path.join(root, "audio"), { recursive: true });
  await writeFile(path.join(root, "cards", "proposition.png"), "png");
  await writeFile(
    path.join(root, "cards.json"),
    `${JSON.stringify(
      [
        {
          word: "proposition",
          file: "proposition.png",
          partOfSpeech: "noun",
          topic: "Business / Negotiation",
          tags: ["business / negotiation", "noun"],
          createdAt: "2026-05-06T15:33:36+07:00",
          level: "new",
          pronunciation: "/ˌprɑːpəˈzɪʃən/",
        },
      ],
      null,
      2,
    )}\n`,
  );

  const env = {
    ...process.env,
    VOCA_REPO_ROOT: root,
    VOCA_LOCAL_API_PORT: String(port),
    VOCA_BIND_ADDRESS: "127.0.0.1",
  };
  delete env.VOCA_API_TOKEN;
  delete env.VOCA_API_TOKENS;
  if (!options.useSharedDefaultToken) env.VOCA_API_TOKEN = token;

  const child = spawn(process.execPath, [apiScript], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  try {
    await waitForServer(origin, token);
    await fn({ origin, root, token });
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
}

test("v1 API falls back to shared default token when env token is omitted", async () => {
  await withApiServer(async ({ origin, token }) => {
    const unauthorized = await fetch(`${origin}/v1/health`);
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${origin}/v1/health`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(invalid.status, 401);

    const response = await fetch(`${origin}/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).authConfigured, true);
  }, { useSharedDefaultToken: true });
});

test("v1 API requires token and exposes bootstrap cards", async () => {
  await withApiServer(async ({ origin, token }) => {
    const unauthorized = await fetch(`${origin}/v1/cards`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED");

    const response = await fetch(`${origin}/v1/sync/bootstrap`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.manifestVersion, /^cards:/);
    assert.equal(payload.cards.length, 1);
    assert.equal(payload.cards[0].id, "proposition");
    assert.equal(payload.cards[0].imageUrl, "/v1/assets/cards/proposition.png");
    assert.equal(payload.cards[0].audioUrl, "/v1/audio/proposition");
  });
});

test("v1 API serves card assets and updates level in cards.json", async () => {
  await withApiServer(async ({ origin, root, token }) => {
    const asset = await fetch(`${origin}/v1/assets/cards/proposition.png`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "image/png");
    assert.equal(await asset.text(), "png");

    const patch = await fetch(`${origin}/v1/cards/proposition/level`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ level: "known" }),
    });
    assert.equal(patch.status, 200);
    const patchPayload = await patch.json();
    assert.equal(patchPayload.card.level, "known");

    const cards = JSON.parse(await readFile(path.join(root, "cards.json"), "utf8"));
    assert.equal(cards[0].level, "known");
  });
});

test("v1 API returns standard error envelope for missing audio", async () => {
  await withApiServer(async ({ origin, token }) => {
    const response = await fetch(`${origin}/v1/audio/proposition`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.equal(payload.error.code, "AUDIO_NOT_FOUND");
    assert.equal(typeof payload.error.message, "string");
  });
});

test("v1 create card validates backend LLM settings", async () => {
  await withApiServer(async ({ origin, token }) => {
    const response = await fetch(`${origin}/v1/cards/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ word: "new term" }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.code, "LLM_NOT_CONFIGURED");
  });
});

test("v1 agent stream validates backend LLM settings", async () => {
  await withApiServer(async ({ origin, token }) => {
    const response = await fetch(`${origin}/v1/agent/card/proposition/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Explain this word" }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.code, "LLM_NOT_CONFIGURED");
  });
});

test("v1 practice attempts sync appends attempt records", async () => {
  await withApiServer(async ({ origin, root, token }) => {
    const response = await fetch(`${origin}/v1/practice/attempts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attempts: [
          {
            id: "attempt-1",
            type: "drills",
            prompt: "Pick the best answer",
            response: "A. retain\nB. reject",
            selectedAnswer: "retain",
            contextScope: { type: "custom", cardIds: ["proposition"] },
            createdAt: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).synced, 1);
    const raw = await readFile(path.join(root, ".voca-output", "mobile-practice-attempts.jsonl"), "utf8");
    const [record] = raw.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(record.id, "attempt-1");
    assert.equal(record.contextScope.type, "custom");
    assert.deepEqual(record.contextScope.cardIds, ["proposition"]);
  });
});

test("v1 API deletes a card and its assets", async () => {
  await withApiServer(async ({ origin, root, token }) => {
    // Create dummy audio file to test deletion
    const audioDir = path.join(root, "audio", "voice_test");
    await mkdir(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, "proposition-hash.mp3");
    await writeFile(audioPath, "mp3");

    // Call DELETE /v1/cards/proposition
    const response = await fetch(`${origin}/v1/cards/proposition`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);

    // Verify deleted from cards.json
    const cards = JSON.parse(await readFile(path.join(root, "cards.json"), "utf8"));
    assert.equal(cards.length, 0);

    // Verify PNG is deleted
    const pngExists = await readFile(path.join(root, "cards", "proposition.png")).then(() => true).catch(() => false);
    assert.equal(pngExists, false);

    // Verify MP3 is deleted
    const mp3Exists = await readFile(audioPath).then(() => true).catch(() => false);
    assert.equal(mp3Exists, false);
  });
});

test("v1 API clears all cards and assets", async () => {
  await withApiServer(async ({ origin, root, token }) => {
    // Create dummy audio file to test deletion
    const audioDir = path.join(root, "audio", "voice_test");
    await mkdir(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, "proposition-hash.mp3");
    await writeFile(audioPath, "mp3");

    // Call DELETE /v1/cards
    const response = await fetch(`${origin}/v1/cards`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);

    // Verify cards.json is empty list
    const cards = JSON.parse(await readFile(path.join(root, "cards.json"), "utf8"));
    assert.equal(cards.length, 0);

    // Verify PNG is deleted
    const pngExists = await readFile(path.join(root, "cards", "proposition.png")).then(() => true).catch(() => false);
    assert.equal(pngExists, false);

    // Verify MP3 is deleted
    const mp3Exists = await readFile(audioPath).then(() => true).catch(() => false);
    assert.equal(mp3Exists, false);
  });
});

