import { Suspense, lazy } from "react";
import { LayoutGrid, Settings, Info } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loader } from "@/components/Loader";
import {
  useTrimbleConnect,
  TrimbleProvider,
} from "@/hooks/useTrimbleConnect";
import { useSettings } from "@/hooks/useSettings";

const InquireObjectsTab = lazy(() =>
  import("@/components/tabs/InquireObjectsTab").then((m) => ({
    default: m.InquireObjectsTab,
  })),
);
const SettingsTab = lazy(() =>
  import("@/components/tabs/SettingsTab").then((m) => ({
    default: m.SettingsTab,
  })),
);
const AboutTab = lazy(() =>
  import("@/components/tabs/AboutTab").then((m) => ({
    default: m.AboutTab,
  })),
);

function AppContent() {
  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <Tabs defaultValue="inquire" className="flex flex-col h-full">
      {/* Header avec onglets */}
      <div className="px-2 pt-2 pb-0">
        <div className="flex items-center justify-between mb-2 px-1">
          <h1 className="text-xs font-bold uppercase tracking-wider text-primary">
            Annotation Objets
          </h1>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
            v1.0
          </Badge>
        </div>

        <TabsList>
          <TabsTrigger value="inquire">
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Objets</span>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Paramètres</span>
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">À propos</span>
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Contenu des onglets */}
      <ErrorBoundary>
        <Suspense fallback={<Loader />}>
          <TabsContent value="inquire" className="flex-1">
            <InquireObjectsTab settings={settings} />
          </TabsContent>

          <TabsContent value="settings" className="flex-1">
            <SettingsTab
              settings={settings}
              onUpdate={updateSettings}
              onReset={resetSettings}
            />
          </TabsContent>

          <TabsContent value="about" className="flex-1">
            <AboutTab />
          </TabsContent>
        </Suspense>
      </ErrorBoundary>
    </Tabs>
  );
}

export default function App() {
  const trimble = useTrimbleConnect();

  if (!trimble.isConnected) {
    return <Loader message="Connexion à Trimble Connect…" />;
  }

  return (
    <TrimbleProvider value={trimble}>
      <AppContent />
    </TrimbleProvider>
  );
}
