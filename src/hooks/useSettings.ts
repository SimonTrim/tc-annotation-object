import { useState, useCallback } from "react";
import type { AnnotationSettings } from "@/types";

const STORAGE_KEY = "tc-annotation-settings";

const defaultSettings: AnnotationSettings = {
  color: "#0063a3",
  separator: " · ",
  horizontal: false,
  showUnits: false,
  maxObjects: 20,
};

function loadSettings(): AnnotationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaultSettings;
}

function saveSettings(settings: AnnotationSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AnnotationSettings>(loadSettings);

  const updateSettings = useCallback(
    (patch: Partial<AnnotationSettings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    setSettingsState(defaultSettings);
    saveSettings(defaultSettings);
  }, []);

  return { settings, updateSettings, resetSettings };
}
