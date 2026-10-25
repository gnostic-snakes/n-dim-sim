import { create } from 'zustand';

export type Dialog = 'help' | 'glossary' | null;
export type MobileTab = 'scene' | 'inspect' | null;

interface UiState {
  lesson: 'order' | null;
  dialog: Dialog;
  mobileTab: MobileTab;
  recording: boolean;
  timelineOpen: boolean;
  setLesson: (l: UiState['lesson']) => void;
  setDialog: (d: Dialog) => void;
  setMobileTab: (t: MobileTab) => void;
  setRecording: (r: boolean) => void;
  setTimelineOpen: (o: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  lesson: null,
  dialog: null,
  mobileTab: null,
  recording: false,
  timelineOpen: true,
  setLesson: (lesson) => set({ lesson }),
  setDialog: (dialog) => set({ dialog }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setRecording: (recording) => set({ recording }),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
}));
