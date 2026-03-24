import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { PropertyToggleState } from "@/types";

interface PropertyToggleListProps {
  groupedProperties: Record<string, PropertyToggleState[]>;
  onToggle: (key: string) => void;
}

export function PropertyToggleList({
  groupedProperties,
  onToggle,
}: PropertyToggleListProps) {
  const groups = Object.entries(groupedProperties);

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground px-4 text-center">
        Sélectionnez des objets dans le viewer 3D pour afficher leurs propriétés.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {groups.map(([psetName, properties]) => (
        <PropertySetGroup
          key={psetName}
          name={psetName}
          properties={properties}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function PropertySetGroup({
  name,
  properties,
  onToggle,
}: {
  name: string;
  properties: PropertyToggleState[];
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const enabledCount = properties.filter((p) => p.enabled).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 hover:bg-accent/50 rounded-md transition-colors cursor-pointer group">
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
            open && "rotate-90",
          )}
        />
        <span className="text-xs font-semibold text-foreground flex-1 text-left truncate">
          {name}
        </span>
        {enabledCount > 0 && (
          <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full h-4 min-w-4 flex items-center justify-center px-1">
            {enabledCount}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col">
          {properties.map((prop) => (
            <PropertyToggleItem
              key={prop.key}
              property={prop}
              onToggle={onToggle}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PropertyToggleItem({
  property,
  onToggle,
}: {
  property: PropertyToggleState;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex items-center justify-between pl-8 pr-3 py-1.5 hover:bg-accent/30 rounded-sm transition-colors">
      <span
        className={cn(
          "text-xs truncate flex-1 mr-2",
          property.enabled ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {property.propertyName}
      </span>
      <Switch
        checked={property.enabled}
        onCheckedChange={() => onToggle(property.key)}
        className="shrink-0"
      />
    </div>
  );
}
