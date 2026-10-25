import { create } from 'zustand';
import type { Plane } from '../math/axes';

export type Dialog = 'help' | 'glossary' | null;
export type MobileTab = 'scene' | 'inspect' | null;

export interface HopfState {
  bands: number;
  perBand: number;
  thickness: number;
  angle: number;
  /** Degrees per second of the animated 4D rotation. */
  speed: number;
  playing: boolean;
  plane: Plane;
}

interface UiState {
  special: 'hopf' | null;
  hopf: HopfState;
  setSpecial: (s: UiState['special']) => void;
  setHopf: (patch: Partial<HopfState>) => void;
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
  special: null,
  hopf: { bands: 4, perBand: 14, thickness: 0.035, angle: 0, speed: 20, playing: true, plane: [0, 3] },
  setSpecial: (special) => set({ special }),
  setHopf: (patch) => set((s) => ({ hopf: { ...s.hopf, ...patch } })),
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
