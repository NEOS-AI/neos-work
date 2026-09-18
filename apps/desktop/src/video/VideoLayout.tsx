import { NavLink, Outlet } from "react-router-dom";

import { LocaleToggle } from "./components/i18n/LocaleToggle.js";
import { LocaleProvider, useI18n } from "./lib/i18n.js";
import { VideoToaster } from "./lib/toast.js";

const GROUPS: { titleKey: string | null; items: { to: string; labelKey: string }[] }[] = [
  {
    titleKey: null,
    items: [
      { to: "/video", labelKey: "nav.home" },
      { to: "/video/jobs", labelKey: "nav.jobs" },
      { to: "/video/viewer", labelKey: "nav.viewer" },
      { to: "/video/timeline", labelKey: "nav.timeline" },
    ],
  },
  {
    titleKey: "nav.inspect",
    items: [{ to: "/video/probe", labelKey: "nav.analyze" }],
  },
  {
    titleKey: "nav.convert",
    items: [
      { to: "/video/download", labelKey: "nav.download" },
      { to: "/video/transcode", labelKey: "nav.transcode" },
      { to: "/video/extract", labelKey: "nav.extract" },
      { to: "/video/gif", labelKey: "nav.gif" },
    ],
  },
  {
    titleKey: "nav.edit",
    items: [
      { to: "/video/trim", labelKey: "nav.trim" },
      { to: "/video/clips", labelKey: "nav.clips" },
      { to: "/video/concat", labelKey: "nav.concat" },
      { to: "/video/crop", labelKey: "nav.crop" },
      { to: "/video/resize", labelKey: "nav.resize" },
      { to: "/video/transform", labelKey: "nav.rotate" },
      { to: "/video/speed", labelKey: "nav.speed" },
      { to: "/video/fade", labelKey: "nav.fade" },
      { to: "/video/volume", labelKey: "nav.volume" },
      { to: "/video/watermark", labelKey: "nav.watermark" },
    ],
  },
];

function VideoNav() {
  const { t } = useI18n();
  return (
    <aside
      className="flex w-44 shrink-0 flex-col border-r py-2"
      style={{ borderColor: "var(--border-primary)" }}
    >
      <div className="px-3 pb-2">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("app.name")}
        </p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {t("app.tagline")}
        </p>
      </div>
      <nav className="flex-1 space-y-2 overflow-y-auto px-2">
        {GROUPS.map((group) => (
          <div key={group.titleKey ?? "main"} className="space-y-0.5">
            {group.titleKey && (
              <p
                className="px-2 pb-0.5 text-[10px] font-medium tracking-wide uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                {t(group.titleKey)}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/video"}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-1 text-xs ${isActive ? "font-medium" : ""}`
                }
                style={({ isActive }) => ({
                  backgroundColor: isActive
                    ? "color-mix(in srgb, var(--bg-tertiary) 80%, transparent)"
                    : undefined,
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                })}
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="px-2 pt-2">
        <LocaleToggle />
      </div>
    </aside>
  );
}

function VideoShell() {
  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0">
      <VideoNav />
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <Outlet />
      </div>
      <VideoToaster />
    </div>
  );
}

export function VideoLayout() {
  return (
    <LocaleProvider>
      <VideoShell />
    </LocaleProvider>
  );
}
