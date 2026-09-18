import { revealPath } from "@video/lib/tauri/commands";
import { toast } from "@video/lib/toast";

export function toastJobDone(title: string, outputPath: string) {
  toast.success(title, {
    description: outputPath,
    action: {
      label: "Show",
      onClick: () => {
        revealPath(outputPath).catch((err) => {
          toast.error("Could not open folder", { description: String(err) });
        });
      },
    },
  });
}
