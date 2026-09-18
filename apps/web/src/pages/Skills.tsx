/**
 * Web Skills — list / scan / toggle / delete + thin catalog search/preview/install.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import {
  ApiError,
  WebApiClient,
  type CatalogPreviewResult,
  type RemoteSkillHit,
  type SkillAmbiguousCandidate,
} from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';
import { skillsCopy } from '../lib/skills-i18n.js';

const CATALOG_DEBOUNCE_MS = 250;
const CATALOG_MIN_QUERY = 2;

type SkillRow = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  category?: string;
  version?: string | null;
  source?: string;
};

function settingFlagOn(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  return raw.trim().toLowerCase() !== 'false';
}

function scrubText(raw: unknown, max = 200): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\0\r\n]+/g, ' ').slice(0, max);
}

export function Skills() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [catalogEnabled, setCatalogEnabled] = useState(true);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogHits, setCatalogHits] = useState<RemoteSkillHit[] | null>(null);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogSearchError, setCatalogSearchError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CatalogPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ambiguous, setAmbiguous] = useState<{
    input: { id?: string; url?: string };
    candidates: SkillAmbiguousCandidate[];
  } | null>(null);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listSkills();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load skills'));
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, nav]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    client
      .getSettings()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setCatalogEnabled(true);
          return;
        }
        setCatalogEnabled(settingFlagOn(res.data['skills.remoteCatalogEnabled'], true));
      })
      .catch((err) => {
        if (cancelled) return;
        setCatalogEnabled(true);
        if (err instanceof ApiError && err.status === 401) {
          clearConnection();
          nav('/');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, nav]);

  useEffect(() => {
    if (!catalogEnabled) {
      setCatalogHits(null);
      setCatalogSearchError(null);
      setCatalogSearching(false);
      return;
    }
    const q = catalogQuery.trim();
    if (q.length < CATALOG_MIN_QUERY) {
      setCatalogHits(null);
      setCatalogSearchError(null);
      setCatalogSearching(false);
      return;
    }
    let cancelled = false;
    setCatalogSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await client.searchSkillCatalog(q);
          if (cancelled) return;
          if (res.ok && res.data) {
            setCatalogHits(Array.isArray(res.data.skills) ? res.data.skills : []);
            setCatalogSearchError(null);
          } else {
            setCatalogHits([]);
            setCatalogSearchError(scrubError(res.error, skillsCopy.catalogUnavailable));
          }
        } catch (err) {
          if (cancelled) return;
          setCatalogHits([]);
          setCatalogSearchError(scrubError(err, skillsCopy.catalogUnavailable));
        } finally {
          if (!cancelled) setCatalogSearching(false);
        }
      })();
    }, CATALOG_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogEnabled, catalogQuery, client]);

  const handleScan = async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await client.scanSkills();
      if (!res.ok) {
        setError(scrubError(res.error, 'Scan failed'));
        return;
      }
      setScanMsg(`Scanned ${res.data?.scanned ?? 0} · total ${res.data?.total ?? 0}`);
      await reload();
    } catch (err) {
      setError(scrubError(err, 'Scan failed'));
    } finally {
      setScanning(false);
    }
  };

  const handleToggle = async (s: SkillRow) => {
    const res = await client.toggleSkill(s.id, !s.enabled);
    if (!res.ok) {
      setError(scrubError(res.error, 'Toggle failed'));
      return;
    }
    await reload();
  };

  const handleDelete = async (id: string) => {
    const target = items.find((s) => s.id === id);
    const copy =
      target?.source === 'remote'
        ? skillsCopy.deleteRemoteFilesConfirm
        : skillsCopy.deleteRegistryConfirm;
    if (!window.confirm(copy)) return;
    const res = await client.deleteSkill(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    await reload();
  };

  const handlePreview = async (input: { id?: string; url?: string }) => {
    setPreviewLoading(true);
    setError(null);
    try {
      const res = await client.previewRemoteSkill(input);
      if (res.ok && res.data) {
        setPreview(res.data);
        return;
      }
      setError(scrubError(res.error, skillsCopy.catalogUnavailable));
    } catch (err) {
      setError(scrubError(err, skillsCopy.catalogUnavailable));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleInstall = async (input: { id?: string; url?: string; slug?: string }) => {
    if (!window.confirm(skillsCopy.installConfirm)) return;
    setError(null);
    try {
      const res = await client.installRemoteSkill({ ...input, confirm: true });
      if (!res.ok) {
        const candidates = Array.isArray(res.candidates) ? res.candidates : [];
        if (res.error === 'skill_ambiguous' && candidates.length > 0) {
          setAmbiguous({ input: { id: input.id, url: input.url }, candidates });
          return;
        }
        setError(scrubError(res.error, 'Install failed'));
        return;
      }
      setAmbiguous(null);
      setPreview(null);
      await reload();
    } catch (err) {
      setError(scrubError(err, 'Install failed'));
    }
  };

  return (
    <div className="layout stack" data-testid="skills-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Skills</h1>
          <p className="muted">Bundled and installed SKILL.md packages</p>
        </div>
        <WebNav current="/skills" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <section className="card stack" data-testid="skills-catalog">
        <h2 style={{ margin: 0, fontSize: '1rem' }}>{skillsCopy.catalogTitle}</h2>
        {!catalogEnabled ? (
          <p className="muted" data-testid="skills-catalog-disabled">
            {skillsCopy.catalogDisabled}
          </p>
        ) : (
          <>
            <input
              className="input"
              type="search"
              data-testid="skills-catalog-search"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder={skillsCopy.catalogSearchPlaceholder}
            />
            {catalogSearchError && (
              <p className="err" data-testid="skills-catalog-search-error">
                {catalogSearchError}
              </p>
            )}
            {catalogSearching && <p className="muted">Searching…</p>}
            {catalogQuery.trim().length >= CATALOG_MIN_QUERY ? (
              <ul
                data-testid="skills-catalog-results"
                style={{ margin: 0, padding: 0, listStyle: 'none' }}
              >
                {(catalogHits ?? []).map((hit) => (
                  <li
                    key={hit.id}
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                    data-testid={`skills-catalog-row-${hit.id}`}
                  >
                    <div>
                      <strong>{scrubText(hit.name, 160) || hit.id}</strong>
                      <div className="muted">
                        {scrubText(hit.source, 80)}
                        {typeof hit.installs === 'number' ? ` · ${hit.installs}` : ''}
                      </div>
                    </div>
                    <div className="row">
                      <a
                        href={/^https?:\/\//i.test(hit.url) ? hit.url : `https://skills.sh/${hit.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {skillsCopy.skillsShLink}
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        data-testid={`skills-catalog-preview-${hit.id}`}
                        disabled={previewLoading}
                        onClick={() => void handlePreview({ id: hit.id })}
                      >
                        {skillsCopy.preview}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        data-testid={`skills-catalog-install-${hit.id}`}
                        onClick={() => void handleInstall({ id: hit.id })}
                      >
                        {skillsCopy.install}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{skillsCopy.catalogEmpty}</p>
            )}
          </>
        )}
      </section>
      {preview && (
        <section className="card stack" data-testid="skills-preview-drawer">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '1rem' }}>
              {scrubText(preview.name, 120) || preview.slug}
            </h2>
            <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          {preview.description ? (
            <p className="muted">{scrubText(preview.description, 2_000)}</p>
          ) : null}
          <p className="muted">
            {preview.license
              ? scrubText(preview.license, 80)
              : skillsCopy.licenseUnknown}
          </p>
          <p className="muted">{skillsCopy.thirdPartyDisclaimer}</p>
          <pre
            className="mono"
            style={{
              whiteSpace: 'pre-wrap',
              maxHeight: 240,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {scrubText(preview.skillMd, 32_000)}
          </pre>
          <button
            type="button"
            className="btn"
            data-testid="skills-preview-install"
            onClick={() => void handleInstall({ id: preview.id, url: preview.sourceUrl ?? undefined })}
          >
            {skillsCopy.install}
          </button>
        </section>
      )}
      {ambiguous && (
        <section className="card stack" data-testid="skills-ambiguous">
          <h2 style={{ margin: 0, fontSize: '1rem' }}>{skillsCopy.skillAmbiguous}</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {ambiguous.candidates.map((c) => (
              <li key={c.slug} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{scrubText(c.name || c.slug, 80)}</span>
                <button
                  type="button"
                  className="btn"
                  data-testid={`skills-ambiguous-pick-${c.slug}`}
                  onClick={() => void handleInstall({ ...ambiguous.input, slug: c.slug })}
                >
                  {skillsCopy.chooseSkill}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost" onClick={() => setAmbiguous(null)}>
            Cancel
          </button>
        </section>
      )}
      <div className="row">
        <button type="button" className="btn" data-testid="skills-scan" disabled={scanning} onClick={() => void handleScan()}>
          {scanning ? 'Scanning…' : 'Scan skills'}
        </button>
        {scanMsg && <span className="muted">{scanMsg}</span>}
      </div>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="skill-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((s) => (
            <li key={s.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`skill-${s.id}`}>{s.name}</strong>
                <span className="muted">
                  {s.category ? ` · ${s.category}` : ''}
                  {s.enabled ? '' : ' · off'}
                </span>
                {s.description ? <p className="muted">{s.description}</p> : null}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`skill-toggle-${s.id}`}
                  onClick={() => void handleToggle(s)}
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`skill-delete-${s.id}`}
                  onClick={() => void handleDelete(s.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="muted">No skills</li>}
        </ul>
      )}
    </div>
  );
}
