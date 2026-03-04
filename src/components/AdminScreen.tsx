import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db, ensureUser, ensureUserReady } from "../../firestoreService";
import { auth } from "../../firebase";
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

type PairKey = `${string}|${string}`;

type StatsState = {
  byType: Record<string, Stat>;
  pairSessions: Record<PairKey, number>;
  leadBySource: Record<string, Stat>;
  leadPairSessionsBySource: Record<string, { perCheckout: number; perBuy: number }>;
  promptBySource: Record<string, Stat>;
  leadPerPromptSessionsBySource: Record<string, number>;
  confirmByBucket: Record<ConfirmBucket, {
    shown: Stat;
    emailClick: Stat;
    retailerClick: Stat;
    dismiss: Stat;
  }>;
  confirmRatesByBucket: Record<ConfirmBucket, {
    shownRate: string;
    emailCtr: string;
    retailerCtr: string;
    dismissCtr: string;
    primaryEmailShare: string;
    primaryRetailerShare: string;
    primaryDismissShare: string;
  }>;
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

async function fetchAllStatsSince(
  since: Timestamp,
  types: string[],
  pairs: ReadonlyArray<readonly [string, string]>
): Promise<{
  byType: Record<string, Stat>;
  pairSessions: Record<PairKey, number>;
  leadBySource: Record<string, Stat>;
  leadPairSessionsBySource: Record<string, { perCheckout: number; perBuy: number }>;
  promptBySource: Record<string, Stat>;
  leadPerPromptSessionsBySource: Record<string, number>;
  confirmByBucket: Record<ConfirmBucket, {
    shown: Stat;
    emailClick: Stat;
    retailerClick: Stat;
    dismiss: Stat;
  }>;
  confirmRatesByBucket: Record<ConfirmBucket, {
    shownRate: string;
    emailCtr: string;
    retailerCtr: string;
    dismissCtr: string;
    primaryEmailShare: string;
    primaryRetailerShare: string;
    primaryDismissShare: string;
  }>;
}> {
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

  const qy = query(
    collection(db, "events"),
    where("createdAt", ">=", since),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(qy);

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

      if (panel === "lead_prompt_shown" && leadSourceSet.has(src)) {
        promptCounts[src] += 1;
        promptSessionSets[src].add(sid);
      }

      if (src === "cart_confirm") {
        const preferRetailer = meta?.preferRetailer === 1 || meta?.preferRetailer === true;
        const bucket: ConfirmBucket = preferRetailer ? "returning" : "new";

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

  const primaryTotalNew =
    confirmPrimaryEmailSessionSets.new.size +
    confirmPrimaryRetailerSessionSets.new.size +
    confirmPrimaryDismissSessionSets.new.size;
  const primaryTotalRet =
    confirmPrimaryEmailSessionSets.returning.size +
    confirmPrimaryRetailerSessionSets.returning.size +
    confirmPrimaryDismissSessionSets.returning.size;
  const primaryEmailShareNew = pct(confirmPrimaryEmailSessionSets.new.size, primaryTotalNew);
  const primaryRetailerShareNew = pct(confirmPrimaryRetailerSessionSets.new.size, primaryTotalNew);
  const primaryDismissShareNew = pct(confirmPrimaryDismissSessionSets.new.size, primaryTotalNew);
  const primaryEmailShareRet = pct(confirmPrimaryEmailSessionSets.returning.size, primaryTotalRet);
  const primaryRetailerShareRet = pct(confirmPrimaryRetailerSessionSets.returning.size, primaryTotalRet);
  const primaryDismissShareRet = pct(confirmPrimaryDismissSessionSets.returning.size, primaryTotalRet);

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

  const confirmByBucket: Record<ConfirmBucket, {
    shown: Stat;
    emailClick: Stat;
    retailerClick: Stat;
    dismiss: Stat;
  }> = {
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

  const confirmRatesByBucket: Record<ConfirmBucket, {
    shownRate: string;
    emailCtr: string;
    retailerCtr: string;
    dismissCtr: string;
    primaryEmailShare: string;
    primaryRetailerShare: string;
    primaryDismissShare: string;
  }> = {
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

  return {
    byType,
    pairSessions,
    leadBySource,
    leadPairSessionsBySource,
    promptBySource,
    leadPerPromptSessionsBySource,
    confirmByBucket,
    confirmRatesByBucket,
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
            <span className="text-slate-600">Primary choice share (new): Email</span>
            <span className="font-black text-slate-900">{primaryEmailShareNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (new): Retailer</span>
            <span className="font-black text-slate-900">{primaryRetailerShareNew}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (new): Dismiss</span>
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
            <span className="text-slate-600">Primary choice share (returning): Email</span>
            <span className="font-black text-slate-900">{primaryEmailShareRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (returning): Retailer</span>
            <span className="font-black text-slate-900">{primaryRetailerShareRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Primary choice share (returning): Dismiss</span>
            <span className="font-black text-slate-900">{primaryDismissShareRet}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Dismiss rate (returning)</span>
            <span className="font-black text-slate-900">{dismissCtrRet}</span>
          </div>
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
