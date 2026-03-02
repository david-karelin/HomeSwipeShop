import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { getApp } from "firebase/app";
import { db } from "../../firebase";
import { auth } from "../../firebase";
import { ensureUserReady } from "../../firestoreService";

export type AdminEventRow = {
  id: string;
  type?: string;
  view?: string;
  source?: string;
  productId?: string | null;
  sessionId?: string;
  createdAt?: any;
  meta?: any;
  utm?: any;
  purchaseUrl?: string;
};

export async function fetchRecentEvents(n = 50): Promise<AdminEventRow[]> {
  try {
    const u = await ensureUserReady();
    console.log("[admin] uid for query:", u.uid);
    console.log("[admin] auth.currentUser:", auth.currentUser?.uid);
    console.log("[admin] projectId:", getApp().options.projectId);

    const q = query(collection(db, "events"), orderBy("createdAt", "desc"), limit(n));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  } catch (e: any) {
    console.warn("[admin] fetchRecentEvents failed", e?.code, e?.message, e);
    throw e;
  }
}

export function fmtCreatedAt(createdAt: any) {
  try {
    if (!createdAt) return "—";
    const dt = typeof createdAt.toDate === "function" ? createdAt.toDate() : new Date(createdAt);
    return dt.toLocaleString();
  } catch {
    return "—";
  }
}
