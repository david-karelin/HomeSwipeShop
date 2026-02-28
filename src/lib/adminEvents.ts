import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";

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
  const q = query(collection(db, "events"), orderBy("createdAt", "desc"), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
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
