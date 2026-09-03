// Emails a weekly traffic digest for boron.sh, because Vercel Web Analytics has
// no digest of its own — it has a dashboard and an API, and nothing that
// arrives on a Monday without being asked.
//
//   node scripts/weekly-digest.mjs --dry-run    print the email, send nothing
//   node scripts/weekly-digest.mjs              print it and send it
//
// Driven by .github/workflows/weekly-digest.yml rather than a Vercel cron: a
// cron would mean adding a serverless function, and boron.sh is a static site
// with no api/ directory to put one in. A workflow also keeps the endpoint off
// the public internet, so there is no shared secret to guard.
//
// Reads from the environment:
//   VERCEL_TOKEN     required — https://vercel.com/account/tokens
//   RESEND_API_KEY   required unless --dry-run — https://resend.com/api-keys
//   DIGEST_TO        required unless --dry-run — where the mail goes
//   DIGEST_FROM      optional — defaults to onboarding@resend.dev, which Resend
//                    lets any account send from without verifying a domain

const PROJECT_ID = "prj_tiUjveBhB9IupSMTwL1152jjbsvM";
const TEAM_ID = "team_Rg27mP2xeVuYrgFYq3ziXRrf";
const API = "https://api.vercel.com/v1/query/web-analytics";

const dryRun = process.argv.includes("--dry-run");

/** Midnight UTC, `days` ago. The analytics API takes plain YYYY-MM-DD. */
function day(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const THIS_WEEK = { since: day(7), until: day(0) };
const LAST_WEEK = { since: day(14), until: day(7) };

async function query(path, params) {
  const url = new URL(`${API}/${path}`);
  url.searchParams.set("teamId", TEAM_ID);
  url.searchParams.set("projectId", PROJECT_ID);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()).data;
}

/**
 * Week over week, as a signed percentage. Returns null when there is nothing to
 * compare against — a first run, or a metric that was zero last week, where any
 * number at all would divide by zero and "+∞%" tells the reader nothing.
 */
function delta(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

function arrow(percent) {
  if (percent === null) return "";
  if (percent === 0) return "  ±0%";
  return percent > 0 ? `  ▲ ${percent}%` : `  ▼ ${Math.abs(percent)}%`;
}

/**
 * Pad to a column width — and truncate past it, because one long value would
 * otherwise push its own row's number out of the column and un-align the block.
 * Referrers are the ones that run long: `com.twitter.android`, not `t.co`.
 */
const pad = (text, width) => {
  const value = String(text);
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
};
const padStart = (text, width) => String(text).padStart(width);

/**
 * The digest, as monospaced text. Boron is a tool for making pictures of
 * terminals, so its own weekly mail may as well look like one.
 */
export function render({ visits, previous, events, formats, flavours, referrers }) {
  const lines = [];
  const range = `${THIS_WEEK.since} – ${THIS_WEEK.until}`;
  lines.push(`boron.sh · ${range}`, "");

  lines.push(`  ${padStart(visits.pageviews, 6)} page views${arrow(delta(visits.pageviews, previous.pageviews))}`);
  lines.push(`  ${padStart(visits.visitors, 6)} visitors${arrow(delta(visits.visitors, previous.visitors))}`);
  lines.push("");

  if (events.length) {
    lines.push("What people did");
    for (const { eventName, count } of events) {
      // The two events that carry a property get their breakdown inline, since
      // "which format" is the whole reason the events exist.
      const breakdown =
        eventName === "Export" ? summarise(formats) : eventName === "Copy text" ? summarise(flavours) : "";
      lines.push(`  ${pad(eventName, 12)}${padStart(count, 5)}${breakdown ? `   ${breakdown}` : ""}`);
    }
    lines.push("");
  } else {
    lines.push("What people did", "  nothing tracked yet", "");
  }

  if (referrers.length) {
    lines.push("Where they came from");
    for (const row of referrers) {
      lines.push(`  ${pad(row.referrerHostname || "(direct)", 12)}${padStart(row.visitors, 5)}`);
    }
  }

  return lines.join("\n");
}

/** `png 28 · svg 9` — the property breakdown for one event, biggest first. */
function summarise(rows) {
  return rows
    .filter((row) => row.eventData)
    .map((row) => `${row.eventData} ${row.count}`)
    .join(" · ");
}

async function main() {
  if (!process.env.VERCEL_TOKEN) throw new Error("VERCEL_TOKEN is not set");

  const [visits, previous, events, formats, flavours, referrers] = await Promise.all([
    query("visits/count", THIS_WEEK),
    query("visits/count", LAST_WEEK),
    query("events/aggregate", { ...THIS_WEEK, by: "eventName", limit: "10" }),
    query("events/aggregate", { ...THIS_WEEK, by: "eventData/format", filter: "eventName eq 'Export'" }),
    query("events/aggregate", { ...THIS_WEEK, by: "eventData/kind", filter: "eventName eq 'Copy text'" }),
    query("visits/aggregate", { ...THIS_WEEK, by: "referrerHostname", limit: "6" }),
  ]);

  const text = render({ visits, previous, events, formats, flavours, referrers });
  console.log(text);

  if (dryRun) return;

  const to = process.env.DIGEST_TO;
  if (!process.env.RESEND_API_KEY || !to) {
    throw new Error("RESEND_API_KEY and DIGEST_TO must be set to send (or pass --dry-run)");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.DIGEST_FROM ?? "boron.sh <onboarding@resend.dev>",
      to: [to],
      subject: `boron.sh — ${visits.pageviews} views, ${visits.visitors} visitors`,
      text,
      // The same text in a <pre>, so a mail client that prefers HTML still gets
      // the columns lined up rather than collapsing the spacing.
      html: `<pre style="font: 13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
    }),
  });
  if (!response.ok) throw new Error(`resend → ${response.status} ${await response.text()}`);
  console.log(`\nSent to ${to}.`);
}

// Importable for tests without firing the queries.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
