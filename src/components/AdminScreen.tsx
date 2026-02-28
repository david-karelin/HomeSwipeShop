import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db, ensureUser } from "../../firestoreService";
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
  ["scan_success", "session_start"],
  ["scan_apply", "scan_success"],
  ["share_click", "scan_apply"],
  ["lead_submit", "scan_apply"],
  ["pick_save", "pick_impression"],
  ["pick_dismiss", "pick_impression"],
 ] as const;

async function fetchAllStatsSince(
  since: Timestamp,
  types: string[],
  pairs: ReadonlyArray<readonly [string, string]>
): Promise<{
  byType: Record<string, Stat>;
  pairSessions: Record<PairKey, number>;
}> {
  const allowed = new Set(types);

  const counts: Record<string, number> = {};
  const sessionSets: Record<string, Set<string>> = {};
  for (const t of types) {
    counts[t] = 0;
    sessionSets[t] = new Set<string>();
  }

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
  });

  const byType: Record<string, Stat> = {};
  for (const t of types) {
    byType[t] = { count: counts[t] ?? 0, sessions: sessionSets[t]?.size ?? 0 };
  }

  const pairSessions: Record<PairKey, number> = {};
  for (const [numType, denType] of pairs) {
    pairSessions[pairKey(numType, denType)] = intersectionSize(
      sessionSets[numType] ?? new Set(),
      sessionSets[denType] ?? new Set()
    );
  }

  return { byType, pairSessions };
}

export default function AdminScreen({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sanityLoggedRef = useRef(false);
  const [recent, setRecent] = useState<AdminEventRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentErr, setRecentErr] = useState<string | null>(null);

  const since = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return Timestamp.fromDate(d);
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError(null);

    try {
      await ensureUser();
      const res = await fetchAllStatsSince(since, TYPES, pairs);
      setStats(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const byType = stats?.byType ?? {};
  const pairSessions = stats?.pairSessions ?? ({} as Record<PairKey, number>);

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
