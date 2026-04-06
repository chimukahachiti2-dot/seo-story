export interface StoryInputs {
  keyword: string;
  length: number;
  tone: string;
  scenes: number;
  platform: string;
  videoReferences: string[];
}

export interface PromptData {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  lighting?: string;
  cameraAngle?: string;
  aspectRatio?: string;
  recommendedModel: string;
}

export interface Scene {
  description: string;
  imagePrompt: PromptData;
  videoPrompt: PromptData;
  visualHook: string;
}

export interface StoryResult {
  id?: string;
  title: string;
  viralHook: string;
  fullStory: string;
  metaTitle: string;
  metaDescription: string;
  scenes: Scene[];
  hashtags: string[];
  videoReferences?: string[];
}
