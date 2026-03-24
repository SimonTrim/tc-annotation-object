import { ExternalLink, Info, Code2, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTrimbleContext } from "@/hooks/useTrimbleConnect";

const VERSION = "1.0.0";

export function AboutTab() {
  const { project, isEmbedded } = useTrimbleContext();

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {/* En-tête */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Info className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Annotation Objets</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Extension pour le Viewer 3D de Trimble Connect
            </p>
            <Badge variant="secondary" className="mt-1.5 text-[10px]">
              v{VERSION}
            </Badge>
          </div>
        </div>

        <Separator />

        {/* Description */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </h3>
          <p className="text-xs leading-relaxed text-foreground/90">
            Cette extension permet d'afficher des informations détaillées sur des objets
            spécifiques au sein d'un modèle 3D, sous forme d'annotations directement
            dans le viewer. Sélectionnez des objets, choisissez les propriétés à
            afficher, et elles apparaîtront comme des étiquettes 3D positionnées sur
            chaque objet.
          </p>
        </div>

        <Separator />

        {/* Fonctionnalités */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fonctionnalités
          </h3>
          <ul className="text-xs leading-relaxed space-y-1.5 text-foreground/90">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              Affichage des propriétés IFC comme annotations 3D
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              Sélection individuelle des propriétés à afficher
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              Regroupement par Property Set (Pset)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              Personnalisation : couleur, séparateur, orientation
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              Support multi-objets (jusqu'à 50)
            </li>
          </ul>
        </div>

        <Separator />

        {/* Info connexion */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Connexion
          </h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Mode :</span>
            <span className="font-medium">
              {isEmbedded ? "Intégré (Trimble Connect)" : "Développement local"}
            </span>
            <span className="text-muted-foreground">Projet :</span>
            <span className="font-medium truncate">
              {project?.name ?? "—"}
            </span>
            <span className="text-muted-foreground">Région :</span>
            <span className="font-medium">
              {project?.location ?? "—"}
            </span>
          </div>
        </div>

        <Separator />

        {/* Liens */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ressources
          </h3>
          <div className="flex flex-col gap-1.5">
            <ResourceLink
              icon={<BookOpen className="h-3.5 w-3.5" />}
              label="Modus 2.0 Design System"
              url="https://modus.trimble.com/"
            />
            <ResourceLink
              icon={<Code2 className="h-3.5 w-3.5" />}
              label="Workspace API"
              url="https://components.connect.trimble.com/trimble-connect-workspace-api/index.html"
            />
            <ResourceLink
              icon={<ExternalLink className="h-3.5 w-3.5" />}
              label="Trimble Connect"
              url="https://connect.trimble.com/"
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function ResourceLink({
  icon,
  label,
  url,
}: {
  icon: React.ReactNode;
  label: string;
  url: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-xs text-primary hover:underline py-1"
    >
      {icon}
      {label}
    </a>
  );
}
