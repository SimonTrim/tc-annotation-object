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

      // TC envoie "viewer.onSelectionChanged" (pas "viewer.selectionChanged")
      case "viewer.selectionChanged":
      case "viewer.onSelectionChanged": {
        // Le format peut être un tableau direct ou un objet { data: [...] }
        let sel: ViewerSelection[] = [];
        if (Array.isArray(data)) {
          sel = data as ViewerSelection[];
        } else if (data && typeof data === "object" && "data" in data) {
          const inner = (data as Record<string, unknown>).data;
          sel = Array.isArray(inner) ? (inner as ViewerSelection[]) : [];
        } else if (data && typeof data === "object") {
          // Possible format: single selection object
          const obj = data as Record<string, unknown>;
          if ("modelId" in obj && "objectRuntimeIds" in obj) {
            sel = [obj as unknown as ViewerSelection];
          }
        }

        const count = sel.reduce((s, v) => s + (v.objectRuntimeIds?.length ?? 0), 0);
        console.log(`${LOG} Selection: ${count} objet(s)`, JSON.stringify(sel));

        // Ne mettre à jour le state que si la sélection a réellement changé
        setState((s) => {
          const prevKey = s.selection
            .map((v) => `${v.modelId}:${v.objectRuntimeIds.join(",")}`)
            .join("|");
          const newKey = sel
            .map((v) => `${v.modelId}:${v.objectRuntimeIds.join(",")}`)
            .join("|");

          if (prevKey === newKey) {
            console.log(`${LOG} Selection unchanged, skipping state update`);
            return s;
          }
          return { ...s, selection: sel };
        });
        break;
      }

      case "viewer.modelLoaded":
      case "viewer.onModelLoaded":
      case "viewer.onModelStateChanged":
        console.log(`${LOG} Model event`, data);
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
