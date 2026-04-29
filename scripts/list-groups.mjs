#!/usr/bin/env node
/**
 * List NIP-29 groups on a relay, ranked by activity. No auth.
 *
 * Pipeline:
 *   1. REQ kind:39000 → collect group metadata (name, about, group id)
 *   2. REQ kind:39002 → count member tags per group
 *   3. REQ kind:9 with limit:200 per group → message count proxy
 *   4. Print sorted by message count, then member count
 *
 * Usage: node scripts/list-groups.mjs [--relay=wss://...] [--top=20]
 */
import WebSocket from "ws";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);

const RELAY = args.relay || "wss://groups.0xchat.com";
const TOP = parseInt(args.top || "20", 10);
const SAMPLE_LIMIT = parseInt(args.sample || "200", 10);
// Hard cap on how many groups we'll probe for messages — probing every
// group on a busy relay can take minutes. The metadata + member pass is
// always full.
const PROBE_CAP = parseInt(args.probe || "200", 10);

console.error(`→ ${RELAY}`);

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let nextSubId = 0;
function subscribe(ws, filter, onEvent) {
  return new Promise((resolve) => {
    const id = `s${nextSubId++}`;
    function onMessage(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[1] !== id) return;
      if (msg[0] === "EVENT") onEvent(msg[2]);
      else if (msg[0] === "EOSE") {
        ws.off("message", onMessage);
        ws.send(JSON.stringify(["CLOSE", id]));
        resolve();
      }
      else if (msg[0] === "CLOSED") {
        ws.off("message", onMessage);
        resolve();
      }
    }
    ws.on("message", onMessage);
    ws.send(JSON.stringify(["REQ", id, filter]));
  });
}

function tagValue(tags, key) {
  for (const t of tags) if (t[0] === key) return t[1];
  return undefined;
}

async function main() {
  const ws = await open();

  // 1. Group metadata
  const groups = new Map(); // id → { id, name, about, isPublic }
  console.error("[1/3] fetching group metadata (kind:39000)…");
  await subscribe(ws, { kinds: [39000] }, (e) => {
    const id = tagValue(e.tags, "d");
    if (!id) return;
    let name, about;
    let isPublic = false;
    for (const t of e.tags) {
      if (t[0] === "name") name = t[1];
      else if (t[0] === "about") about = t[1];
      else if (t[0] === "public") isPublic = true;
    }
    groups.set(id, {
      id,
      name: name || "(no name)",
      about: about || "",
      isPublic,
      members: 0,
      messages: 0,
    });
  });
  console.error(`  found ${groups.size} groups`);

  // 2. Member counts (kind:39002)
  console.error("[2/3] fetching member lists (kind:39002)…");
  await subscribe(ws, { kinds: [39002] }, (e) => {
    const id = tagValue(e.tags, "d");
    if (!id) return;
    const g = groups.get(id);
    if (!g) return;
    g.members = e.tags.filter((t) => t[0] === "p").length;
  });

  // 3. Message count proxy — sample up to SAMPLE_LIMIT messages per group.
  // Cap the probe set at PROBE_CAP largest-by-members groups so this
  // doesn't take forever on a relay with thousands of groups.
  const sortedForProbe = [...groups.values()]
    .sort((a, b) => b.members - a.members)
    .slice(0, PROBE_CAP);
  console.error(
    `[3/3] sampling messages for top ${sortedForProbe.length} by member count (limit ${SAMPLE_LIMIT} each)…`,
  );

  // Concurrency: 8 in flight at a time. Bigger and the relay rate-limits.
  const queue = [...sortedForProbe];
  const CONCURRENCY = 8;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }).map(async () => {
      while (queue.length) {
        const g = queue.shift();
        let count = 0;
        await subscribe(
          ws,
          { kinds: [9], "#h": [g.id], limit: SAMPLE_LIMIT },
          () => { count++; },
        );
        g.messages = count;
        done++;
        if (done % 10 === 0) {
          process.stderr.write(`\r  probed ${done}/${sortedForProbe.length}`);
        }
      }
    }),
  );
  process.stderr.write(`\r  probed ${done}/${sortedForProbe.length}\n`);

  ws.close();

  // Output
  const ranked = [...groups.values()]
    .sort((a, b) => b.messages - a.messages || b.members - a.members)
    .slice(0, TOP);

  console.log("\nrank  msgs   members  pub  name");
  console.log("─".repeat(80));
  ranked.forEach((g, i) => {
    const row = [
      String(i + 1).padStart(4),
      String(g.messages === SAMPLE_LIMIT ? `${SAMPLE_LIMIT}+` : g.messages).padStart(6),
      String(g.members).padStart(8),
      g.isPublic ? "y  " : "n  ",
    ].join("  ");
    console.log(row + "  " + g.name.slice(0, 60));
    console.log(" ".repeat(34) + "id: " + g.id);
  });

  console.log(
    `\nshowing top ${ranked.length} of ${groups.size} groups. ` +
    `messages capped at ${SAMPLE_LIMIT} (shown as "${SAMPLE_LIMIT}+" when reached).`,
  );
  console.log(
    `tune in via the URL ?id=<id>&relay=${encodeURIComponent(RELAY)} or paste the id ` +
    `into "Tune to a frequency".`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
