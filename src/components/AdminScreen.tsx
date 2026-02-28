import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db } from "../../firebase";
import { ensureUser } from "../../firestoreService";

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
  if (!den) return "—";
  return `${Math.round((num / den) * 1000) / 10}%`;
}

async function fetchAllStatsSince(since: Timestamp, types: string[]): Promise<Record<string, Stat>> {
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

  const out: Record<string, Stat> = {};
  for (const t of types) {
    out[t] = { count: counts[t] ?? 0, sessions: sessionSets[t]?.size ?? 0 };
  }
  return out;
}

export default function AdminScreen({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [error, setError] = useState<string | null>(null);

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
      const map = await fetchAllStatsSince(since, TYPES);
      setStats(map);
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

  const s = (k: EventType) => stats[k]?.sessions ?? 0;
  const c = (k: EventType) => stats[k]?.count ?? 0;

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
          <div className="text-3xl font-black text-slate-900 mt-2">{s("session_start")}</div>
          <div className="text-xs text-slate-500 mt-1">unique sessionId</div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-slate-50 p-5">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Impression sessions</div>
          <div className="text-3xl font-black text-slate-900 mt-2">{s("card_impression")}</div>
          <div className="text-xs text-slate-500 mt-1">unique sessionId</div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
        <div className="text-sm font-extrabold text-slate-900 mb-3">Feed funnel (session rates)</div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Open rate (product_open / card_impression)</span>
            <span className="font-black text-slate-900">{pct(s("product_open"), s("card_impression"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Save rate (wishlist_add / card_impression)</span>
            <span className="font-black text-slate-900">{pct(s("wishlist_add"), s("card_impression"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Bag rate (cart_add / card_impression)</span>
            <span className="font-black text-slate-900">{pct(s("cart_add"), s("card_impression"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Checkout rate (checkout_open / cart_add)</span>
            <span className="font-black text-slate-900">{pct(s("checkout_open"), s("cart_add"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Outbound rate (checkout_item_open / checkout_open)</span>
            <span className="font-black text-slate-900">{pct(s("checkout_item_open"), s("checkout_open"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Buy click rate (buy_click / checkout_open)</span>
            <span className="font-black text-slate-900">{pct(s("buy_click"), s("checkout_open"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead rate (lead_submit / checkout_open)</span>
            <span className="font-black text-slate-900">{pct(s("lead_submit"), s("checkout_open"))}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
        <div className="text-sm font-extrabold text-slate-900 mb-3">RoomScan (session rates)</div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Scan success (scan_success / session_start)</span>
            <span className="font-black text-slate-900">{pct(s("scan_success"), s("session_start"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pick save rate (pick_save / pick_impression)</span>
            <span className="font-black text-slate-900">{pct(s("pick_save"), s("pick_impression"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pick dismiss rate (pick_dismiss / pick_impression)</span>
            <span className="font-black text-slate-900">{pct(s("pick_dismiss"), s("pick_impression"))}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-5">
        <div className="text-sm font-extrabold text-slate-900 mb-3">Viral loop (session rates)</div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Apply rate (scan_apply / scan_success)</span>
            <span className="font-black text-slate-900">{pct(s("scan_apply"), s("scan_success"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Share rate (share_click / scan_apply)</span>
            <span className="font-black text-slate-900">{pct(s("share_click"), s("scan_apply"))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Lead from scan (lead_submit / scan_apply)</span>
            <span className="font-black text-slate-900">{pct(s("lead_submit"), s("scan_apply"))}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-100 bg-slate-50 p-5">
        <div className="text-[12px] font-extrabold text-slate-900 mb-2">Raw counts (events)</div>
        <div className="grid grid-cols-2 gap-2 text-[12px] text-slate-600">
          {TYPES.map((t) => (
            <div key={t} className="flex justify-between">
              <span className="truncate">{t}</span>
              <span className="font-black text-slate-900">{stats[t]?.count ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
