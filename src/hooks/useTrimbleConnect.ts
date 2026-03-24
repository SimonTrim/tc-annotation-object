import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import type {
  TrimbleAPI,
  ConnectProject,
  ViewerSelection,
} from "@/types";

export interface TrimbleConnectState {
  isConnected: boolean;
  isEmbedded: boolean;
  project: ConnectProject | null;
  accessToken: string | null;
  selection: ViewerSelection[];
  api: TrimbleAPI | null;
}

const defaultState: TrimbleConnectState = {
  isConnected: false,
  isEmbedded: false,
  project: null,
  accessToken: null,
  selection: [],
  api: null,
};

const TrimbleContext = createContext<TrimbleConnectState>(defaultState);

export const TrimbleProvider = TrimbleContext.Provider;

export function useTrimbleContext() {
  return useContext(TrimbleContext);
}

export function useTrimbleConnect(): TrimbleConnectState {
  const [state, setState] = useState<TrimbleConnectState>(defaultState);

  const handleEvent = useCallback((event: string, data: unknown) => {
    switch (event) {
      case "extension.accessToken":
        setState((s) => ({ ...s, accessToken: data as string }));
        break;
      case "viewer.selectionChanged":
        setState((s) => ({
          ...s,
          selection: (data as ViewerSelection[]) ?? [],
        }));
        break;
    }
  }, []);

  useEffect(() => {
    const isInIframe = window.self !== window.top;

    if (isInIframe && window.TrimbleConnectWorkspace) {
      window.TrimbleConnectWorkspace
        .connect(window.parent, handleEvent, 30000)
        .then(async (api) => {
          const project = await api.project.getCurrentProject();
          const token = await api.extension.requestPermission("accesstoken");
          setState({
            isConnected: true,
            isEmbedded: true,
            project,
            accessToken:
              token !== "pending" && token !== "denied" ? token : null,
            selection: [],
            api,
          });
        })
        .catch((err) => {
          console.error("[TC] Connexion échouée:", err);
          setState({ ...defaultState, isConnected: true });
        });
    } else {
      // Mode dev local — données fictives
      setState({
        isConnected: true,
        isEmbedded: false,
        project: { id: "mock-project", name: "Projet local (dev)", location: "europe" },
        accessToken: "mock-token",
        selection: [],
        api: null,
      });
    }
  }, [handleEvent]);

  return state;
}
