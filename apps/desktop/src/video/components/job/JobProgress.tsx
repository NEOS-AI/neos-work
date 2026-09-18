import { Square } from "lucide-react";
import { Button } from "@video/components/ui/button";
import { Card, CardContent } from "@video/components/ui/card";
import { Progress } from "@video/components/ui/progress";
import { useI18n } from "@video/lib/i18n";

export function JobProgress({
  percent,
  message,
  label,
  subtitle,
  onCancel,
}: {
  percent: number;
  message: string;
  label: string;
  subtitle?: string;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between text-sm">
          <span>{label}</span>
          <span>{percent.toFixed(0)}%</span>
        </div>
        {subtitle && (
          <p className="truncate text-sm font-medium" title={subtitle}>
            {subtitle}
          </p>
        )}
        <Progress value={percent} />
        <p className="truncate text-xs text-muted-foreground">{message}</p>
        <Button variant="destructive" size="sm" className="gap-2" onClick={onCancel}>
          <Square className="h-3 w-3" />
          {t("common.cancel")}
        </Button>
      </CardContent>
    </Card>
  );
}
