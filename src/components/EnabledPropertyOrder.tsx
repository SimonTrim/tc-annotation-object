import { useRef, useState, useCallback } from "react";
import { GripVertical, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PropertyToggleState } from "@/types";

interface EnabledPropertyOrderProps {
  items: PropertyToggleState[];
  onRemove: (key: string) => void;
  onMove: (key: string, direction: "up" | "down") => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function EnabledPropertyOrder({
  items,
  onRemove,
  onMove,
  onReorder,
}: EnabledPropertyOrderProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      dragNodeRef.current = e.currentTarget as HTMLDivElement;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      requestAnimationFrame(() => {
        if (dragNodeRef.current) {
          dragNodeRef.current.style.opacity = "0.4";
        }
      });
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = "1";
    }
    setDragIndex(null);
    setOverIndex(null);
    dragNodeRef.current = null;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIndex !== null && index !== dragIndex) {
        setOverIndex(index);
      }
    },
    [dragIndex],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!isNaN(fromIndex) && fromIndex !== toIndex) {
        onReorder(fromIndex, toIndex);
      }
      setDragIndex(null);
      setOverIndex(null);
    },
    [onReorder],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold px-1 mb-0.5">
        Ordre d'affichage ({items.length}/6)
      </span>

      {items.map((item, index) => {
        const isOver = overIndex === index && dragIndex !== index;

        return (
          <div
            key={item.key}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            className={`
              flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px]
              bg-primary/8 border border-transparent transition-all
              ${isOver ? "border-primary border-dashed" : ""}
              ${dragIndex === index ? "opacity-40" : ""}
            `}
          >
            <GripVertical className="h-3 w-3 text-muted-foreground/50 cursor-grab shrink-0" />

            <span className="text-[9px] text-muted-foreground/60 font-mono w-3 text-center shrink-0">
              {index + 1}
            </span>

            <span className="flex-1 truncate font-medium text-foreground">
              {item.propertyName}
            </span>

            <span className="text-[9px] text-muted-foreground/60 truncate max-w-[60px]">
              {item.propertySet}
            </span>

            <div className="flex items-center shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === 0}
                onClick={() => onMove(item.key, "up")}
                title="Monter"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === items.length - 1}
                onClick={() => onMove(item.key, "down")}
                title="Descendre"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(item.key)}
                title="Retirer"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
