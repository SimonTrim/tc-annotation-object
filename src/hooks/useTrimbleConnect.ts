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

const LOG = "[AnnotationObj]";

export interface TrimbleConnectState {
  isConnected: boolean;
  isEmbedded: boolean;
  project: ConnectProject | null;
  accessToken: string | null;
  selection: ViewerSelection[];
  api: TrimbleAPI | null;
  error: string | null;
}

const defaultState: TrimbleConnectState = {
  isConnected: false,
  isEmbedded: false,
  project: null,
  accessToken: null,
  selection: [],
  api: null,
  error: null,
};

const TrimbleContext = createContext<TrimbleConnectState>(defaultState);

export const TrimbleProvider = TrimbleContext.Provider;

export function useTrimbleContext() {
  return useContext(TrimbleContext);
}

export function useTrimbleConnect(): TrimbleConnectState {
  const [state, setState] = useState<TrimbleConnectState>(defaultState);

  const handleEvent = useCallback((event: string, data: unknown) => {
    console.log(`${LOG} Event: ${event}`, data);

    switch (event) {
      case "extension.accessToken":
        console.log(`${LOG} Token refreshed (${(data as string)?.length} chars)`);
        setState((s) => ({ ...s, accessToken: data as string }));
        break;
      case "viewer.selectionChanged": {
        const sel = (data as ViewerSelection[]) ?? [];
        const count = sel.reduce((s, v) => s + v.objectRuntimeIds.length, 0);
        console.log(`${LOG} Selection changed: ${count} objet(s)`, sel);
        setState((s) => ({ ...s, selection: sel }));
        break;
      }
      case "viewer.modelLoaded":
        console.log(`${LOG} Model loaded`, data);
        break;
    }
  }, []);

  useEffect(() => {
    const isInIframe = window.self !== window.top;
    const hasSDK = !!window.TrimbleConnectWorkspace;

    console.log(`${LOG} Init — iframe=${isInIframe}, SDK=${hasSDK}`);

    if (isInIframe && hasSDK) {
      console.log(`${LOG} Connecting to Workspace API...`);

      window.TrimbleConnectWorkspace
        .connect(window.parent, handleEvent, 30000)
        .then(async (api) => {
          console.log(`${LOG} Connected! Fetching project...`);

          const project = await api.project.getCurrentProject();
          console.log(`${LOG} Project: ${project.name} (${project.id}), region: ${project.location}`);

          const token = await api.extension.requestPermission("accesstoken");
          const hasToken = token !== "pending" && token !== "denied";
          console.log(`${LOG} Token: ${hasToken ? "OK" : token} (${typeof token === "string" ? token.length : 0} chars)`);

          setState({
            isConnected: true,
            isEmbedded: true,
            project,
            accessToken: hasToken ? token : null,
            selection: [],
            api,
            error: null,
          });

          console.log(`${LOG} Ready!`);
        })
        .catch((err) => {
          console.error(`${LOG} Connection FAILED:`, err);
          setState({
            ...defaultState,
            isConnected: true,
            isEmbedded: true,
            error: `Connexion échouée: ${err?.message ?? err}`,
          });
        });
    } else {
      console.log(`${LOG} Dev mode — using mock data`);
      setState({
        isConnected: true,
        isEmbedded: false,
        project: { id: "mock-project", name: "Projet local (dev)", location: "europe" },
        accessToken: "mock-token",
        selection: [],
        api: null,
        error: null,
      });
    }
  }, [handleEvent]);

  return state;
}
