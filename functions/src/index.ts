/* eslint-disable require-jsdoc */
/* eslint-disable max-len */
/* eslint-disable no-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {setGlobalOptions} from "firebase-functions/v2";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {defineSecret} from "firebase-functions/params";

import {initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";

import {Resend} from "resend";

initializeApp();
const db = getFirestore();

setGlobalOptions({maxInstances: 10, region: "us-central1"});

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const FROM_EMAIL = "Seligo <onboarding@resend.dev>";

function asMap(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function escapeHtml(s: unknown) {
  const str = String(s ?? "");
  return str.replace(/[&<>"']/g, (c) => {
    switch (c) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case "\"":
      return "&quot;";
    case "'":
      return "&#039;";
    default:
      return c;
    }
  });
}

function safeHttpUrl(u: unknown) {
  const raw = String(u ?? "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return "";
  return escapeHtml(raw);
}

function pickPurchaseUrl(p: Record<string, any>): string | null {
  const raw = p.purchaseUrl ?? p.purchaseURL ?? p.url ?? p.link ?? null;
  if (typeof raw !== "string") return null;

  const s = raw.trim();
  if (!s) return null;

  let candidate = s;
  if (/^https?:\/\//i.test(s)) {
    candidate = s;
  } else if (/^www\./i.test(s)) {
    candidate = `https://${s}`;
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;

    return url.toString();
  } catch {
    return null;
  }
}

function buildRoomscanEmail(opts: {
  products: Array<{ id: string; name: string; imageUrl: string; price: number; url?: string | null }>;
  heading?: string;
  intro?: string;
  sid?: string;
}) {
  const heading = opts.heading ?? "Your Seligo picks";
  const intro = opts.intro ?? "Here are your links:";
  const prods = opts.products ?? [];

  const itemsHtml = prods
    .map((p) => {
      const safeName = escapeHtml(String(p.name ?? "Untitled"));
      const safeImage = safeHttpUrl(p.imageUrl);
      const safeUrl = safeHttpUrl(p.url);
      const openItemHtml = safeUrl ?
        `<div style="margin-top:10px;">
           <a href="${safeUrl}" style="display:inline-block; padding:10px 12px; border-radius:12px; background:#F97316; color:#fff; font-weight:900; text-decoration:none;">
             Open item →
           </a>
         </div>` :
        "";

      return `
        <div style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid #e2e8f0;">
          <img src="${safeImage}" alt="" width="72" height="72" style="border-radius:12px; object-fit:cover;" />
          <div style="flex:1;">
            <div style="font-weight:800; color:#0f172a; line-height:1.2;">${safeName}</div>
            <div style="margin-top:6px; color:#0f172a; font-weight:800;">$${Number(p.price ?? 0).toFixed(2)}</div>
            ${openItemHtml}
          </div>
        </div>
      `;
    })
    .join("");

  const isCart = heading.toLowerCase().includes("cart");
  const campaign = isCart ? "cart_links" : "roomscan_picks";
  const sid = opts.sid ? encodeURIComponent(opts.sid) : "";
  const appUrl =
    "https://seligo.vercel.app/" +
    `?utm_source=email&utm_medium=lead&utm_campaign=${encodeURIComponent(campaign)}` +
    "&utm_content=cta" +
    (sid ? `&sid=${sid}` : "");

  const cta = `
    <div style="margin-top:28px; padding-top:18px; border-top:1px solid #e2e8f0; text-align:left;">
      <a href="${appUrl}" style="display:inline-block; padding:12px 16px; border-radius:14px; background:#0EA5E9; color:#fff; font-weight:900; text-decoration:none;">
        See more picks →
      </a>
      <div style="height:10px; line-height:10px;">&nbsp;</div>
    </div>
  `;

  const html = `
  <div style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding:20px; color:#0f172a;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">
      Here are your saved links from Seligo.
    </div>
    <div style="font-size:18px; font-weight:900;">${escapeHtml(heading)}</div>
    <div style="margin-top:6px; color:#475569;">${escapeHtml(intro)}</div>

    <div style="margin-top:16px;">
      ${itemsHtml || "<div style=\"color:#475569;\">No items found.</div>"}

      <div style="height:18px; line-height:18px; margin:18px 0 0 0; clear:both;">&nbsp;</div>

      ${cta}
      <div style="color:#94a3b8; font-size:12px; margin-top:16px;">
        You’re receiving this because you requested links from Seligo.
      </div>
    </div>
  </div>
  `;

  const textLines = prods.map((p) => `- ${p.name} ($${Number(p.price ?? 0).toFixed(2)}) ${p.url ?? ""}`);
  const text = `${heading}\n\n${intro}\n\n${textLines.join("\n")}\n\nSee more picks: ${appUrl}\n`;

  return {html, text};
}

function buildGenericLeadEmail(opts?: { heading?: string; intro?: string; sid?: string }) {
  const heading = opts?.heading ?? "Your Seligo links";
  const intro =
    opts?.intro ??
    "Thanks — we’ve saved your request. Come back to Seligo anytime to see more picks.";

  const campaign = "generic_links";
  const appUrl =
    "https://seligo.vercel.app/" +
    `?utm_source=email&utm_medium=lead&utm_campaign=${encodeURIComponent(campaign)}` +
    "&utm_content=cta" +
    (opts?.sid ? `&sid=${encodeURIComponent(opts.sid)}` : "");

  const cta = `
    <div style="margin-top:16px;">
      <a href="${appUrl}" style="display:inline-block; padding:12px 16px; border-radius:14px; background:#0EA5E9; color:#fff; font-weight:900; text-decoration:none;">
        See more picks →
      </a>
    </div>
  `;

  const html = `
  <div style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding:20px; color:#0f172a;">
    <div style="font-size:18px; font-weight:900;">${escapeHtml(heading)}</div>
    <div style="margin-top:6px; color:#475569;">${escapeHtml(intro)}</div>

    ${cta}

    <div style="color:#94a3b8; font-size:12px; margin-top:16px;">
      You’re receiving this because you requested links from Seligo.
    </div>
  </div>
  `;

  const text =
    `${heading}\n\n` +
    `${intro}\n\n` +
    `See more picks: ${appUrl}\n`;

  return {html, text};
}

async function logEmailEvent(opts: {
	uid: string | null;
	leadId: string;
	panel: "email_sent" | "email_failed";
	meta?: Record<string, any>;
}) {
  const sid = `server_${opts.leadId}`;
  const base = {
    type: "view_change",
    uid: opts.uid ?? null,
    sessionId: sid,
    view: "server",
    source: "email",
    productId: null,
    category: null,
    price: null,
    utm: {},
    meta: {
      panel: opts.panel,
      leadId: opts.leadId,
      provider: "resend",
      ...(opts.meta ?? {}),
      dedupeKey: `${opts.panel}_${sid}`,
      loggedAtMs: Date.now(),
      sid,
    },
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection("events").add(base);
}

export const sendLeadEmail = onDocumentCreated(
  {
    document: "leads/{leadId}",
    secrets: [RESEND_API_KEY],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const leadId = event.params.leadId;
    const sid = `server_${leadId}`;
    const ref = snap.ref;
    const lead = snap.data() as any;

    const email = String(lead?.email ?? "").trim().toLowerCase();
    const uid = String(lead?.uid ?? "");
    const source = String(lead?.source ?? "unknown");
    const meta = asMap(lead?.meta);

    if (!email || email.length < 5) {
      logger.warn("Lead missing/invalid email; skipping", {leadId, email});
      return;
    }
    if (!uid) {
      logger.warn("Lead missing uid; skipping", {leadId});
      return;
    }

    const started = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const curData = cur.data() as any;
      const status = String(curData?.emailStatus ?? "");

      if (status === "sent" || status === "processing") return false;

      tx.update(ref, {
        emailStatus: "processing",
        emailProcessingAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (!started) {
      logger.info("Email already processing/sent; skipping", {leadId});
      return;
    }

    let kind: "roomscan" | "cart" | "generic" = "generic";

    try {
      const resend = new Resend(RESEND_API_KEY.value());

      let html = "";
      let text = "";

      const pickIds = Array.isArray(meta.pickIds) ?
        meta.pickIds.filter((x: any) => typeof x === "string" && x.length > 0).slice(0, 20) :
        [];

      const cartIds = Array.isArray(meta.cartIds) ?
        meta.cartIds.filter((x: any) => typeof x === "string" && x.length > 0).slice(0, 30) :
        [];

      const isRoomscan = Array.isArray(meta?.pickIds) && pickIds.length > 0;
      const isCart = Array.isArray(meta?.cartIds) && cartIds.length > 0;

      kind = isRoomscan ? "roomscan" : isCart ? "cart" : "generic";

      const heading =
        kind === "roomscan" ?
          "Your Seligo room picks" :
          kind === "cart" ?
            "Your Seligo cart links" :
            "Your Seligo links";

      const intro =
        kind === "roomscan" ?
          "Here are your top picks — plus you’ll get alerts if prices drop or close alternatives are cheaper." :
          kind === "cart" ?
            "Here are your saved cart items — plus you’ll get alerts if prices drop or close alternatives are cheaper." :
            "";

      const subject = heading;

      const ids =
        kind === "roomscan" ? (pickIds ?? []) :
          kind === "cart" ? (cartIds ?? []) :
            [];

      const fetchProductsByIds = async (ids: string[]) => {
        if (!ids.length) return [];

        const refs = ids.map((id) => db.doc(`products/${id}`));
        const snaps = await db.getAll(...refs);

        const mapById = new Map<string, {
          id: string;
          name: string;
          imageUrl: string;
          price: number;
          url?: string | null;
        }>();

        for (const s of snaps) {
          if (!s.exists) continue;
          const d = asMap(s.data());

          const p = {
            id: s.id,
            name: String(d.name ?? d.title ?? "Untitled"),
            imageUrl: String(d.imageUrl ?? d.imageURL ?? ""),
            price: Number(d.price ?? 0),
            url: pickPurchaseUrl(d),
          };

          if (p.imageUrl) mapById.set(s.id, p);
        }

        return ids
          .map((id) => mapById.get(id))
          .filter(Boolean) as Array<{ id: string; name: string; imageUrl: string; price: number; url?: string | null }>;
      };

      if (kind === "generic") {
        ({html, text} = buildGenericLeadEmail({sid}));
      } else {
        const products = await fetchProductsByIds(ids);

        ({html, text} = buildRoomscanEmail({
          products,
          heading,
          intro,
          sid,
        }));
      }

      const resp = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject,
        html,
        text,
      });

      const resendId = (resp as any)?.data?.id ?? (resp as any)?.id ?? null;

      await ref.update({
        emailStatus: "sent",
        emailSentAt: FieldValue.serverTimestamp(),
        emailProvider: "resend",
        emailId: resendId,
      });

      await logEmailEvent({
        uid,
        leadId,
        panel: "email_sent",
        meta: {kind, emailId: resendId},
      });

      logger.info("Email sent", {leadId, email, source, id: resendId});
    } catch (err: any) {
      logger.error("Email send failed", {leadId, err});

      await ref.update({
        emailStatus: "error",
        emailErrorAt: FieldValue.serverTimestamp(),
        emailError: String(err?.message ?? err),
      });

      await logEmailEvent({
        uid,
        leadId,
        panel: "email_failed",
        meta: {kind, error: String(err?.message ?? err)},
      });
    }
  }
);
