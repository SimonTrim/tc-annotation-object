import { useCallback, useMemo } from "react";
import {
  ArrowUpAZ,
  ArrowDownAZ,
  Layers,
  Tag,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PropertyToggleList } from "@/components/PropertyToggleList";
import { EnabledPropertyOrder } from "@/components/EnabledPropertyOrder";
import { Loader } from "@/components/Loader";
import { useTrimbleContext } from "@/hooks/useTrimbleConnect";
import { useFavorites } from "@/hooks/useFavorites";
import type { AnnotationSettings, PropertyToggleState, SortMode } from "@/types";
import type { useAnnotations } from "@/hooks/useAnnotations";

interface InquireObjectsTabProps {
  settings: AnnotationSettings;
  annotations: ReturnType<typeof useAnnotations>;
}

export function InquireObjectsTab({ settings, annotations }: InquireObjectsTabProps) {
  const { selection } = useTrimbleContext();
  const { favorites, toggleFavorite } = useFavorites();
  const {
    allProperties,
    groupedProperties,
    orderedEnabledProps,
    isLoading,
    maxReached,
    enabledCount,
    totalAnnotations,
    sortMode,
    setSortMode,
    toggleProperty,
    toggleAll,
    moveProperty,
    reorderProperty,
    clearAllAnnotations,
  } = annotations;

  /** Regrouper avec "Favoris" en haut */
  const groupedWithFavorites = useMemo(() => {
    const result: Record<string, PropertyToggleState[]> = {};

    // Favoris en premier
    const favProps = Object.values(groupedProperties)
      .flat()
      .filter((p) => favorites.has(p.key));
    if (favProps.length > 0) {
      result["Favoris"] = favProps;
    }

    // Puis les groupes normaux (sans les favoris)
    for (const [group, props] of Object.entries(groupedProperties)) {
      const nonFav = props.filter((p) => !favorites.has(p.key));
      if (nonFav.length > 0) {
        result[group] = nonFav;
      }
    }
    return result;
  }, [groupedProperties, favorites]);

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
      {/* Section des propriétés activées (réordonnables) */}
      <div className="px-3 pt-2 pb-1">
        {enabledCount > 0 ? (
          <EnabledPropertyOrder
            items={orderedEnabledProps}
            onRemove={toggleProperty}
            onMove={moveProperty}
            onReorder={reorderProperty}
          />
        ) : (
          <span className="text-[11px] text-muted-foreground italic">
            Aucune propriété activée
          </span>
        )}
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
          {totalAnnotations > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive/70 hover:text-destructive"
              onClick={clearAllAnnotations}
              title="Supprimer toutes les annotations"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
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

      {/* Liste des propriétés groupées */}
      {isLoading ? (
        <Loader message="Chargement des propriétés…" />
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-1">
            <PropertyToggleList
              groupedProperties={groupedWithFavorites}
              favorites={favorites}
              onToggle={toggleProperty}
              onToggleFavorite={toggleFavorite}
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
