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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
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

function pickPurchaseUrl(p: Record<string, any>): string | null {
  const u = p.purchaseUrl ?? p.purchaseURL ?? p.url ?? p.link ?? null;
  return typeof u === "string" && u.length >= 8 ? u : null;
}

function buildRoomscanEmail(opts: {
  products: Array<{ id: string; name: string; imageUrl: string; price: number; url?: string | null }>;
  heading?: string;
  intro?: string;
}) {
  const heading = opts.heading ?? "Your Seligo room picks";
  const intro =
    opts.intro ??
    "Here are your top picks — plus you’ll get alerts if prices drop or close alternatives are cheaper.";

  const itemsHtml = opts.products
    .map((p) => {
      const name = escapeHtml(p.name);
      const img = escapeHtml(p.imageUrl);
      const price = Number.isFinite(p.price) ? p.price.toFixed(2) : "0.00";
      const url = p.url ? escapeHtml(p.url) : "";

      return `
        <div style="display:flex; gap:12px; padding:12px; border:1px solid #eee; border-radius:14px; margin:10px 0;">
          <img src="${img}" width="72" height="72" style="object-fit:cover; border-radius:12px; background:#f3f4f6;" />
          <div style="flex:1; min-width:0;">
            <div style="font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
            <div style="color:#475569; font-size:12px; margin-top:4px;">$${price}</div>
            ${url ? `<a href="${url}" style="display:inline-block; margin-top:8px; color:#f97316; font-weight:800; text-decoration:none;">Open ↗</a>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
      <h2 style="margin:0 0 10px; color:#0f172a;">${escapeHtml(heading)}</h2>
      <div style="color:#475569; font-size:14px; margin-bottom:14px;">
        ${escapeHtml(intro)}
      </div>
      ${itemsHtml || "<div style=\"color:#475569;\">No items found.</div>"}
      <div style="color:#94a3b8; font-size:12px; margin-top:16px;">
        You’re receiving this because you requested links from Seligo.
      </div>
    </div>
  `;

  const textLines = opts.products.map((p) => `- ${p.name} ($${p.price.toFixed(2)}) ${p.url ?? ""}`);
  const text = `${heading}\n\n${intro}\n\n${textLines.join("\n")}\n`;

  return {html, text};
}

function buildGenericLeadEmail() {
  const html = `
		<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
			<h2 style="margin:0 0 10px; color:#0f172a;">You’re all set ✅</h2>
			<div style="color:#475569; font-size:14px;">
				We’ll email you if items drop in price or a close alternative is cheaper.
			</div>
			<div style="color:#94a3b8; font-size:12px; margin-top:16px;">
				You’re receiving this because you requested alerts from Seligo.
			</div>
		</div>
	`;
  const text = "You're all set. We'll email you if items drop in price or close alternatives are cheaper.\n";
  return {html, text};
}

async function logEmailEvent(opts: {
	uid: string;
	source: string;
	view: string;
	leadId: string;
	panel: "email_sent" | "email_failed";
	meta?: Record<string, any>;
}) {
  const base = {
    type: "view_change",
    uid: opts.uid,
    sessionId: `server_${opts.leadId}`,
    view: opts.view || "unknown",
    source: opts.source || "server",
    utm: {},
    meta: {
      panel: opts.panel,
      leadId: opts.leadId,
      ...(opts.meta ?? {}),
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
    const ref = snap.ref;
    const lead = snap.data() as any;

    const email = String(lead?.email ?? "").trim().toLowerCase();
    const uid = String(lead?.uid ?? "");
    const source = String(lead?.source ?? "unknown");
    const view = String(lead?.view ?? "unknown");
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

    try {
      const resend = new Resend(RESEND_API_KEY.value());

      let subject = "Your Seligo links";
      let html = "";
      let text = "";

      const pickIds = Array.isArray(meta.pickIds) ?
        meta.pickIds.filter((x: any) => typeof x === "string" && x.length > 0).slice(0, 20) :
        [];

      const cartIds = Array.isArray(meta.cartIds) ?
        meta.cartIds.filter((x: any) => typeof x === "string" && x.length > 0).slice(0, 30) :
        [];

      if (source === "roomscan" && pickIds.length) {
        const refs = pickIds.map((id: string) => db.doc(`products/${id}`));
        const snaps = await db.getAll(...refs);

        const products = snaps
          .filter((s) => s.exists)
          .map((s) => {
            const d = asMap(s.data());
            return {
              id: s.id,
              name: String(d.name ?? d.title ?? "Untitled"),
              imageUrl: String(d.imageUrl ?? d.imageURL ?? ""),
              price: Number(d.price ?? 0),
              url: pickPurchaseUrl(d),
            };
          })
          .filter((p) => p.imageUrl);

        subject = "Your Seligo room picks";
        ({html, text} = buildRoomscanEmail({products}));
      } else if (cartIds.length) {
        const refs = cartIds.map((id: string) => db.doc(`products/${id}`));
        const snaps = await db.getAll(...refs);

        const products = snaps
          .filter((s) => s.exists)
          .map((s) => {
            const d = asMap(s.data());
            return {
              id: s.id,
              name: String(d.name ?? d.title ?? "Untitled"),
              imageUrl: String(d.imageUrl ?? d.imageURL ?? ""),
              price: Number(d.price ?? 0),
              url: pickPurchaseUrl(d),
            };
          })
          .filter((p) => p.imageUrl);

        subject = "Your Seligo cart links";
        ({html, text} = buildRoomscanEmail({products}));
      } else {
        ({html, text} = buildGenericLeadEmail());
      }

      const resp = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject,
        html,
        text,
      });

      await ref.update({
        emailStatus: "sent",
        emailSentAt: FieldValue.serverTimestamp(),
        emailProvider: "resend",
        emailId: resp?.data?.id ?? null,
      });

      await logEmailEvent({
        uid,
        source,
        view,
        leadId,
        panel: "email_sent",
        meta: {emailId: resp?.data?.id ?? null},
      });

      logger.info("Email sent", {leadId, email, source, id: resp?.data?.id ?? null});
    } catch (err: any) {
      logger.error("Email send failed", {leadId, err});

      await ref.update({
        emailStatus: "error",
        emailErrorAt: FieldValue.serverTimestamp(),
        emailError: String(err?.message ?? err),
      });

      await logEmailEvent({
        uid,
        source,
        view,
        leadId,
        panel: "email_failed",
        meta: {error: String(err?.message ?? err)},
      });
    }
  }
);
