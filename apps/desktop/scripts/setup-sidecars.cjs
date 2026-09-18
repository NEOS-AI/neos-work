#!/usr/bin/env node
/**
 * Create platform-correct FFmpeg/FFprobe sidecar names for Tauri:
 *   src-tauri/binaries/ffmpeg-<target-triple>[.exe]
 *   src-tauri/binaries/ffprobe-<target-triple>[.exe]
 *
 * Default (dev): look for Homebrew, common install prefixes, then PATH.
 *   On Unix we symlink; on Windows we copy (symlinks need elevation).
 *
 * --release: download pinned GPL static builds from scripts/sidecar-lock.json
 *   and write regular files (never Homebrew symlinks). No PATH fallback.
 */

const { execFileSync, execSync } = require("child_process");
const {
  existsSync,
  mkdirSync,
  symlinkSync,
  copyFileSync,
  lstatSync,
  unlinkSync,
  readFileSync,
  createWriteStream,
  createReadStream,
  chmodSync,
} = require("fs");
const { join, dirname, extname } = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

function targetTriple() {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") return "aarch64-apple-darwin";
  if (p === "darwin" && a === "x64") return "x86_64-apple-darwin";
  if (p === "linux" && a === "arm64") return "aarch64-unknown-linux-gnu";
  if (p === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
  if (p === "win32" && a === "arm64") return "aarch64-pc-windows-msvc";
  if (p === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`Unsupported platform ${p}/${a}. Add a sidecar triple in scripts/setup-sidecars.js.`);
}

function which(cmd) {
  try {
    const command = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
    const out = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().split(/\r?\n/).find(Boolean) || null;
  } catch {
    return null;
  }
}

function findBinary(name) {
  const win = process.platform === "win32";
  const exe = win ? `${name}.exe` : name;
  const candidates = [
    which(name),
    which(exe),
    "/opt/homebrew/bin/" + name,
    "/usr/local/bin/" + name,
    "/usr/bin/" + name,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", exe),
    "C:\\ffmpeg\\bin\\" + exe,
    "C:\\Program Files\\ffmpeg\\bin\\" + exe,
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function removeIfExists(dest) {
  if (existsSync(dest)) {
    unlinkSync(dest);
  }
}

function linkOrCopy(src, dest) {
  removeIfExists(dest);
  if (process.platform === "win32") {
    copyFileSync(src, dest);
    return "copied";
  }
  symlinkSync(src, dest);
  return "symlinked";
}

function parseArgs(argv) {
  const args = argv.filter((a) => a !== "--");
  let release = false;
  let triple = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--release") {
      release = true;
    } else if (a === "--triple") {
      triple = args[++i];
      if (!triple) throw new Error("--triple requires a target triple");
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { release, triple };
}

function cacheDir() {
  if (process.env.VIDEO_RS_SIDECAR_CACHE) return process.env.VIDEO_RS_SIDECAR_CACHE;
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "video-rs", "sidecars");
  if (process.platform === "darwin") return join(os.homedir(), "Library", "Caches", "video-rs", "sidecars");
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || join(os.homedir(), "AppData", "Local");
    return join(base, "video-rs", "sidecars");
  }
  return join(os.homedir(), ".cache", "video-rs", "sidecars");
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (current, hops) => {
      if (hops > 8) {
        reject(new Error(`Too many redirects for ${url}`));
        return;
      }
      const client = current.startsWith("https:") ? https : http;
      const req = client.get(
        current,
        { headers: { "User-Agent": "video-rs-setup-sidecars" } },
        (res) => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            const next = new URL(loc, current).toString();
            res.resume();
            follow(next, hops + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`GET ${current} -> ${res.statusCode}`));
            return;
          }
          mkdirSync(dirname(dest), { recursive: true });
          const out = createWriteStream(dest);
          res.pipe(out);
          out.on("finish", () => out.close(resolve));
          out.on("error", reject);
        }
      );
      req.on("error", reject);
    };
    follow(url, 0);
  });
}

function extractArchive(archivePath, destDir, kind) {
  mkdirSync(destDir, { recursive: true });
  if (kind === "tar.xz") {
    execFileSync("tar", ["-xJf", archivePath, "-C", destDir]);
    return;
  }
  if (kind !== "zip") {
    throw new Error(`Unsupported archive type: ${kind}`);
  }
  if (process.platform === "win32") {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Force -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}'`,
    ]);
    return;
  }
  execFileSync("unzip", ["-o", "-q", archivePath, "-d", destDir]);
}

function copyRegular(src, dest) {
  if (!existsSync(src)) {
    throw new Error(`Extracted file missing: ${src}`);
  }
  removeIfExists(dest);
  copyFileSync(src, dest);
  if (process.platform !== "win32") {
    chmodSync(dest, 0o755);
  }
  if (lstatSync(dest).isSymbolicLink()) {
    throw new Error(`Destination is still a symlink: ${dest}`);
  }
}

function runTool(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function requireTokens(haystack, tokens, label) {
  const missing = tokens.filter((t) => !haystack.includes(t));
  if (missing.length) {
    throw new Error(`${label} missing: ${missing.join(", ")}`);
  }
}

function verifySidecar(ffmpegBin, ffprobeBin, hostTriple, destTriple) {
  if (hostTriple !== destTriple) {
    console.log(`skip runtime checks (host ${hostTriple} != ${destTriple})`);
    return;
  }

  const version = runTool(ffmpegBin, ["-hide_banner", "-version"]);
  runTool(ffprobeBin, ["-hide_banner", "-version"]);
  if (/--enable-nonfree|--enable-libfdk-aac|openssl-nonfree/.test(version)) {
    throw new Error("Rejected nonfree FFmpeg configuration");
  }

  const encoders = runTool(ffmpegBin, ["-hide_banner", "-encoders"]);
  requireTokens(encoders, ["libx264", "libx265", "libvpx-vp9", "flac", "pcm_s16le", "libopus"], "encoders");
  if (!encoders.includes("libmp3lame") && !/\bmp3\b/.test(encoders)) {
    throw new Error("encoders missing: mp3 / libmp3lame");
  }
  if (!/\baac\b/.test(encoders)) {
    throw new Error("encoders missing: aac");
  }
  if (!/\bpng\b/.test(encoders) || !/\bgif\b/.test(encoders)) {
    throw new Error("encoders missing: png and/or gif");
  }

  const filters = runTool(ffmpegBin, ["-hide_banner", "-filters"]);
  requireTokens(
    filters,
    [
      "scale",
      "crop",
      "transpose",
      "volume",
      "loudnorm",
      "afade",
      "fade",
      "drawtext",
      "overlay",
      "setpts",
      "atempo",
      "palettegen",
      "paletteuse",
      "subtitles",
    ],
    "filters"
  );

  const demuxers = runTool(ffmpegBin, ["-hide_banner", "-demuxers"]);
  if (!demuxers.includes("concat")) {
    throw new Error("demuxers missing: concat");
  }

  if (process.platform === "darwin") {
    const otool = runTool("otool", ["-L", ffmpegBin]);
    if (/\/opt\/homebrew|\/usr\/local\/Cellar/.test(otool)) {
      throw new Error("ffmpeg still links Homebrew/Cellar libraries");
    }
    const otoolP = runTool("otool", ["-L", ffprobeBin]);
    if (/\/opt\/homebrew|\/usr\/local\/Cellar/.test(otoolP)) {
      throw new Error("ffprobe still links Homebrew/Cellar libraries");
    }
  } else if (process.platform === "linux") {
    try {
      const ldd = runTool("ldd", [ffmpegBin]);
      if (/libavcodec|libavformat|libavfilter|libx264|libx265/.test(ldd)) {
        throw new Error("ffmpeg dynamically links distro libav*/libx26*");
      }
    } catch (e) {
      if (e.status !== 0 && /not a dynamic executable/i.test(String(e.stderr || e.message))) {
        return;
      }
      if (/dynamically links/.test(e.message)) throw e;
    }
  }
}

async function setupRelease(repoRoot, binDir, destTriple, hostTriple) {
  const lockPath = join(repoRoot, "scripts", "sidecar-lock.json");
  if (!existsSync(lockPath)) {
    throw new Error(`Missing lockfile: ${lockPath}`);
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const entry = lock.triples && lock.triples[destTriple];
  if (!entry) {
    throw new Error(`No lockfile entry for ${destTriple}`);
  }
  if (entry.status !== "pinned") {
    throw new Error(
      `Lockfile marks ${destTriple} as ${entry.status || "unavailable"}: ${entry.reason || "no pinned static build"}`
    );
  }
  if (!Array.isArray(entry.artifacts) || entry.artifacts.length === 0) {
    throw new Error(`Lockfile entry for ${destTriple} has no artifacts`);
  }

  const ext = destTriple.includes("windows") ? ".exe" : "";
  const destFfmpeg = join(binDir, `ffmpeg-${destTriple}${ext}`);
  const destFfprobe = join(binDir, `ffprobe-${destTriple}${ext}`);
  const cache = cacheDir();
  mkdirSync(cache, { recursive: true });

  let ffmpegSrc = null;
  let ffprobeSrc = null;

  try {
    for (const art of entry.artifacts) {
      if (!art.url || !art.sha256 || !art.archive) {
        throw new Error(`Artifact ${art.name || "?"} is missing url/sha256/archive`);
      }
      if (/\/latest\//.test(art.url)) {
        throw new Error(`Refusing floating /latest/ URL: ${art.url}`);
      }
      const suffix = art.archive === "tar.xz" ? ".tar.xz" : extname(new URL(art.url).pathname) || ".zip";
      const archivePath = join(cache, `${art.sha256}${suffix}`);
      if (existsSync(archivePath)) {
        const got = await sha256File(archivePath);
        if (got !== art.sha256) {
          unlinkSync(archivePath);
          throw new Error(`Cached ${art.name} sha256 mismatch (got ${got})`);
        }
        console.log(`cached     ${art.name}  ${archivePath}`);
      } else {
        console.log(`download   ${art.name}  ${art.url}`);
        const tmp = `${archivePath}.part`;
        await download(art.url, tmp);
        const got = await sha256File(tmp);
        if (got !== art.sha256) {
          unlinkSync(tmp);
          throw new Error(`Downloaded ${art.name} sha256 mismatch (got ${got}, want ${art.sha256})`);
        }
        copyFileSync(tmp, archivePath);
        unlinkSync(tmp);
      }

      const extractDir = join(cache, "extract", art.sha256);
      if (!existsSync(extractDir)) {
        extractArchive(archivePath, extractDir, art.archive);
      }
      if (art.ffmpeg) {
        ffmpegSrc = join(extractDir, art.ffmpeg);
      }
      if (art.ffprobe) {
        ffprobeSrc = join(extractDir, art.ffprobe);
      }
    }

    if (!ffmpegSrc || !ffprobeSrc) {
      throw new Error("Lockfile artifacts did not provide both ffmpeg and ffprobe paths");
    }

    copyRegular(ffmpegSrc, destFfmpeg);
    copyRegular(ffprobeSrc, destFfprobe);
    console.log(`copied     ffmpeg   →  ${destFfmpeg}`);
    console.log(`copied     ffprobe  →  ${destFfprobe}`);

    verifySidecar(destFfmpeg, destFfprobe, hostTriple, destTriple);
    console.log("");
    console.log(`Release sidecars ready for ${destTriple} (${entry.source} ${entry.version}).`);
  } catch (err) {
    try {
      removeIfExists(destFfmpeg);
      removeIfExists(destFfprobe);
    } catch {
      // keep original error
    }
    throw err;
  }
}

function setupDev(binDir, triple) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const required = ["ffmpeg", "ffprobe"];
  const optional = ["yt-dlp"];
  const missing = [];

  for (const name of required) {
    const src = findBinary(name);
    if (!src) {
      missing.push(name);
      continue;
    }
    const dest = join(binDir, `${name}-${triple}${ext}`);
    const mode = linkOrCopy(src, dest);
    console.log(`${mode.padEnd(10)} ${name}  ${src}  →  ${dest}`);
  }

  for (const name of optional) {
    const dest = join(binDir, `${name}-${triple}${ext}`);
    const src = findBinary(name);
    if (src) {
      const mode = linkOrCopy(src, dest);
      console.log(`${mode.padEnd(10)} ${name}  ${src}  →  ${dest}`);
    } else {
      if (existsSync(dest) && lstatSync(dest).isFile() && lstatSync(dest).size === 0) {
        unlinkSync(dest);
      }
      console.warn(`warning    ${name} not found (optional). Install with brew/pipx/winget for Download.`);
    }
  }

  if (missing.length) {
    console.error("");
    console.error(`Could not find: ${missing.join(", ")}`);
    console.error("Install FFmpeg and re-run this script:");
    console.error("  macOS:   brew install ffmpeg");
    console.error("  Ubuntu:  sudo apt install ffmpeg");
    console.error("  Windows: winget install Gyan.FFmpeg   (or place ffmpeg.exe on PATH)");
    process.exit(1);
  }

  console.log("");
  console.log(`Sidecars ready for ${triple}.`);
}

async function main() {
  const { release, triple: tripleOverride } = parseArgs(process.argv.slice(2));
  const repoRoot = join(__dirname, "..");
  const binDir = join(repoRoot, "src-tauri", "binaries");
  mkdirSync(binDir, { recursive: true });

  const hostTriple = targetTriple();
  const destTriple = tripleOverride || hostTriple;

  if (release) {
    await setupRelease(repoRoot, binDir, destTriple, hostTriple);
    return;
  }

  setupDev(binDir, destTriple);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

void dirname;
