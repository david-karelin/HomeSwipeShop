import { GoogleGenAI } from "@google/genai";

const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || "";

export type GeminiRoomAnalysis = {
  roomType: string;
  dominantColors: string[];
  styleKeywords: string[];
  furnitureDetected: string[];
  missingItems: string[];
  lightingCondition: string;
  overallVibe: string;
  productCategoryMatches: Array<{
    category: string;
    reason: string;
    keywords: string[];
    priority: number;
  }>;
  oneSentenceSummary: string;
};

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ANALYSIS_PROMPT = `Analyze this room photo for a home decor shopping app. Respond in JSON only, using this exact structure:

{
  "roomType": "bedroom|living room|home office|bathroom|dining room|hallway|other",
  "dominantColors": ["e.g. warm beige", "e.g. dark wood", "e.g. navy blue"],
  "styleKeywords": ["e.g. minimalist", "e.g. Scandinavian", "e.g. cozy"],
  "furnitureDetected": ["e.g. bed", "e.g. desk", "e.g. bookshelf"],
  "missingItems": ["e.g. task lamp", "e.g. wall art", "e.g. throw blanket"],
  "lightingCondition": "bright natural|dim|warm artificial|cool artificial|mixed",
  "overallVibe": "one descriptive phrase, e.g. 'clean minimal workspace with warm undertones'",
  "productCategoryMatches": [
    {
      "category": "lighting|wall-decor|plants|storage|mirrors|desk-setup|cozy-bedroom|shelf-styling|small-space-fixes|under-50",
      "reason": "Specific, visual reason this category fits this exact room. Reference actual colors, gaps, or furniture seen.",
      "keywords": ["tag1", "tag2"],
      "priority": 1
    }
  ],
  "oneSentenceSummary": "One sentence describing the room and the single highest-impact upgrade."
}

Focus on:
- Exact colors and materials actually visible (warm beige, matte black, natural oak, etc.)
- Decorative gaps — blank walls, bare shelves, missing lighting
- Renter-friendly, affordable upgrades ($20–$80)
- 3–5 product category matches, ordered by visual impact (most impactful = priority 1)

Reason sentences must be specific to THIS room, not generic advice.`;

export async function analyzeRoomWithGemini(
  file: File,
  userText = ""
): Promise<GeminiRoomAnalysis | null> {
  if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") return null;

  const ai = new GoogleGenAI({ apiKey });

  try {
    const base64 = await fileToBase64(file);
    const mimeType = (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

    const prompt = userText.trim()
      ? `${ANALYSIS_PROMPT}\n\nUser notes: "${userText}"`
      : ANALYSIS_PROMPT;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: prompt },
          ],
        },
      ],
      config: { responseMimeType: "application/json" },
    });

    const text = (response.text ?? "{}").trim();
    return JSON.parse(text) as GeminiRoomAnalysis;
  } catch (e) {
    console.warn("[Gemini vision] analysis failed, will fall back to local:", e);
    return null;
  }
}

/** Convert Gemini output into the RoomScanAnalysis shape the rest of the app uses. */
export function geminiToRoomScanAnalysis(gemini: GeminiRoomAnalysis, avoidTags: string[] = []) {
  const sorted = [...gemini.productCategoryMatches].sort(
    (a, b) => a.priority - b.priority
  );
  const recommendedCategories = Array.from(new Set(sorted.map((m) => m.category)));
  const recommendedTags = Array.from(
    new Set([
      ...sorted.flatMap((m) => m.keywords),
      ...gemini.styleKeywords,
      ...gemini.missingItems.map((s) => s.toLowerCase().replace(/\s+/g, "-")),
    ])
  );
  const vibeTags = Array.from(
    new Set([
      ...gemini.styleKeywords,
      ...gemini.dominantColors.slice(0, 2).map((c) => c.toLowerCase()),
    ])
  );

  return {
    roomType: gemini.roomType,
    vibeTags,
    recommendedCategories,
    recommendedTags,
    avoidTags,
    oneSentenceSummary: gemini.oneSentenceSummary,
    debug: { gemini },
    geminiAnalysis: gemini,
  };
}
