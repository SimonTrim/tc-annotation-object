import { Loader2 } from "lucide-react";

export function Loader({ message = "Chargement…" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="text-xs">{message}</span>
    </div>
  );
}
