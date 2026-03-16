import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db, ensureUser, ensureUserReady } from "../../firestoreService";
import { auth } from "../../firebase";
import type { EmailKind, EmailKindStat, TopEmailErrorRow } from "../../types";
import { fetchRecentEvents, fmtCreatedAt, type AdminEventRow } from "../lib/adminEvents";

type EventType =
  | "session_start"
  | "view_change"
  | "card_impression"
  | "product_open"
  | "swipe_pass"
  | "wishlist_add"
  | "cart_add"
  | "checkout_open"
  | "checkout_item_open"
  | "buy_click"
  | "lead_submit"
  | "scan_start"
  | "scan_success"
  | "scan_apply"
  | "share_click"
  | "pick_impression"
  | "pick_save"
  | "pick_dismiss";

type Stat = {
  count: number;
  sessions: number;
};

type ConfirmStats = {
  shown: Stat;
  emailClick: Stat;
  retailerClick: Stat;
  dismiss: Stat;
};

type ConfirmRateStats = {
  shownRate: string;
  emailCtr: string;
  retailerCtr: string;
  dismissCtr: string;
  primaryEmailShare: string;
  primaryRetailerShare: string;
  primaryDismissShare: string;
};

type ConfirmVariant = "A" | "B";

type ConfirmVariantNewStats = {
  shown: Stat;
  emailClick: Stat;
  retailerClick: Stat;
  dismiss: Stat;
  emailCtr: string;
  retailerCtr: string;
  dismissCtr: string;
  primaryEmailShare: string;
  primaryRetailerShare: string;
  primaryDismissShare: string;
};

type EmailKindAgg = {
  sent: number;
  failed: number;
  returned: number;
  cleanReturned: number;
  uniqueSent: Set<string>;
  uniqueReturned: Set<string>;
};

type PairKey = `${string}|${string}`;

type StatsState = {
  byType: Record<string, Stat>;
  pairSessions: Record<PairKey, number>;
  leadBySource: Record<string, Stat>;
  leadPairSessionsBySource: Record<string, { perCheckout: number; perBuy: number }>;
  promptBySource: Record<string, Stat>;
  leadPerPromptSessionsBySource: Record<string, number>;
  leadDocCreated: Stat;
  emailPanel: {
    sent: Stat;
    failed: Stat;
    returned: Stat;
    cleanReturnCount: number;
    openCheckoutCount: number;
    uniqueSentSids: number;
    uniqueReturnSids: number;
  };
  emailByKind: Record<string, EmailKindStat>;
  visibleEmailKinds: string[];
  topEmailErrors: TopEmailErrorRow[];
  utmReturnSessions: {
    emailLeadCartLinks: number;
  };
  confirmByBucket: Record<ConfirmBucket, ConfirmStats>;
  confirmRatesByBucket: Record<ConfirmBucket, ConfirmRateStats>;
  confirmByVariantNew: Record<ConfirmVariant, ConfirmVariantNewStats>;
};

function pairKey(num: string, den: string) {
  return `${num}|${den}` as PairKey;
}

const TYPES: EventType[] = [
  "session_start",
  "card_impression",
  "product_open",
  "wishlist_add",
  "cart_add",
  "checkout_open",
  "checkout_item_open",
  "buy_click",
  "lead_submit",
  "scan_start",
  "scan_success",
  "scan_apply",
  "share_click",
  "pick_impression",
  "pick_save",
  "pick_dismiss",
];

const TYPES_FOR_STATS = Array.from(new Set([...TYPES, "view_change"])) as string[];

const REQUIRED_EVENT_TYPES: EventType[] = [
  "view_change",
  "checkout_open",
  "card_impression",
  "buy_click",
  "lead_submit",
  "session_start",
];

function pct(num: number, den: number) {
  if (!den || den <= 0) return "—";
  const v = num / den;
  if (!Number.isFinite(v)) return "—";
  const capped = Math.min(1, Math.max(0, v));
  return `${Math.round(capped * 1000) / 10}% (${num}/${den})`;
}

const intersectionSize = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  for (const v of small) if (large.has(v)) n += 1;
  return n;
};

const pairs = [
  ["product_open", "card_impression"],
  ["wishlist_add", "card_impression"],
  ["cart_add", "card_impression"],
  ["checkout_open", "cart_add"],
  ["checkout_item_open", "checkout_open"],
  ["buy_click", "checkout_open"],
  ["lead_submit", "checkout_open"],
  ["lead_submit", "buy_click"],
  ["scan_success", "session_start"],
  ["scan_apply", "scan_success"],
  ["share_click", "scan_apply"],
  ["lead_submit", "scan_apply"],
  ["pick_save", "pick_impression"],
  ["pick_dismiss", "pick_impression"],
 ] as const;

const leadSources = ["cart_confirm", "post_buy_panel", "roomscan"] as const;
type LeadSource = (typeof leadSources)[number];
const leadSourceSet = new Set<string>(leadSources);

const confirmBuckets = ["new", "returning"] as const;
type ConfirmBucket = (typeof confirmBuckets)[number];
const confirmVariants: ConfirmVariant[] = ["A", "B"];

async function fetchAllStatsSince(
  since: Timestamp,
  types: string[],
  pairs: ReadonlyArray<readonly [string, string]>
): Promise<StatsState> {
  const trackedTypes = Array.from(new Set([...types, ...REQUIRED_EVENT_TYPES]));
  const allowed = new Set<string>(trackedTypes);

  const counts: Record<string, number> = {};
  const sessionSets: Record<string, Set<string>> = {};
  for (const t of trackedTypes) {
    counts[t] = 0;
    sessionSets[t] = new Set<string>();
  }

  const leadCounts: Record<string, number> = {};
  const leadSessionSets: Record<string, Set<string>> = {};
  const promptCounts: Record<string, number> = {};
  const promptSessionSets: Record<string, Set<string>> = {};
  for (const s of leadSources) {
    leadCounts[s] = 0;
    leadSessionSets[s] = new Set<string>();
    promptCounts[s] = 0;
    promptSessionSets[s] = new Set<string>();
  }

  const confirmShownCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmShownSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const confirmEmailClickCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmEmailClickSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const confirmRetailerClickCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmRetailerClickSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const confirmDismissCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmDismissSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const confirmPrimaryEmailCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmPrimaryEmailSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const confirmPrimaryRetailerCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmPrimaryRetailerSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const confirmPrimaryDismissCounts: Record<ConfirmBucket, number> = { new: 0, returning: 0 };
  const confirmPrimaryDismissSessionSets: Record<ConfirmBucket, Set<string>> = { new: new Set(), returning: new Set() };

  const shownCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };
  const shownSessByVar: Record<ConfirmVariant, Set<string>> = { A: new Set(), B: new Set() };

  const emailClickCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };
  const emailClickSessByVar: Record<ConfirmVariant, Set<string>> = { A: new Set(), B: new Set() };

  const retailerClickCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };
  const retailerClickSessByVar: Record<ConfirmVariant, Set<string>> = { A: new Set(), B: new Set() };

  const dismissCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };
  const dismissSessByVar: Record<ConfirmVariant, Set<string>> = { A: new Set(), B: new Set() };

  const primaryEmailCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };
  const primaryRetailerCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };
  const primaryDismissCountsByVar: Record<ConfirmVariant, number> = { A: 0, B: 0 };

  const emailPanelCounts = { email_sent: 0, email_failed: 0, email_return: 0 };
  const emailPanelCounts2 = { email_return_clean: 0, email_return_open_checkout: 0 };
  const leadDocCreated = { count: 0, sessions: new Set<string>() };
  const emailPanelSessionSets = {
    email_sent: new Set<string>(),
    email_failed: new Set<string>(),
    email_return: new Set<string>(),
  };
  const emailPanelSidSets = {
    email_sent: new Set<string>(),
    email_return: new Set<string>(),
  };

  const emailByKindAgg: Record<string, EmailKindAgg> = {};
  const sidToKind = new Map<string, EmailKind>();
  const emailErrorCounts = new Map<string, number>();

  function kindFromUtmCampaign(campaignRaw: any): EmailKind {
    const campaign = String(campaignRaw ?? "").toLowerCase();
    if (campaign === "cart_links") return "cart";
    if (campaign === "roomscan_picks") return "roomscan";
    if (campaign === "generic_links") return "generic";
    return "unknown";
  }

  function ensureKind(kind: EmailKind) {
    if (emailByKindAgg[kind]) return;
    emailByKindAgg[kind] = {
      sent: 0,
      failed: 0,
      returned: 0,
      cleanReturned: 0,
      uniqueSent: new Set<string>(),
      uniqueReturned: new Set<string>(),
    };
  }

  const emailLeadReturnSessionSet = new Set<string>();

  const qy = query(
    collection(db, "events"),
    where("createdAt", ">=", since),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(qy);

  snap.forEach((d) => {
    const data = d.data() as any;
    if (String(data?.type ?? "") !== "view_change") return;
    if (String(data?.source ?? "") !== "email") return;

    const meta =
      data?.meta && typeof data.meta === "object" && !Array.isArray(data.meta) ? data.meta : {};
    if (String(meta?.panel ?? "") !== "email_sent") return;

    const metaSid = meta?.sid != null ? String(meta.sid) : "";
    if (!metaSid) return;

    const rawKind = String(meta?.kind ?? "").toLowerCase();
    const kind: EmailKind =
      rawKind === "cart" || rawKind === "roomscan" || rawKind === "generic" ? rawKind : "unknown";

    sidToKind.set(metaSid, kind);
  });

  snap.forEach((d) => {
    const data = d.data() as any;
    const t = String(data?.type ?? "");

    if (!allowed.has(t)) return;

    counts[t] += 1;

    const sid = data?.sessionId != null ? String(data.sessionId) : "";
    if (sid) sessionSets[t].add(sid);

    if (t === "lead_submit" && sid) {
      const src = String(data?.source ?? "");
      if (leadSourceSet.has(src)) {
        leadCounts[src] += 1;
        leadSessionSets[src].add(sid);
      }
    }

    if (t === "view_change" && sid) {
      const src = String(data?.source ?? "");
      const meta =
        data?.meta && typeof data.meta === "object" && !Array.isArray(data.meta) ? data.meta : {};
      const panel = String(meta?.panel ?? "");
      const metaSid = meta?.sid != null ? String(meta.sid) : "";
      const sidMissing = meta?.sidMissing === 1 || meta?.sidMissing === true;

      if (panel === "lead_doc_created") {
        leadDocCreated.count += 1;
        leadDocCreated.sessions.add(sid);
      }

      // ---- EMAIL PIPELINE EVENTS (server + client) ----
      if (src === "email") {
        const utmRaw =
          data?.utm && typeof data.utm === "object" && !Array.isArray(data.utm) ? data.utm : {};
        const campaignKind = kindFromUtmCampaign(utmRaw?.utm_campaign);

        if (panel === "email_sent") {
          const rawKind = String(meta?.kind ?? "").toLowerCase();
          const kind: EmailKind =
            rawKind === "cart" || rawKind === "roomscan" || rawKind === "generic" ? rawKind : "unknown";
          ensureKind(kind);

          emailPanelCounts.email_sent += 1;
          emailPanelSessionSets.email_sent.add(sid);
          emailByKindAgg[kind].sent += 1;

          if (metaSid) {
            emailPanelSidSets.email_sent.add(metaSid);
            emailByKindAgg[kind].uniqueSent.add(metaSid);
            sidToKind.set(metaSid, kind);
          }
        } else if (panel === "email_failed") {
          const rawKind = String(meta?.kind ?? "").toLowerCase();
          const kind: EmailKind =
            rawKind === "cart" || rawKind === "roomscan" || rawKind === "generic" ? rawKind : "unknown";
          ensureKind(kind);

          emailPanelCounts.email_failed += 1;
          emailPanelSessionSets.email_failed.add(sid);
          emailByKindAgg[kind].failed += 1;

          const msg = String(meta?.error ?? "unknown").slice(0, 200);
          emailErrorCounts.set(msg, (emailErrorCounts.get(msg) ?? 0) + 1);
        } else if (panel === "email_return") {
          const kind: EmailKind =
            !sidMissing && metaSid && sidToKind.get(metaSid) ? sidToKind.get(metaSid)! : campaignKind;
          ensureKind(kind);

          emailPanelCounts.email_return += 1;
          emailPanelSessionSets.email_return.add(sid);
          emailByKindAgg[kind].returned += 1;

          if (!sidMissing && metaSid) {
            emailByKindAgg[kind].cleanReturned += 1;
            emailByKindAgg[kind].uniqueReturned.add(metaSid);
            emailPanelCounts2.email_return_clean += 1;
            emailPanelSidSets.email_return.add(metaSid);
          }

          if (String(utmRaw?.utm_source ?? "").toLowerCase() === "email"
            && String(utmRaw?.utm_medium ?? "").toLowerCase() === "lead"
            && String(utmRaw?.utm_campaign ?? "").toLowerCase() === "cart_links") {
            emailLeadReturnSessionSet.add(sid);
          }
        } else if (panel === "email_return_open_checkout") {
          emailPanelCounts2.email_return_open_checkout += 1;
        }
      }

      if (panel === "lead_prompt_shown" && leadSourceSet.has(src)) {
        promptCounts[src] += 1;
        promptSessionSets[src].add(sid);
      }

      if (src === "cart_confirm") {
        const preferRetailer = meta?.preferRetailer === 1 || meta?.preferRetailer === true;
        const bucket: ConfirmBucket = preferRetailer ? "returning" : "new";
        const variantRaw = String(meta?.variant ?? "A").toUpperCase();
        const variant: ConfirmVariant = variantRaw === "B" ? "B" : "A";

        if (panel === "cart_confirm_card_shown") {
          confirmShownCounts[bucket] += 1;
          confirmShownSessionSets[bucket].add(sid);
        } else if (panel === "cart_confirm_email_click") {
          confirmEmailClickCounts[bucket] += 1;
          confirmEmailClickSessionSets[bucket].add(sid);
        } else if (panel === "cart_confirm_open_retailer_click") {
          confirmRetailerClickCounts[bucket] += 1;
          confirmRetailerClickSessionSets[bucket].add(sid);
        } else if (panel === "cart_confirm_dismiss") {
          confirmDismissCounts[bucket] += 1;
          confirmDismissSessionSets[bucket].add(sid);
        } else if (panel === "cart_confirm_primary_choice") {
          const choice = String(meta?.choice ?? "");
          if (choice === "email") {
            confirmPrimaryEmailCounts[bucket] += 1;
            confirmPrimaryEmailSessionSets[bucket].add(sid);
          } else if (choice === "retailer") {
            confirmPrimaryRetailerCounts[bucket] += 1;
            confirmPrimaryRetailerSessionSets[bucket].add(sid);
          } else if (choice === "dismiss") {
            confirmPrimaryDismissCounts[bucket] += 1;
            confirmPrimaryDismissSessionSets[bucket].add(sid);
          }
        }

        if (bucket === "new") {
          if (panel === "cart_confirm_card_shown") {
            shownCountsByVar[variant] += 1;
            shownSessByVar[variant].add(sid);
          } else if (panel === "cart_confirm_email_click") {
            emailClickCountsByVar[variant] += 1;
            emailClickSessByVar[variant].add(sid);
          } else if (panel === "cart_confirm_open_retailer_click") {
            retailerClickCountsByVar[variant] += 1;
            retailerClickSessByVar[variant].add(sid);
          } else if (panel === "cart_confirm_dismiss") {
            dismissCountsByVar[variant] += 1;
            dismissSessByVar[variant].add(sid);
          } else if (panel === "cart_confirm_primary_choice") {
            const choice = String(meta?.choice ?? "");
            if (choice === "email") primaryEmailCountsByVar[variant] += 1;
            else if (choice === "retailer") primaryRetailerCountsByVar[variant] += 1;
            else if (choice === "dismiss") primaryDismissCountsByVar[variant] += 1;
          }
        }
      }
    }
  });

  console.log("[admin] view_change total:", counts["view_change"], "promptSessions:", {
    cart_confirm: promptSessionSets["cart_confirm"]?.size ?? 0,
    post_buy_panel: promptSessionSets["post_buy_panel"]?.size ?? 0,
    roomscan: promptSessionSets["roomscan"]?.size ?? 0,
  });

  const valid =
    (sessionSets["checkout_open"]?.size ? sessionSets["checkout_open"] : null) ??
    (sessionSets["card_impression"]?.size ? sessionSets["card_impression"] : null) ??
    (sessionSets["session_start"]?.size ? sessionSets["session_start"] : null) ??
    new Set<string>();
  if (valid.size) {
    for (const t of Object.keys(sessionSets)) {
      sessionSets[t] = new Set([...sessionSets[t]].filter((sid) => valid.has(sid)));
    }
    leadDocCreated.sessions = new Set([...leadDocCreated.sessions].filter((sid) => valid.has(sid)));
    for (const s of leadSources) {
      leadSessionSets[s] = new Set([...leadSessionSets[s]].filter((sid) => valid.has(sid)));
      promptSessionSets[s] = new Set([...promptSessionSets[s]].filter((sid) => valid.has(sid)));
    }
    for (const b of confirmBuckets) {
      confirmShownSessionSets[b] = new Set([...confirmShownSessionSets[b]].filter((sid) => valid.has(sid)));
      confirmEmailClickSessionSets[b] = new Set([...confirmEmailClickSessionSets[b]].filter((sid) => valid.has(sid)));
      confirmRetailerClickSessionSets[b] = new Set([...confirmRetailerClickSessionSets[b]].filter((sid) => valid.has(sid)));
      confirmDismissSessionSets[b] = new Set([...confirmDismissSessionSets[b]].filter((sid) => valid.has(sid)));
      confirmPrimaryEmailSessionSets[b] = new Set([...confirmPrimaryEmailSessionSets[b]].filter((sid) => valid.has(sid)));
      confirmPrimaryRetailerSessionSets[b] = new Set([...confirmPrimaryRetailerSessionSets[b]].filter((sid) => valid.has(sid)));
      confirmPrimaryDismissSessionSets[b] = new Set([...confirmPrimaryDismissSessionSets[b]].filter((sid) => valid.has(sid)));
    }
    for (const v of confirmVariants) {
      shownSessByVar[v] = new Set([...shownSessByVar[v]].filter((sid) => valid.has(sid)));
      emailClickSessByVar[v] = new Set([...emailClickSessByVar[v]].filter((sid) => valid.has(sid)));
      retailerClickSessByVar[v] = new Set([...retailerClickSessByVar[v]].filter((sid) => valid.has(sid)));
      dismissSessByVar[v] = new Set([...dismissSessByVar[v]].filter((sid) => valid.has(sid)));
    }
  }

  // counts (sessions)
  const shownNew = confirmShownSessionSets.new.size;
  const shownRet = confirmShownSessionSets.returning.size;

  // CTRs (session-based)
  const emailCtrNew = pct(confirmEmailClickSessionSets.new.size, shownNew);
  const retailerCtrNew = pct(confirmRetailerClickSessionSets.new.size, shownNew);
  const dismissCtrNew = pct(confirmDismissSessionSets.new.size, shownNew);

  const emailCtrRet = pct(confirmEmailClickSessionSets.returning.size, shownRet);
  const retailerCtrRet = pct(confirmRetailerClickSessionSets.returning.size, shownRet);
  const dismissCtrRet = pct(confirmDismissSessionSets.returning.size, shownRet);

  const shownCountNew = confirmShownCounts.new;
  const shownCountRet = confirmShownCounts.returning;

  const primaryEmailShareNew = pct(confirmPrimaryEmailCounts.new, shownCountNew);
  const primaryRetailerShareNew = pct(confirmPrimaryRetailerCounts.new, shownCountNew);
  const primaryDismissShareNew = pct(confirmPrimaryDismissCounts.new, shownCountNew);

  const primaryEmailShareRet = pct(confirmPrimaryEmailCounts.returning, shownCountRet);
  const primaryRetailerShareRet = pct(confirmPrimaryRetailerCounts.returning, shownCountRet);
  const primaryDismissShareRet = pct(confirmPrimaryDismissCounts.returning, shownCountRet);

  const baseCheckout = sessionSets["checkout_open"]?.size ?? 0;
  const confirmShownRateNew = pct(shownNew, baseCheckout);
  const confirmShownRateRet = pct(shownRet, baseCheckout);

  const byType: Record<string, Stat> = {};
  for (const t of trackedTypes) {
    byType[t] = { count: counts[t] ?? 0, sessions: sessionSets[t]?.size ?? 0 };
  }

  const pairSessions: Record<PairKey, number> = {};
  for (const [numType, denType] of pairs) {
    pairSessions[pairKey(numType, denType)] = intersectionSize(
      sessionSets[numType] ?? new Set(),
      sessionSets[denType] ?? new Set()
    );
  }

  const leadBySource: Record<string, Stat> = {};
  for (const s of leadSources) {
    leadBySource[s] = { count: leadCounts[s] ?? 0, sessions: leadSessionSets[s]?.size ?? 0 };
  }

  const leadPairSessionsBySource: Record<string, { perCheckout: number; perBuy: number }> = {};
  for (const s of leadSources) {
    leadPairSessionsBySource[s] = {
      perCheckout: intersectionSize(leadSessionSets[s] ?? new Set(), sessionSets["checkout_open"] ?? new Set()),
      perBuy: intersectionSize(leadSessionSets[s] ?? new Set(), sessionSets["buy_click"] ?? new Set()),
    };
  }

  const promptBySource: Record<string, Stat> = {};
  for (const s of leadSources) {
    promptBySource[s] = { count: promptCounts[s] ?? 0, sessions: promptSessionSets[s]?.size ?? 0 };
  }

  const leadPerPromptSessionsBySource: Record<string, number> = {};
  for (const s of leadSources) {
    leadPerPromptSessionsBySource[s] = intersectionSize(
      leadSessionSets[s] ?? new Set(),
      promptSessionSets[s] ?? new Set()
    );
  }

  const emailByKind: Record<string, EmailKindStat> = {};
  for (const kind of Object.keys(emailByKindAgg)) {
    const agg = emailByKindAgg[kind];
    emailByKind[kind] = {
      sent: agg.sent,
      failed: agg.failed,
      returned: agg.returned,
      cleanReturned: agg.cleanReturned,
      uniqueSent: agg.uniqueSent.size,
      uniqueReturned: agg.uniqueReturned.size,
    };
  }

  const visibleEmailKinds = Object.keys(emailByKind)
    .filter((kind) => (emailByKind[kind].sent + emailByKind[kind].failed + emailByKind[kind].returned) > 0)
    .sort((a, b) => (emailByKind[b].sent - emailByKind[a].sent));

  const topEmailErrors = [...emailErrorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const confirmByBucket: Record<ConfirmBucket, ConfirmStats> = {
    new: {
      shown: { count: confirmShownCounts.new, sessions: shownNew },
      emailClick: { count: confirmEmailClickCounts.new, sessions: confirmEmailClickSessionSets.new.size },
      retailerClick: { count: confirmRetailerClickCounts.new, sessions: confirmRetailerClickSessionSets.new.size },
      dismiss: { count: confirmDismissCounts.new, sessions: confirmDismissSessionSets.new.size },
    },
    returning: {
      shown: { count: confirmShownCounts.returning, sessions: shownRet },
      emailClick: { count: confirmEmailClickCounts.returning, sessions: confirmEmailClickSessionSets.returning.size },
      retailerClick: { count: confirmRetailerClickCounts.returning, sessions: confirmRetailerClickSessionSets.returning.size },
      dismiss: { count: confirmDismissCounts.returning, sessions: confirmDismissSessionSets.returning.size },
    },
  };

  const confirmRatesByBucket: Record<ConfirmBucket, ConfirmRateStats> = {
    new: {
      shownRate: confirmShownRateNew,
      emailCtr: emailCtrNew,
      retailerCtr: retailerCtrNew,
      dismissCtr: dismissCtrNew,
      primaryEmailShare: primaryEmailShareNew,
      primaryRetailerShare: primaryRetailerShareNew,
      primaryDismissShare: primaryDismissShareNew,
    },
    returning: {
      shownRate: confirmShownRateRet,
      emailCtr: emailCtrRet,
      retailerCtr: retailerCtrRet,
      dismissCtr: dismissCtrRet,
      primaryEmailShare: primaryEmailShareRet,
      primaryRetailerShare: primaryRetailerShareRet,
      primaryDismissShare: primaryDismissShareRet,
    },
  };

  const confirmByVariantNew: Record<ConfirmVariant, ConfirmVariantNewStats> = {
    A: {
      shown: { count: shownCountsByVar.A, sessions: shownSessByVar.A.size },
      emailClick: { count: emailClickCountsByVar.A, sessions: emailClickSessByVar.A.size },
      retailerClick: { count: retailerClickCountsByVar.A, sessions: retailerClickSessByVar.A.size },
      dismiss: { count: dismissCountsByVar.A, sessions: dismissSessByVar.A.size },
      emailCtr: pct(emailClickSessByVar.A.size, shownSessByVar.A.size),
      retailerCtr: pct(retailerClickSessByVar.A.size, shownSessByVar.A.size),
      dismissCtr: pct(dismissSessByVar.A.size, shownSessByVar.A.size),
      primaryEmailShare: pct(primaryEmailCountsByVar.A, shownSessByVar.A.size),
      primaryRetailerShare: pct(primaryRetailerCountsByVar.A, shownSessByVar.A.size),
      primaryDismissShare: pct(primaryDismissCountsByVar.A, shownSessByVar.A.size),
    },
    B: {
      shown: { count: shownCountsByVar.B, sessions: shownSessByVar.B.size },
      emailClick: { count: emailClickCountsByVar.B, sessions: emailClickSessByVar.B.size },
      retailerClick: { count: retailerClickCountsByVar.B, sessions: retailerClickSessByVar.B.size },
      dismiss: { count: dismissCountsByVar.B, sessions: dismissSessByVar.B.size },
      emailCtr: pct(emailClickSessByVar.B.size, shownSessByVar.B.size),
      retailerCtr: pct(retailerClickSessByVar.B.size, shownSessByVar.B.size),
      dismissCtr: pct(dismissSessByVar.B.size, shownSessByVar.B.size),
      primaryEmailShare: pct(primaryEmailCountsByVar.B, shownSessByVar.B.size),
      primaryRetailerShare: pct(primaryRetailerCountsByVar.B, shownSessByVar.B.size),
      primaryDismissShare: pct(primaryDismissCountsByVar.B, shownSessByVar.B.size),
    },
  };

  return {
    byType,
    pairSessions,
    leadBySource,
    leadPairSessionsBySource,
    promptBySource,
    leadPerPromptSessionsBySource,
    leadDocCreated: {
      count: leadDocCreated.count,
      sessions: leadDocCreated.sessions.size,
    },
    emailPanel: {
      sent: {
        count: emailPanelCounts.email_sent,
        sessions: emailPanelSessionSets.email_sent.size,
      },
      failed: {
        count: emailPanelCounts.email_failed,
        sessions: emailPanelSessionSets.email_failed.size,
      },
      returned: {
        count: emailPanelCounts.email_return,
        sessions: emailPanelSessionSets.email_return.size,
      },
      cleanReturnCount: emailPanelCounts2.email_return_clean,
      openCheckoutCount: emailPanelCounts2.email_return_open_checkout,
      uniqueSentSids: emailPanelSidSets.email_sent.size,
      uniqueReturnSids: emailPanelSidSets.email_return.size,
    },
    emailByKind,
    visibleEmailKinds,
    topEmailErrors,
    utmReturnSessions: {
      emailLeadCartLinks: emailLeadReturnSessionSet.size,
    },
    confirmByBucket,
    confirmRatesByBucket,
    confirmByVariantNew,
  };
}

export default function AdminScreen({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sanityLoggedRef = useRef(false);
  const [recent, setRecent] = useState<AdminEventRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentErr, setRecentErr] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const since = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return Timestamp.fromDate(d);
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError(null);

    try {
      await ensureUserReady();
      const res = await fetchAllStatsSince(since, TYPES_FOR_STATS, pairs);
      setStats(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
    });

    ensureUser()
      .catch((e) => {
        console.warn("[admin] ensureUser failed", e);
        setAuthErr(e?.message ?? "Auth failed");
      });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setRecentLoading(true);
      setRecentErr(null);
      try {
        const rows = await fetchRecentEvents(50);
        if (mounted) setRecent(rows);
      } catch (e: any) {
        if (mounted) setRecentErr(e?.message ?? "Failed to load recent events");
      } finally {
        if (mounted) setRecentLoading(false);
      }
    }

    if (uid) void run();
    return () => {
      mounted = false;
    };
  }, [uid]);

  const byType = stats?.byType ?? {};
  const pairSessions = stats?.pairSessions ?? ({} as Record<PairKey, number>);
  const leadBySource = stats?.leadBySource ?? {};
  const leadPairsBySource = stats?.leadPairSessionsBySource ?? {};
  const promptBySource = stats?.promptBySource ?? {};
  const leadPerPromptSessionsBySource = stats?.leadPerPromptSessionsBySource ?? {};
  const leadDocCreated = stats?.leadDocCreated ?? { count: 0, sessions: 0 };
  const emailPanel = stats?.emailPanel ?? {
    sent: { count: 0, sessions: 0 },
    failed: { count: 0, sessions: 0 },
    returned: { count: 0, sessions: 0 },
    cleanReturnCount: 0,
    openCheckoutCount: 0,
    uniqueSentSids: 0,
    uniqueReturnSids: 0,
  };
  const emailByKind = stats?.emailByKind ?? ({} as Record<string, EmailKindStat>);
  const visibleEmailKinds = stats?.visibleEmailKinds ?? [];
  const topEmailErrors = stats?.topEmailErrors ?? [];
  const utmReturnSessions = stats?.utmReturnSessions ?? {
    emailLeadCartLinks: 0,
  };
  const confirmByBucket = stats?.confirmByBucket ?? {
    new: {
      shown: { count: 0, sessions: 0 },
      emailClick: { count: 0, sessions: 0 },
      retailerClick: { count: 0, sessions: 0 },
      dismiss: { count: 0, sessions: 0 },
    },
    returning: {
      shown: { count: 0, sessions: 0 },
      emailClick: { count: 0, sessions: 0 },
      retailerClick: { count: 0, sessions: 0 },
      dismiss: { count: 0, sessions: 0 },
    },
  };
  const confirmRatesByBucket = stats?.confirmRatesByBucket ?? {
    new: {
      shownRate: "—",
      emailCtr: "—",
      retailerCtr: "—",
      dismissCtr: "—",
      primaryEmailShare: "—",
      primaryRetailerShare: "—",
      primaryDismissShare: "—",
    },
    returning: {
      shownRate: "—",
      emailCtr: "—",
      retailerCtr: "—",
      dismissCtr: "—",
      primaryEmailShare: "—",
      primaryRetailerShare: "—",
      primaryDismissShare: "—",
    },
  };
  const confirmVariants: Array<"A" | "B"> = ["A", "B"];
  const confirmByVariantNew = stats?.confirmByVariantNew ?? {
    A: {
      shown: { count: 0, sessions: 0 },
      emailClick: { count: 0, sessions: 0 },
      retailerClick: { count: 0, sessions: 0 },
      dismiss: { count: 0, sessions: 0 },
      emailCtr: "—",
      retailerCtr: "—",
      dismissCtr: "—",
      primaryEmailShare: "—",
      primaryRetailerShare: "—",
      primaryDismissShare: "—",
    },
    B: {
      shown: { count: 0, sessions: 0 },
      emailClick: { count: 0, sessions: 0 },
      retailerClick: { count: 0, sessions: 0 },
      dismiss: { count: 0, sessions: 0 },
      emailCtr: "—",
      retailerCtr: "—",
      dismissCtr: "—",
      primaryEmailShare: "—",
      primaryRetailerShare: "—",
      primaryDismissShare: "—",
    },
  };

  const sess = (t: string) => byType[t]?.sessions ?? 0;
  const ev = (t: string) => byType[t]?.count ?? 0;

  function sessNum(num: string, den: string) {
    return pairSessions[pairKey(num, den)] ?? 0;
  }

  const openRate     = pct(sessNum("product_open", "card_impression"), sess("card_impression"));
  const saveRate     = pct(sessNum("wishlist_add", "card_impression"), sess("card_impression"));
  const bagRate      = pct(sessNum("cart_add", "card_impression"), sess("card_impression"));
  const checkoutRate = pct(sessNum("checkout_open", "cart_add"), sess("cart_add"));
  const outboundRate = pct(sessNum("checkout_item_open", "checkout_open"), sess("checkout_open"));
  const buyRate      = pct(sessNum("buy_click", "checkout_open"), sess("checkout_open"));
  const leadRate     = pct(sessNum("lead_submit", "checkout_open"), sess("checkout_open"));
  const emailSentRate = pct(emailPanel.sent.count, ev("lead_submit"));
  const emailSentPipelineRate = pct(emailPanel.sent.count, leadDocCreated.count);
  const emailFailRate = pct(emailPanel.failed.count, ev("lead_submit"));
  const emailFailPipelineRate = pct(emailPanel.failed.count, leadDocCreated.count);
  const emailReturnPerSentRate = pct(emailPanel.returned.count, emailPanel.sent.count);
  const cleanEmailReturnPerSentRate = pct(emailPanel.cleanReturnCount, emailPanel.sent.count);
  const emailReturnOpenCheckoutRate = pct(emailPanel.openCheckoutCount, emailPanel.returned.count);
  const uniqueEmailReturnPerSentRate = pct(emailPanel.uniqueReturnSids, emailPanel.uniqueSentSids);
  const leadPerBuy   = pct(sessNum("lead_submit", "buy_click"), sess("buy_click"));
  const leadPerBuy_cartConfirm = pct(leadPairsBySource["cart_confirm"]?.perBuy ?? 0, sess("buy_click"));
  const leadPerBuy_postBuyPanel = pct(leadPairsBySource["post_buy_panel"]?.perBuy ?? 0, sess("buy_click"));
  const leadRate_cartConfirm = pct(leadPairsBySource["cart_confirm"]?.perCheckout ?? 0, sess("checkout_open"));
  const leadRate_postBuyPanel = pct(leadPairsBySource["post_buy_panel"]?.perCheckout ?? 0, sess("checkout_open"));
  const promptSess = (s: string) => promptBySource[s]?.sessions ?? 0;
  const promptSess_roomscan = promptSess("roomscan");
  const leadPerPrompt_cartConfirm = pct(leadPerPromptSessionsBySource["cart_confirm"] ?? 0, promptSess("cart_confirm"));
  const leadPerPrompt_postBuyPanel = pct(leadPerPromptSessionsBySource["post_buy_panel"] ?? 0, promptSess("post_buy_panel"));
  const leadPerPrompt_roomscan = pct(leadPerPromptSessionsBySource["roomscan"] ?? 0, promptSess("roomscan"));
  const promptNum = (s: string) => leadPerPromptSessionsBySource[s] ?? 0;
  const promptDen = (s: string) => promptSess(s) ?? 0;

  const leadPerPromptText = (s: string) =>
    `${pct(promptNum(s), promptDen(s))} (${promptNum(s)}/${promptDen(s)})`;

  const leadPerPrompt_cartConfirm_txt = leadPerPromptText("cart_confirm");
  const leadPerPrompt_postBuyPanel_txt = leadPerPromptText("post_buy_panel");
  const leadPerPrompt_roomscan_txt = leadPerPromptText("roomscan");

  const shownNew = confirmByBucket.new.shown.sessions;
  const shownRet = confirmByBucket.returning.shown.sessions;
  const confirmShownRateNew = confirmRatesByBucket.new.shownRate;
  const confirmShownRateRet = confirmRatesByBucket.returning.shownRate;
  const emailCtrNew = confirmRatesByBucket.new.emailCtr;
  const retailerCtrNew = confirmRatesByBucket.new.retailerCtr;
  const dismissCtrNew = confirmRatesByBucket.new.dismissCtr;
  const primaryEmailShareNew = confirmRatesByBucket.new.primaryEmailShare;
  const primaryRetailerShareNew = confirmRatesByBucket.new.primaryRetailerShare;
  const primaryDismissShareNew = confirmRatesByBucket.new.primaryDismissShare;
  const emailCtrRet = confirmRatesByBucket.returning.emailCtr;
  const retailerCtrRet = confirmRatesByBucket.returning.retailerCtr;
  const dismissCtrRet = confirmRatesByBucket.returning.dismissCtr;
  const primaryEmailShareRet = confirmRatesByBucket.returning.primaryEmailShare;
  const primaryRetailerShareRet = confirmRatesByBucket.returning.primaryRetailerShare;
  const primaryDismissShareRet = confirmRatesByBucket.returning.primaryDismissShare;

  const scanSuccess  = pct(sessNum("scan_success", "session_start"), sess("session_start"));
  const pickSave     = pct(sessNum("pick_save", "pick_impression"), sess("pick_impression"));
  const pickDismiss  = pct(sessNum("pick_dismiss", "pick_impression"), sess("pick_impression"));

  const applyRate    = pct(sessNum("scan_apply", "scan_success"), sess("scan_success"));
  const shareRate    = pct(sessNum("share_click", "scan_apply"), sess("scan_apply"));
  const leadFromScan = pct(sessNum("lead_submit", "scan_apply"), sess("scan_apply"));
  const emailReturnSessions = utmReturnSessions.emailLeadCartLinks;
  const emailReturnRate = pct(emailReturnSessions, sess("session_start"));

  useEffect(() => {
    if (sanityLoggedRef.current) return;
    if (!stats) return;

    console.log("SANITY", {
      cardSess: sess("card_impression"),
      cartSess: sess("cart_add"),
      cartWithinCards: sessNum("cart_add", "card_impression"),
    });

    sanityLoggedRef.current = true;
  }, [stats]);

  return (
    <div className="p-6 bg-white min-h-full">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-2xl font-extrabold text-slate-900">Admin</div>
          <div className="text-sm text-slate-500 mt-1">Last 7 days • session-based funnel</div>
          <div className="text-xs text-slate-500 mt-1">
            uid: <span className="font-mono">{uid ?? "…"}</span>
            {authErr ? <span className="ml-2 text-rose-600">{authErr}</span> : null}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="h-10 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 font-extrabold text-sm"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={onBack}
            className="h-10 w-10 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-black"
            aria-label="Back"
          >
            ✕
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl bg-rose-50 border border-rose-100 p-4 text-rose-700 text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl border border-slate-100 bg-slate-50 p-5">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Sessions</div>
          <div className="text-3xl font-black text-slate-900 mt-2">{sess("session_start")}</div>
          <div className="text-xs text-slate-500 mt-1">unique sessionId</div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-slate-50 p-5">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Impression sessions</div>
          <div className="text-3xl font-black text-slate-900 mt-2">{sess("card_impression")}</div>
          <div className="text-xs text-slate-500 mt-1">unique sessionId</div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
        <div className="text-sm font-extrabold text-slate-900 mb-3">Feed funnel (session rates)</div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Open rate (product_open / card_impression)</span>
            <span className="font-black text-slate-900">{openRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Save rate (wishlist_add / card_impression)</span>
            <span className="font-black text-slate-900">{saveRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Bag rate (cart_add / card_impression)</span>
            <span className="font-black text-slate-900">{bagRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Checkout rate (checkout_open / cart_add)</span>
            <span className="font-black text-slate-900">{checkoutRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Outbound rate (checkout_item_open / checkout_open)</span>
            <span className="font-black text-slate-900">{outboundRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Buy click rate (buy_click / checkout_open)</span>
            <span className="font-black text-slate-900">{buyRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead rate (lead_submit / checkout_open)</span>
            <span className="font-black text-slate-900">{leadRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email sent rate (email_sent / lead_submit)</span>
            <span className="font-black text-slate-900">{emailSentRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email sent rate (pipeline: email_sent / lead_doc_created)</span>
            <span className="font-black text-slate-900">{emailSentPipelineRate}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Counts</span>
            <span className="font-bold">{emailPanel.sent.count} / {leadDocCreated.count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email failure rate (email_failed / lead_submit)</span>
            <span className="font-black text-slate-900">{emailFailRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email failure rate (pipeline: email_failed / lead_doc_created)</span>
            <span className="font-black text-slate-900">{emailFailPipelineRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email return rate (email_return / email_sent)</span>
            <span className="font-black text-slate-900">{emailReturnPerSentRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Clean return rate (tracked email_return / email_sent)</span>
            <span className="font-black text-slate-900">{cleanEmailReturnPerSentRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Unique return rate (distinct email_return.sid / email_sent.sid)</span>
            <span className="font-black text-slate-900">{uniqueEmailReturnPerSentRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Return → checkout rate (email_return_open_checkout / email_return)</span>
            <span className="font-black text-slate-900">{emailReturnOpenCheckoutRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead rate (cart_confirm / checkout_open)</span>
            <span className="font-black text-slate-900">{leadRate_cartConfirm}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead rate (post_buy_panel / checkout_open)</span>
            <span className="font-black text-slate-900">{leadRate_postBuyPanel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per buy (cart_confirm / buy_click)</span>
            <span className="font-black text-slate-900">{leadPerBuy_cartConfirm}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per buy (post_buy_panel / buy_click)</span>
            <span className="font-black text-slate-900">{leadPerBuy_postBuyPanel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per prompt (cart_confirm / prompt_shown)</span>
            <span className="font-black text-slate-900">{leadPerPrompt_cartConfirm_txt}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per prompt (post_buy_panel / prompt_shown)</span>
            <span className="font-black text-slate-900">{leadPerPrompt_postBuyPanel_txt}</span>
          </div>
          {promptSess_roomscan > 0 ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Lead per prompt (roomscan / prompt_shown)</span>
              <span className="font-black text-slate-900">{leadPerPrompt_roomscan_txt}</span>
            </div>
          ) : null}

          <div className="mt-3 pt-3 border-t border-slate-100" />
          <div className="flex justify-between">
            <span className="text-slate-600">Confirm shown (new)</span>
            <span className="font-black text-slate-900">{shownNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Confirm shown rate (new)</span>
            <span className="font-black text-slate-900">{confirmShownRateNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email CTR (new)</span>
            <span className="font-black text-slate-900">{emailCtrNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Retailer CTR (new)</span>
            <span className="font-black text-slate-900">{retailerCtrNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (per confirm, new): Email</span>
            <span className="font-black text-slate-900">{primaryEmailShareNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (per confirm, new): Retailer</span>
            <span className="font-black text-slate-900">{primaryRetailerShareNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (per confirm, new): Dismiss</span>
            <span className="font-black text-slate-900">{primaryDismissShareNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Dismiss rate (new)</span>
            <span className="font-black text-slate-900">{dismissCtrNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Confirm shown (returning)</span>
            <span className="font-black text-slate-900">{shownRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Confirm shown rate (returning)</span>
            <span className="font-black text-slate-900">{confirmShownRateRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email CTR (returning)</span>
            <span className="font-black text-slate-900">{emailCtrRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Retailer CTR (returning)</span>
            <span className="font-black text-slate-900">{retailerCtrRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (per confirm, returning): Email</span>
            <span className="font-black text-slate-900">{primaryEmailShareRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (per confirm, returning): Retailer</span>
            <span className="font-black text-slate-900">{primaryRetailerShareRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (per confirm, returning): Dismiss</span>
            <span className="font-black text-slate-900">{primaryDismissShareRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Dismiss rate (returning)</span>
            <span className="font-black text-slate-900">{dismissCtrRet}</span>
          </div>
        </div>
      </div>

        <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-3">Variant A vs B (New users)</div>

          <div className="grid gap-4 md:grid-cols-2">
            {confirmVariants.map((variant) => {
              const statsForVariant = confirmByVariantNew[variant];

              return (
                <div key={variant} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-black text-slate-900">Variant {variant}</span>
                    <span className="text-xs font-bold text-slate-500">shown {statsForVariant.shown.sessions} sessions</span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Shown sessions</span>
                      <span className="font-black text-slate-900">{statsForVariant.shown.sessions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Email CTR</span>
                      <span className="font-black text-slate-900">{statsForVariant.emailCtr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Retailer CTR</span>
                      <span className="font-black text-slate-900">{statsForVariant.retailerCtr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Dismiss CTR</span>
                      <span className="font-black text-slate-900">{statsForVariant.dismissCtr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Primary email share</span>
                      <span className="font-black text-slate-900">{statsForVariant.primaryEmailShare}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Primary retailer share</span>
                      <span className="font-black text-slate-900">{statsForVariant.primaryRetailerShare}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Primary dismiss share</span>
                      <span className="font-black text-slate-900">{statsForVariant.primaryDismissShare}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
        <div className="text-sm font-extrabold text-slate-900 mb-3">RoomScan (session rates)</div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Scan success (scan_success / session_start)</span>
            <span className="font-black text-slate-900">{scanSuccess}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pick save rate (pick_save / pick_impression)</span>
            <span className="font-black text-slate-900">{pickSave}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pick dismiss rate (pick_dismiss / pick_impression)</span>
            <span className="font-black text-slate-900">{pickDismiss}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-100 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-3">Email KPIs By Kind</div>

          <div className="space-y-3 text-sm">
            {visibleEmailKinds.length ? visibleEmailKinds.map((kind) => {
              const statsForKind = emailByKind[kind];
              return (
                <div key={kind} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-black text-slate-900 capitalize">{kind}</span>
                    <span className="text-xs font-bold text-slate-500">sent {statsForKind.sent}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Failures</span>
                      <span className="font-black text-slate-900">{statsForKind.failed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Returns</span>
                      <span className="font-black text-slate-900">{statsForKind.returned}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Clean returns</span>
                      <span className="font-black text-slate-900">{statsForKind.cleanReturned}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Return rate</span>
                      <span className="font-black text-slate-900">{pct(statsForKind.returned, statsForKind.sent)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Unique return rate</span>
                      <span className="font-black text-slate-900">{pct(statsForKind.uniqueReturned, statsForKind.uniqueSent)}</span>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="text-sm text-slate-500">No email events in range.</div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white p-5">
          <div className="text-sm font-extrabold text-slate-900 mb-3">Top Email Errors</div>

          <div className="space-y-3 text-sm">
            {topEmailErrors.length ? topEmailErrors.map((row) => (
              <div key={row.message} className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                <div className="flex justify-between items-start gap-3">
                  <span className="text-rose-900 break-words">{row.message}</span>
                  <span className="shrink-0 font-black text-rose-700">{row.count}</span>
                </div>
              </div>
            )) : (
              <div className="text-sm text-slate-500">No email failures in range.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
        <div className="text-sm font-extrabold text-slate-900 mb-3">Viral loop (session rates)</div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Apply rate (scan_apply / scan_success)</span>
            <span className="font-black text-slate-900">{applyRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Share rate (share_click / scan_apply)</span>
            <span className="font-black text-slate-900">{shareRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead from scan (lead_submit / scan_apply)</span>
            <span className="font-black text-slate-900">{leadFromScan}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email return sessions (utm: email / lead / cart_links)</span>
            <span className="font-black text-slate-900">{emailReturnSessions}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Email return rate (utm sessions / session_start)</span>
            <span className="font-black text-slate-900">{emailReturnRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per buy (lead_submit / buy_click)</span>
            <span className="font-black text-slate-900">{leadPerBuy}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per buy (cart_confirm)</span>
            <span className="font-black text-slate-900">{leadPerBuy_cartConfirm}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead per buy (post_buy_panel)</span>
            <span className="font-black text-slate-900">{leadPerBuy_postBuyPanel}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-slate-50 p-5">
        <div className="text-[12px] font-extrabold text-slate-900 mb-2">Raw counts (events)</div>
        <div className="grid grid-cols-2 gap-2 text-[12px] text-slate-600">
          {TYPES.map((t) => (
            <div key={t} className="flex justify-between">
              <span className="truncate">{t}</span>
              <span className="font-black text-slate-900">{ev(t)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <div className="font-semibold text-slate-900">Recent events (last 50)</div>
          <div className="text-xs text-slate-500">This is the truth-table for what’s firing.</div>
        </div>

        <div className="p-4">
          {recentLoading && <div className="text-sm text-slate-600">Loading…</div>}
          {recentErr && <div className="text-sm text-red-600">{recentErr}</div>}

          {!recentLoading && !recentErr && (
            <div className="space-y-2">
              {recent.map((ev) => (
                <div key={ev.id} className="text-xs rounded-2xl border border-slate-100 p-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="text-slate-500">{fmtCreatedAt(ev.createdAt)}</span>
                    <span className="font-semibold text-slate-900">{ev.type ?? "—"}</span>
                    <span className="text-slate-600">view:{ev.view ?? "—"}</span>
                    <span className="text-slate-600">src:{ev.source ?? "—"}</span>
                  </div>
                  <div className="mt-1 text-slate-600 break-all">
                    session:{ev.sessionId ?? "—"} · product:{ev.productId ?? "—"}
                    {ev.meta?.url ? <> · url:{String(ev.meta.url)}</> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
