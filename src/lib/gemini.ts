import { GoogleGenAI, Type } from "@google/genai";
import { StoryInputs, StoryResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const promptDataSchema = {
  type: Type.OBJECT,
  properties: {
    prompt: { type: Type.STRING, description: "The main descriptive prompt for the AI model." },
    negativePrompt: { type: Type.STRING, description: "Elements to exclude from the generation." },
    style: { type: Type.STRING, description: "The artistic style (e.g., Cinematic, Anime, Oil Painting)." },
    lighting: { type: Type.STRING, description: "Lighting conditions (e.g., Golden Hour, Volumetric, Neon)." },
    cameraAngle: { type: Type.STRING, description: "Camera perspective (e.g., Low Angle, Bird's Eye, Close-up)." },
    aspectRatio: { type: Type.STRING, description: "Recommended aspect ratio (e.g., 16:9, 9:16, 1:1)." },
    recommendedModel: { type: Type.STRING, description: "The specific AI model recommended for this prompt (e.g., Imagen 3, Veo, Stable Diffusion XL, Midjourney v6)." },
  },
  required: ["prompt", "recommendedModel"],
};

export async function generateFullStory(inputs: StoryInputs): Promise<StoryResult> {
  const videoContext = inputs.videoReferences.length > 0 
    ? `\n\nVIDEO REFERENCES FOR CONTEXT:\n${inputs.videoReferences.join("\n")}\nAnalyze these video references and incorporate their style, visual elements, or themes into the story and prompts.`
    : "";

  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a VIRAL, high-retention short story optimized for ${inputs.platform} based on the following:
    Keyword: ${inputs.keyword}
    Length: ${inputs.length} words
    Tone: ${inputs.tone}
    Number of Scenes: ${inputs.scenes}${videoContext}
    
    CRITICAL INSTRUCTIONS FOR 100M+ VIEWS:
    1. VIRAL HOOK: The first 3 seconds/sentences must be an irresistible hook that creates an immediate "curiosity gap" or emotional shock.
    2. RETENTION: Use "open loops" in the storytelling to keep viewers watching until the very end.
    3. AI IMAGE PROMPTS: Generate in-depth, structured JSON prompts. Use professional cinematic terminology. Specify the best model (e.g., Imagen 3, Midjourney v6).
    4. AI VIDEO PROMPTS: Generate in-depth, structured JSON prompts. Focus on dynamic motion and specify the best model (e.g., Veo, Sora, Runway Gen-3).
    5. SEO: Include high-volume, low-competition meta tags and a list of 10 trending hashtags.

    The output must include:
    1. A catchy, clickbait-style title.
    2. A specific "Viral Hook" (1-2 sentences).
    3. The full story text (formatted with line breaks for readability).
    4. Meta title and Meta description for SEO.
    5. A list of 10 trending hashtags.
    6. A breakdown of the story into ${inputs.scenes} scenes.
    7. For each scene, provide:
       - A detailed descriptive sentence (the scene description).
       - A "Visual Hook" (what makes this scene visually stop the scroll).
       - A structured JSON object for the AI image generation prompt.
       - A structured JSON object for the AI video generation prompt.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          viralHook: { type: Type.STRING },
          fullStory: { type: Type.STRING },
          metaTitle: { type: Type.STRING },
          metaDescription: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                visualHook: { type: Type.STRING },
                imagePrompt: promptDataSchema,
                videoPrompt: promptDataSchema,
              },
              required: ["description", "visualHook", "imagePrompt", "videoPrompt"],
            },
          },
        },
        required: ["title", "viralHook", "fullStory", "metaTitle", "metaDescription", "hashtags", "scenes"],
      },
    },
  });

  const response = await model;
  const result = JSON.parse(response.text);
  return { ...result, videoReferences: inputs.videoReferences };
}

export async function reviseStory(previousResult: StoryResult, feedback: string): Promise<StoryResult> {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Revise the following VIRAL story based on this feedback: "${feedback}"
    
    Original Story:
    Title: ${previousResult.title}
    Viral Hook: ${previousResult.viralHook}
    Full Story: ${previousResult.fullStory}
    
    Maintain the same VIRAL structure and output format as before, including the in-depth JSON prompts for images and videos.
    Ensure the revision enhances the "curiosity gap" and visual impact.
    The output must include:
    1. A catchy title (updated if necessary).
    2. A specific "Viral Hook".
    3. The revised full story text.
    4. Meta title and Meta description for SEO.
    5. A list of 10 trending hashtags.
    6. A breakdown of the story into ${previousResult.scenes.length} scenes.
    7. For each scene, provide:
       - A detailed descriptive sentence.
       - A "Visual Hook".
       - A structured JSON object for the AI image generation prompt.
       - A structured JSON object for the AI video generation prompt.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          viralHook: { type: Type.STRING },
          fullStory: { type: Type.STRING },
          metaTitle: { type: Type.STRING },
          metaDescription: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                visualHook: { type: Type.STRING },
                imagePrompt: promptDataSchema,
                videoPrompt: promptDataSchema,
              },
              required: ["description", "visualHook", "imagePrompt", "videoPrompt"],
            },
          },
        },
        required: ["title", "viralHook", "fullStory", "metaTitle", "metaDescription", "hashtags", "scenes"],
      },
    },
  });

  const response = await model;
  return JSON.parse(response.text);
}
