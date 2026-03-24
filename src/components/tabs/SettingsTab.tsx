import { Paintbrush, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnnotationSettings } from "@/types";

interface SettingsTabProps {
  settings: AnnotationSettings;
  onUpdate: (patch: Partial<AnnotationSettings>) => void;
  onReset: () => void;
}

const SEPARATORS = [
  { label: "Point ( · )", value: " · " },
  { label: "Virgule ( , )", value: ", " },
  { label: "Pipe ( | )", value: " | " },
  { label: "Tiret ( - )", value: " - " },
  { label: "Slash ( / )", value: " / " },
];

export function SettingsTab({ settings, onUpdate, onReset }: SettingsTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {/* Couleur des annotations */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Couleur des annotations
          </Label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="color"
                value={settings.color}
                onChange={(e) => onUpdate({ color: e.target.value })}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-mono">{settings.color}</span>
              <span className="text-[10px] text-muted-foreground">
                Couleur du texte et des lignes
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 ml-auto"
              onClick={() => onUpdate({ color: "#0063a3" })}
              title="Réinitialiser (Trimble Blue)"
            >
              <Paintbrush className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Séparateur */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Séparateur d'attributs
          </Label>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Utilisé quand « Affichage horizontal » est activé
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {SEPARATORS.map((sep) => (
              <button
                key={sep.value}
                onClick={() => onUpdate({ separator: sep.value })}
                className={`text-xs px-3 py-2 rounded-md border transition-colors cursor-pointer ${
                  settings.separator === sep.value
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border hover:bg-accent text-foreground"
                }`}
              >
                {sep.label}
              </button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Options d'affichage */}
        <div className="flex flex-col gap-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Options d'affichage
          </Label>

          <div className="flex items-center gap-3">
            <Checkbox
              id="horizontal"
              checked={settings.horizontal}
              onCheckedChange={(checked) =>
                onUpdate({ horizontal: checked === true })
              }
            />
            <Label htmlFor="horizontal" className="text-xs cursor-pointer">
              Afficher les propriétés horizontalement
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="showUnits"
              checked={settings.showUnits}
              onCheckedChange={(checked) =>
                onUpdate({ showUnits: checked === true })
              }
            />
            <Label htmlFor="showUnits" className="text-xs cursor-pointer">
              Afficher les unités
            </Label>
          </div>
        </div>

        <Separator />

        {/* Limite d'objets */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nombre max d'objets annotés
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={50}
              value={settings.maxObjects}
              onChange={(e) =>
                onUpdate({
                  maxObjects: Math.max(1, Math.min(50, parseInt(e.target.value) || 20)),
                })
              }
              className="w-20 h-8 rounded-md border border-input bg-background px-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-[11px] text-muted-foreground">
              objets (1–50)
            </span>
          </div>
        </div>

        <Separator />

        {/* Réinitialiser */}
        <Button variant="outline" size="sm" onClick={onReset} className="w-full">
          <RotateCcw className="h-3.5 w-3.5" />
          Réinitialiser les paramètres
        </Button>
      </div>
    </ScrollArea>
  );
}
