
import { GoogleGenAI, Type } from "@google/genai";
import { Product } from "./types";

// Validate API key at runtime (Vite env)
const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
  console.warn('⚠️ GEMINI API key not set. Set VITE_GEMINI_API_KEY in .env.local to enable Gemini features.');
}

const ai = new GoogleGenAI({ apiKey });

const productSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      name: { type: Type.STRING },
      brand: { type: Type.STRING },
      price: { type: Type.NUMBER },
      description: { type: Type.STRING },
      category: { type: Type.STRING },
      imageUrl: { type: Type.STRING },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["id", "name", "brand", "price", "description", "category", "imageUrl", "tags"]
  }
};

export const fetchProductsByInterests = async (interests: string[]): Promise<Product[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate 10 trending products based on these interests: ${interests.join(', ')}. Provide high-quality placeholder images using picsum.photos URLs.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: productSchema
      }
    });
    
    // Use .text property (not text()) and trim before parsing JSON
    const text = response.text || "[]";
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("Error fetching products:", error);
    return [];
  }
};

export const fetchSimilarProducts = async (likedProducts: Product[]): Promise<Product[]> => {
  if (likedProducts.length === 0) return [];
  
  const productNames = likedProducts.map(p => p.name).join(', ');
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `The user likes these products: ${productNames}. Generate 5 highly relevant similar products that they would love.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: productSchema
      }
    });
    
    const text = response.text || "[]";
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return [];
  }
};

export const searchProducts = async (query: string): Promise<Product[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for products matching: "${query}". Generate 8 realistic product results with brand, price, and descriptions.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: productSchema
      }
    });
    
    const text = response.text || "[]";
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("Error searching products:", error);
    return [];
  }
};
