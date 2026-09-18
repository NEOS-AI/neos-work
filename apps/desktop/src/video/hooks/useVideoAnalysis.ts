import { useState } from "react";
import { analyzeVideo } from "@video/lib/tauri/commands";
import type { VideoInfo } from "@video/lib/types/video";

export interface VideoAnalysisState {
  data: VideoInfo | null;
  isLoading: boolean;
  error: string | null;
}

export function useVideoAnalysis() {
  const [state, setState] = useState<VideoAnalysisState>({
    data: null,
    isLoading: false,
    error: null,
  });

  const analyze = async (filePath: string) => {
    setState({ data: null, isLoading: true, error: null });
    try {
      const result = await analyzeVideo(filePath);
      setState({ data: result, isLoading: false, error: null });
    } catch (err) {
      const message = String(err);
      setState({
        data: null,
        isLoading: false,
        error: message,
      });
      throw err;
    }
  };

  const reset = () => setState({ data: null, isLoading: false, error: null });

  return { ...state, analyze, reset };
}
