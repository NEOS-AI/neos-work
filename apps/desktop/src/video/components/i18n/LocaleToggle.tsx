import { Languages } from "lucide-react";
import { Button } from "@video/components/ui/button";
import { useI18n } from "@video/lib/i18n";

export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "ko" ? "en" : "ko";
  return (
    <Button
      variant="outline"
      className="w-full justify-start gap-2"
      onClick={() => setLocale(next)}
    >
      <Languages className="h-4 w-4" />
      {next === "en" ? t("lang.en") : t("lang.ko")}
    </Button>
  );
}
