import { useCallback } from "react";
import {
  ArrowUpAZ,
  ArrowDownAZ,
  Layers,
  Tag,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PropertyToggleList } from "@/components/PropertyToggleList";
import { Loader } from "@/components/Loader";
import { useTrimbleContext } from "@/hooks/useTrimbleConnect";
import type { AnnotationSettings, SortMode } from "@/types";
import type { useAnnotations } from "@/hooks/useAnnotations";

interface InquireObjectsTabProps {
  settings: AnnotationSettings;
  annotations: ReturnType<typeof useAnnotations>;
}

export function InquireObjectsTab({ settings, annotations }: InquireObjectsTabProps) {
  const { selection } = useTrimbleContext();
  const {
    allProperties,
    groupedProperties,
    isLoading,
    maxReached,
    enabledCount,
    sortMode,
    setSortMode,
    toggleProperty,
    toggleAll,
  } = annotations;

  const enabledProps = allProperties.filter((p) => p.enabled);

  const handleSortCycle = useCallback(() => {
    const modes: SortMode[] = ["pset", "alpha-asc", "alpha-desc"];
    const idx = modes.indexOf(sortMode);
    setSortMode(modes[(idx + 1) % modes.length]!);
  }, [sortMode, setSortMode]);

  const sortLabel = sortMode === "pset" ? "Par groupe" : sortMode === "alpha-asc" ? "A → Z" : "Z → A";
  const SortIcon = sortMode === "alpha-desc" ? ArrowDownAZ : sortMode === "alpha-asc" ? ArrowUpAZ : Layers;

  const selectedCount = selection.reduce(
    (sum, s) => sum + s.objectRuntimeIds.length,
    0,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Barre de propriétés actives */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
          {enabledProps.length > 0 ? (
            enabledProps.map((p) => (
              <Badge
                key={p.key}
                variant="default"
                className="text-[10px] gap-1 pr-1 cursor-pointer"
                onClick={() => toggleProperty(p.key)}
              >
                {p.propertyName}
                <X className="h-2.5 w-2.5" />
              </Badge>
            ))
          ) : (
            <span className="text-[11px] text-muted-foreground italic">
              Aucune propriété activée
            </span>
          )}
        </div>
      </div>

      {/* Barre d'outils */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleSortCycle}
            title={`Tri : ${sortLabel}`}
          >
            <SortIcon className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[10px] text-muted-foreground">{sortLabel}</span>
        </div>

        <div className="flex items-center gap-1">
          {enabledCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => toggleAll(false)}
              title="Tout désactiver"
            >
              <ToggleLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          {enabledCount < allProperties.length && allProperties.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => toggleAll(true)}
              title="Tout activer"
            >
              <ToggleRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {selectedCount > 0 && (
            <div className="flex items-center gap-1 ml-1">
              <Tag className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-medium">
                {selectedCount} objet{selectedCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Liste des propriétés */}
      {isLoading ? (
        <Loader message="Chargement des propriétés…" />
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-1">
            <PropertyToggleList
              groupedProperties={groupedProperties}
              onToggle={toggleProperty}
            />
          </div>
        </ScrollArea>
      )}

      {/* Alerte max objets */}
      {maxReached && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warning/15 border-t border-warning/30">
          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
          <span className="text-[11px] text-warning font-medium">
            Nombre max d'objets atteint ({settings.maxObjects})
          </span>
        </div>
      )}
    </div>
  );
}
