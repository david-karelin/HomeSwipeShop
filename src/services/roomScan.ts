import { httpsCallable } from "firebase/functions";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, functions, storage } from "../../firebase";

export type RoomScanAnalysis = {
  oneSentenceSummary: string;
  vibeTags: string[];
  recommendedTags: string[];
  recommendedCategories: string[];
  avoidTags: string[];
};


export async function createRoomScanDoc(uid: string, roomText: string): Promise<string> {
  const ref = await addDoc(collection(db, "users", uid, "roomScans"), {
    roomText: roomText.trim(),
    createdAt: serverTimestamp(),
    status: "processing",
  });
  return ref.id;
}

export async function uploadRoomScanImage(uid: string, scanId: string, file: File): Promise<{ imagePath: string; imageUrl: string }> {
  const safeName = file.name.replace(/\s+/g, "-");
  const imagePath = `roomScans/${uid}/${scanId}/${Date.now()}-${safeName}`;
  const imageRef = ref(storage, imagePath);
  await uploadBytes(imageRef, file, { contentType: file.type || "image/png" });
  const imageUrl = await getDownloadURL(imageRef);
  return { imagePath, imageUrl };
}

export async function attachRoomScanImage(uid: string, scanId: string, imagePath: string, imageUrl: string): Promise<void> {
  await setDoc(
    doc(db, "users", uid, "roomScans", scanId),
    {
      imagePath,
      imageUrl,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function callAnalyzeRoomScan(
  scanId: string,
  roomText: string,
  imageDataUrl?: string | null
): Promise<RoomScanAnalysis> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");

  const fn = httpsCallable(functions, "analyzeRoomScan", { timeout: 20000 });
  const res = await fn({ scanId, roomText, imageDataUrl: imageDataUrl ?? null });
  return (res.data as any)?.analysis as RoomScanAnalysis;
}
