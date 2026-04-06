import React, { useState, useEffect } from "react";
import { StoryInputs, StoryResult } from "./types";
import { generateFullStory, reviseStory } from "./lib/gemini";
import { 
  Loader2, Sparkles, BookOpen, Image as ImageIcon, Video, 
  Download, FileJson, FileText, Share2, MessageSquare, 
  Send, LogIn, LogOut, Plus, Trash2, History, Layout,
  ExternalLink, ChevronRight, Play
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { jsPDF } from "jspdf";
import { cn } from "./lib/utils";
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  FirebaseUser, collection, addDoc, query, where, orderBy, onSnapshot, Timestamp,
  handleFirestoreError, OperationType, createUserWithEmailAndPassword, signInWithEmailAndPassword
} from "./firebase";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) errorMessage = `Firestore Error: ${parsed.error}`;
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-red-500/20 rounded-3xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Share2 className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-4">Application Error</h2>
            <p className="text-slate-400 mb-6 text-sm leading-relaxed">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-6 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [inputs, setInputs] = useState<StoryInputs>({
    keyword: "",
    length: 400,
    tone: "Emotional",
    scenes: 3,
    platform: "YouTube Shorts",
    videoReferences: [],
  });
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [revising, setRevising] = useState(false);
  const [result, setResult] = useState<StoryResult | null>(null);
  const [history, setHistory] = useState<StoryResult[]>([]);
  const [view, setView] = useState<"editor" | "history">("editor");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }
    const path = "stories";
    const q = query(
      collection(db, path),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const stories = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StoryResult[];
      setHistory(stories);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to login with Google.");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setAuthSubmitting(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Authentication failed.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setResult(null);
      setView("editor");
    } catch (err) {
      console.error(err);
    }
  };

  const addVideoUrl = () => {
    if (!newVideoUrl.trim()) return;
    if (inputs.videoReferences.includes(newVideoUrl)) return;
    setInputs({
      ...inputs,
      videoReferences: [...inputs.videoReferences, newVideoUrl]
    });
    setNewVideoUrl("");
  };

  const removeVideoUrl = (url: string) => {
    setInputs({
      ...inputs,
      videoReferences: inputs.videoReferences.filter(v => v !== url)
    });
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const path = "stories";
    try {
      const story = await generateFullStory(inputs);
      const storyData = {
        ...story,
        userId: user.uid,
        createdAt: Timestamp.now(),
      };
      const docRef = await addDoc(collection(db, path), storyData);
      setResult({ ...story, id: docRef.id });
    } catch (err) {
      if (err instanceof Error && err.message.includes('{"error"')) throw err;
      console.error(err);
      setError("Failed to generate story. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRevise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!result || !feedback.trim() || !user) return;
    
    setRevising(true);
    setError(null);
    const path = "stories";
    try {
      const revised = await reviseStory(result, feedback);
      const storyData = {
        ...revised,
        userId: user.uid,
        createdAt: Timestamp.now(),
      };
      const docRef = await addDoc(collection(db, path), storyData);
      setResult({ ...revised, id: docRef.id });
      setFeedback("");
    } catch (err) {
      if (err instanceof Error && err.message.includes('{"error"')) throw err;
      console.error(err);
      setError("Failed to revise story. Please try again.");
    } finally {
      setRevising(false);
    }
  };

  const exportPDF = () => {
    if (!result) return;
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text(result.title, 10, 20);
    doc.setFontSize(12);
    doc.text(`Viral Hook: ${result.viralHook}`, 10, 30);
    doc.text(`Meta Title: ${result.metaTitle}`, 10, 40);
    doc.text(`Meta Description: ${result.metaDescription}`, 10, 50);
    doc.text(`Hashtags: ${result.hashtags.join(", ")}`, 10, 60);
    
    const splitStory = doc.splitTextToSize(result.fullStory, 180);
    doc.text(splitStory, 10, 70);
    
    let y = 70 + (splitStory.length * 7);
    result.scenes.forEach((scene, i) => {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(14);
      doc.text(`Scene ${i + 1}`, 10, y);
      y += 7;
      doc.setFontSize(10);
      const splitDesc = doc.splitTextToSize(`Desc: ${scene.description}`, 180);
      doc.text(splitDesc, 10, y);
      y += (splitDesc.length * 5) + 5;
      const splitHook = doc.splitTextToSize(`Visual Hook: ${scene.visualHook}`, 180);
      doc.text(splitHook, 10, y);
      y += (splitHook.length * 5) + 5;
      
      doc.setFontSize(9);
      doc.text(`Image Model: ${scene.imagePrompt.recommendedModel}`, 10, y);
      y += 5;
      const splitImgPrompt = doc.splitTextToSize(`Image Prompt: ${scene.imagePrompt.prompt}`, 180);
      doc.text(splitImgPrompt, 10, y);
      y += (splitImgPrompt.length * 5) + 5;
      
      doc.text(`Video Model: ${scene.videoPrompt.recommendedModel}`, 10, y);
      y += 5;
      const splitVidPrompt = doc.splitTextToSize(`Video Prompt: ${scene.videoPrompt.prompt}`, 180);
      doc.text(splitVidPrompt, 10, y);
      y += (splitVidPrompt.length * 5) + 10;
    });
    
    doc.save(`${result.title.replace(/\s+/g, "_")}.pdf`);
  };

  const exportJSON = () => {
    if (!result) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${result.title.replace(/\s+/g, "_")}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const exportCSV = () => {
    if (!result) return;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Type,Content\n";
    csvContent += `Title,"${result.title.replace(/"/g, '""')}"\n`;
    csvContent += `Viral Hook,"${result.viralHook.replace(/"/g, '""')}"\n`;
    csvContent += `Meta Title,"${result.metaTitle.replace(/"/g, '""')}"\n`;
    csvContent += `Meta Description,"${result.metaDescription.replace(/"/g, '""')}"\n`;
    csvContent += `Hashtags,"${result.hashtags.join(", ").replace(/"/g, '""')}"\n`;
    csvContent += `Full Story,"${result.fullStory.replace(/"/g, '""')}"\n`;
    
    result.scenes.forEach((scene, i) => {
      csvContent += `Scene ${i + 1} Description,"${scene.description.replace(/"/g, '""')}"\n`;
      csvContent += `Scene ${i + 1} Visual Hook,"${scene.visualHook.replace(/"/g, '""')}"\n`;
      csvContent += `Scene ${i + 1} Image Model,"${scene.imagePrompt.recommendedModel.replace(/"/g, '""')}"\n`;
      csvContent += `Scene ${i + 1} Image Prompt,"${scene.imagePrompt.prompt.replace(/"/g, '""')}"\n`;
      csvContent += `Scene ${i + 1} Video Model,"${scene.videoPrompt.recommendedModel.replace(/"/g, '""')}"\n`;
      csvContent += `Scene ${i + 1} Video Prompt,"${scene.videoPrompt.prompt.replace(/"/g, '""')}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${result.title.replace(/\s+/g, "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-black text-white">Viral Story Engine</h1>
            <p className="text-slate-400 text-sm mt-1">Production-grade content suite</p>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Email Address</label>
              <input
                type="email"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-800 bg-slate-950 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Password</label>
              <input
                type="password"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-800 bg-slate-950 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-3.5 px-6 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-500 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {authSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
              {isSignUp ? "Create Account" : "Sign In"}
            </button>
          </form>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold"><span className="bg-slate-900 px-3 text-slate-500">Or continue with</span></div>
          </div>

          <button
            onClick={handleLogin}
            className="w-full py-3.5 px-6 bg-slate-800 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-700 transition-all active:scale-[0.98] border border-slate-700"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </button>

          <p className="mt-8 text-xs text-slate-500 text-center">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button 
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-indigo-400 font-bold hover:underline"
            >
              {isSignUp ? "Sign In" : "Create one now"}
            </button>
          </p>

          {error && (
            <div className="mt-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-400 font-medium">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">Viral Story Engine <span className="text-indigo-400">PRO</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView(view === "editor" ? "history" : "editor")}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-800 text-sm font-bold text-slate-300 transition-all"
            >
              {view === "editor" ? <History className="w-4 h-4" /> : <Layout className="w-4 h-4" />}
              {view === "editor" ? "History" : "Editor"}
            </button>
            <div className="h-6 w-px bg-slate-800 mx-1"></div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-red-500/10 text-sm font-bold text-red-400 transition-all"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {view === "history" ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-black text-white">Generation History</h2>
              <span className="px-4 py-1.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full text-xs font-black uppercase tracking-widest">{history.length} Stories Saved</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {history.map((story) => (
                <motion.div
                  key={story.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-900 rounded-3xl border border-slate-800 p-6 hover:border-indigo-500/40 transition-all group cursor-pointer"
                  onClick={() => {
                    setResult(story);
                    setView("editor");
                  }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-indigo-400 transition-all" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2 line-clamp-1">{story.title}</h3>
                  <p className="text-sm text-slate-400 line-clamp-3 mb-4 leading-relaxed">{story.viralHook}</p>
                  <div className="flex items-center gap-2">
                    {story.hashtags.slice(0, 2).map((tag, i) => (
                      <span key={i} className="text-[10px] font-bold text-slate-500 bg-slate-800 px-2 py-1 rounded-md border border-slate-700">#{tag}</span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Inputs */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl">
                <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-white">
                  <BookOpen className="w-5 h-5 text-indigo-400" />
                  Content Strategy
                </h2>
                <form onSubmit={handleGenerate} className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Target Platform</label>
                    <select
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      value={inputs.platform}
                      onChange={(e) => setInputs({ ...inputs, platform: e.target.value })}
                    >
                      <option>YouTube Shorts</option>
                      <option>TikTok</option>
                      <option>Instagram Reels</option>
                      <option>Blog / SEO Article</option>
                      <option>Twitter Thread</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Keyword / SEO Topic</label>
                    <input
                      type="text"
                      required
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      placeholder="e.g. The secret of the deep sea"
                      value={inputs.keyword}
                      onChange={(e) => setInputs({ ...inputs, keyword: e.target.value })}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Words</label>
                      <input
                        type="number"
                        min="100"
                        max="1000"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        value={inputs.length}
                        onChange={(e) => setInputs({ ...inputs, length: parseInt(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Scenes</label>
                      <select
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        value={inputs.scenes}
                        onChange={(e) => setInputs({ ...inputs, scenes: parseInt(e.target.value) })}
                      >
                        {[3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} Scenes</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tone / Style</label>
                    <select
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      value={inputs.tone}
                      onChange={(e) => setInputs({ ...inputs, tone: e.target.value })}
                    >
                      <option>Emotional</option>
                      <option>Suspenseful</option>
                      <option>Viral / Engaging</option>
                      <option>Kid-friendly</option>
                      <option>Professional</option>
                      <option>Humorous</option>
                      <option>Dark / Gritty</option>
                    </select>
                  </div>

                  {/* Video Reference Engine */}
                  <div className="pt-4 border-t border-slate-800">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                      Video References
                      <span className="text-indigo-400">{inputs.videoReferences.length} Added</span>
                    </label>
                    <div className="flex gap-2 mb-4">
                      <input
                        type="url"
                        className="flex-1 px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-xs"
                        placeholder="Paste video URL..."
                        value={newVideoUrl}
                        onChange={(e) => setNewVideoUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addVideoUrl())}
                      />
                      <button
                        type="button"
                        onClick={addVideoUrl}
                        className="p-2 bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all"
                      >
                        <Plus className="w-4 h-4 text-white" />
                      </button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {inputs.videoReferences.map((url, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg border border-slate-700 group">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <Play className="w-3 h-3 text-indigo-400 shrink-0" />
                            <span className="text-[10px] text-slate-400 truncate">{url}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeVideoUrl(url)}
                            className="p-1 text-slate-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      "w-full py-3.5 px-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2",
                      loading ? "bg-slate-700 cursor-not-allowed" : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/20 active:scale-[0.98]"
                    )}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Optimizing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Generate Viral Package
                      </>
                    )}
                  </button>
                </form>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm font-medium">
                  {error}
                </div>
              )}
            </div>

            {/* Right Column: Output */}
            <div className="lg:col-span-8">
              <AnimatePresence mode="wait">
                {!result && !loading ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/50"
                  >
                    <div className="w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center mb-6 shadow-inner">
                      <Sparkles className="w-10 h-10 text-indigo-400" />
                    </div>
                    <h3 className="text-2xl font-bold text-white">Engine Primed</h3>
                    <p className="text-slate-400 max-w-sm mt-3 leading-relaxed">
                      Configure your strategy on the left to generate content designed for maximum engagement and viral potential.
                    </p>
                  </motion.div>
                ) : loading ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full min-h-[500px] flex flex-col items-center justify-center p-12"
                  >
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 border-4 border-purple-500/10 border-b-purple-500 rounded-full animate-spin-reverse"></div>
                      </div>
                      <Sparkles className="w-8 h-8 text-indigo-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mt-10">Engineering Viral Content</h3>
                    <p className="text-slate-400 mt-3 animate-pulse font-medium">Optimizing for 100M+ views...</p>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    {/* Revision Section */}
                    <div className="bg-slate-900 p-6 rounded-2xl border border-indigo-500/20 shadow-xl shadow-indigo-500/5">
                      <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        Refine Content
                      </h3>
                      <form onSubmit={handleRevise} className="flex gap-3">
                        <input
                          type="text"
                          className="flex-1 px-4 py-3 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm"
                          placeholder="e.g. 'Make the hook more shocking', 'Add more visual drama'..."
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          disabled={revising}
                        />
                        <button
                          type="submit"
                          disabled={revising || !feedback.trim()}
                          className={cn(
                            "px-6 py-3 rounded-xl font-bold text-white transition-all flex items-center gap-2 text-sm",
                            revising || !feedback.trim() ? "bg-slate-800 text-slate-500 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500 active:scale-95 shadow-lg shadow-indigo-500/20"
                          )}
                        >
                          {revising ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          {revising ? "Refining..." : "Refine"}
                        </button>
                      </form>
                    </div>

                    {/* Export Actions */}
                    <div className="flex flex-wrap items-center gap-3 bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-xl sticky top-20 z-40">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mr-2">Export Package:</span>
                      <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700">
                        <FileText className="w-4 h-4 text-red-400" /> PDF
                      </button>
                      <button onClick={exportJSON} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700">
                        <FileJson className="w-4 h-4 text-yellow-400" /> JSON
                      </button>
                      <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700">
                        <Download className="w-4 h-4 text-green-400" /> CSV
                      </button>
                    </div>

                    {/* Viral Hook Card */}
                    <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 rounded-3xl border border-indigo-500/30 p-8 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4">
                        <div className="px-3 py-1 bg-indigo-500 text-white text-[10px] font-black rounded-full uppercase tracking-widest animate-pulse">Viral Hook</div>
                      </div>
                      <div className="relative z-10">
                        <h2 className="text-3xl font-black text-white leading-tight mb-4 group-hover:text-indigo-300 transition-colors">{result?.title}</h2>
                        <p className="text-xl text-slate-200 font-medium italic leading-relaxed">"{result?.viralHook}"</p>
                      </div>
                      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all"></div>
                    </div>

                    {/* Story Content */}
                    <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl">
                      <div className="p-8 border-b border-slate-800 bg-slate-800/30">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 block">SEO Meta Title</span>
                            <p className="text-sm text-slate-200 font-semibold bg-slate-800 p-3 rounded-xl border border-slate-700">{result?.metaTitle}</p>
                          </div>
                          <div className="space-y-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 block">SEO Meta Description</span>
                            <p className="text-sm text-slate-300 leading-relaxed bg-slate-800 p-3 rounded-xl border border-slate-700">{result?.metaDescription}</p>
                          </div>
                        </div>
                        <div className="mt-6 flex flex-wrap gap-2">
                          {result?.hashtags.map((tag, i) => (
                            <span key={i} className="text-[10px] font-bold text-slate-400 bg-slate-800 px-3 py-1 rounded-full border border-slate-700">#{tag}</span>
                          ))}
                        </div>
                        {result?.videoReferences && result.videoReferences.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-slate-800">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 block mb-3">Analyzed Video References</span>
                            <div className="flex flex-wrap gap-2">
                              {result.videoReferences.map((url, i) => (
                                <a 
                                  key={i} 
                                  href={url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700 text-[10px] text-slate-400 hover:text-indigo-400 transition-all"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Reference {i + 1}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="p-8 prose prose-invert prose-indigo max-w-none">
                        <ReactMarkdown>{result?.fullStory || ""}</ReactMarkdown>
                      </div>
                    </div>

                    {/* Scenes Breakdown */}
                    <div className="space-y-6 pb-20">
                      <div className="flex items-center justify-between">
                        <h3 className="text-2xl font-black text-white tracking-tight">Production Scenes</h3>
                        <span className="px-4 py-1.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full text-xs font-black uppercase tracking-widest">{result?.scenes.length} Scenes</span>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-8">
                        {result?.scenes.map((scene, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="bg-slate-900 rounded-3xl border border-slate-800 p-8 shadow-xl hover:border-indigo-500/40 transition-all group relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-indigo-500/10 transition-all"></div>
                            
                            <div className="flex flex-col md:flex-row items-start gap-8 relative z-10">
                              <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 text-xl font-black shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-inner border border-slate-700">
                                {idx + 1}
                              </div>
                              <div className="space-y-6 flex-1">
                                <div className="space-y-4">
                                  <div>
                                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-2 block">Visual Hook</span>
                                    <p className="text-lg text-white font-bold italic leading-tight">"{scene.visualHook}"</p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 block">Scene Description</span>
                                    <p className="text-slate-300 leading-relaxed text-sm">{scene.description}</p>
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pt-6 border-t border-slate-800">
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-indigo-400">
                                        <ImageIcon className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Image Prompt</span>
                                      </div>
                                      <span className="text-[9px] font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">{scene.imagePrompt.recommendedModel}</span>
                                    </div>
                                    <div className="p-4 bg-slate-800/50 rounded-2xl space-y-3 border border-slate-800 group-hover:border-indigo-500/20 transition-all">
                                      <p className="text-[11px] text-slate-300 font-mono leading-relaxed">{scene.imagePrompt.prompt}</p>
                                      <div className="grid grid-cols-2 gap-2 text-[9px]">
                                        {scene.imagePrompt.style && <div className="text-slate-500"><span className="text-indigo-400/70 font-bold uppercase mr-1">Style:</span>{scene.imagePrompt.style}</div>}
                                        {scene.imagePrompt.lighting && <div className="text-slate-500"><span className="text-indigo-400/70 font-bold uppercase mr-1">Lighting:</span>{scene.imagePrompt.lighting}</div>}
                                        {scene.imagePrompt.cameraAngle && <div className="text-slate-500"><span className="text-indigo-400/70 font-bold uppercase mr-1">Camera:</span>{scene.imagePrompt.cameraAngle}</div>}
                                        {scene.imagePrompt.aspectRatio && <div className="text-slate-500"><span className="text-indigo-400/70 font-bold uppercase mr-1">Ratio:</span>{scene.imagePrompt.aspectRatio}</div>}
                                      </div>
                                      {scene.imagePrompt.negativePrompt && (
                                        <div className="pt-2 border-t border-slate-700/50">
                                          <span className="text-[8px] font-black text-red-400/50 uppercase tracking-widest block mb-1">Negative Prompt</span>
                                          <p className="text-[10px] text-slate-500 italic">{scene.imagePrompt.negativePrompt}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-purple-400">
                                        <Video className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Video Prompt</span>
                                      </div>
                                      <span className="text-[9px] font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">{scene.videoPrompt.recommendedModel}</span>
                                    </div>
                                    <div className="p-4 bg-slate-800/50 rounded-2xl space-y-3 border border-slate-800 group-hover:border-purple-500/20 transition-all">
                                      <p className="text-[11px] text-slate-300 font-mono leading-relaxed">{scene.videoPrompt.prompt}</p>
                                      <div className="grid grid-cols-2 gap-2 text-[9px]">
                                        {scene.videoPrompt.style && <div className="text-slate-500"><span className="text-purple-400/70 font-bold uppercase mr-1">Style:</span>{scene.videoPrompt.style}</div>}
                                        {scene.videoPrompt.lighting && <div className="text-slate-500"><span className="text-purple-400/70 font-bold uppercase mr-1">Lighting:</span>{scene.videoPrompt.lighting}</div>}
                                        {scene.videoPrompt.cameraAngle && <div className="text-slate-500"><span className="text-purple-400/70 font-bold uppercase mr-1">Camera:</span>{scene.videoPrompt.cameraAngle}</div>}
                                        {scene.videoPrompt.aspectRatio && <div className="text-slate-500"><span className="text-purple-400/70 font-bold uppercase mr-1">Ratio:</span>{scene.videoPrompt.aspectRatio}</div>}
                                      </div>
                                      {scene.videoPrompt.negativePrompt && (
                                        <div className="pt-2 border-t border-slate-700/50">
                                          <span className="text-[8px] font-black text-red-400/50 uppercase tracking-widest block mb-1">Negative Prompt</span>
                                          <p className="text-[10px] text-slate-500 italic">{scene.videoPrompt.negativePrompt}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-slate-800 py-16 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-6 h-6 bg-indigo-500 rounded flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white">Viral Story Engine PRO</span>
          </div>
          <p className="text-xs text-slate-500 uppercase tracking-[0.3em]">Built for the next generation of content creators</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
