import fs from "node:fs/promises"
import {createWriteStream} from "node:fs"
import path from "node:path"
import os from "node:os"
import {Readable} from "node:stream"

interface GitHubRelease {
    tag_name: string
    assets: Array<{name: string; browser_download_url: string}>
}

type AssetType = "appimage" | "macos" | "windows-exe"

const REPO = "AgentSpyglass/agentspyglass"
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const CACHE_BASE = path.join(os.homedir(), ".agentspyglass")
const FETCH_TIMEOUT = 30_000

/** Per-version lock to prevent concurrent downloads of the same version. */
const locks = new Map<string, Promise<string>>()

function getPlatformSpec(): {type: AssetType; archPatterns: string[]} {
    const platform = process.platform
    const arch = process.arch

    if (platform === "linux") {
        return {
            type: "appimage",
            archPatterns: arch === "arm64" ? ["arm64", "aarch64"] : ["amd64", "x86_64"]
        }
    }
    if (platform === "darwin") {
        return {
            type: "macos",
            archPatterns: arch === "arm64" ? ["aarch64"] : ["x64", "x86_64"]
        }
    }
    if (platform === "win32") {
        return {
            type: "windows-exe",
            archPatterns: ["x64", "x86_64"]
        }
    }
    throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

function matchAsset(release: GitHubRelease): {name: string; url: string; type: AssetType} {
    const spec = getPlatformSpec()

    for (const asset of release.assets) {
        const lower = asset.name.toLowerCase()
        const matchesArch = spec.archPatterns.some(p => lower.includes(p))
        if (!matchesArch) continue

        if (spec.type === "appimage" && lower.endsWith(".appimage")) {
            return {name: asset.name, url: asset.browser_download_url, type: "appimage"}
        }
        if (spec.type === "macos" && lower.endsWith(".app.tar.gz")) {
            return {name: asset.name, url: asset.browser_download_url, type: "macos"}
        }
        if (spec.type === "windows-exe" && lower.endsWith(".exe")) {
            return {name: asset.name, url: asset.browser_download_url, type: "windows-exe"}
        }
    }

    throw new Error(`No compatible asset found for ${process.platform}/${process.arch}`)
}

function sanitizeVersion(tagName: string): string {
    // Note: different tags may sanitize to same version (e.g. "v1.0" and "v1.0!" both → "v1.0_");
    // last-write-wins in that case, which is acceptable for cache dirs.
    return tagName.replace(/[^A-Za-z0-9._-]/g, "_")
}

function sanitizeAssetFilename(rawName: string): string {
    const base = path.basename(rawName)
    if (!base || base === "." || base === "..") {
        throw new Error(`Invalid asset filename: ${rawName}`)
    }
    return base
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
    let res: Response
    try {
        res = await fetch(API_URL, {
            headers: {"User-Agent": "agentspyglass-opencode"},
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        })
    } catch (err) {
        throw new Error(`Network error fetching releases: ${err instanceof Error ? err.message : err}`)
    }
    if (!res.ok) {
        if (res.status === 404) throw new Error("No releases found")
        throw new Error(`Failed to fetch releases: ${res.status} ${res.statusText}`)
    }
    const data = await res.json() as GitHubRelease
    if (!data.tag_name || !data.assets?.length) {
        throw new Error("No releases found")
    }
    return data
}

async function downloadFile(url: string, dest: string): Promise<void> {
    let res: Response
    try {
        res = await fetch(url, {
            headers: {"User-Agent": "agentspyglass-opencode"},
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        })
    } catch (err) {
        throw new Error(`Network error downloading asset: ${err instanceof Error ? err.message : err}`)
    }
    if (!res.ok) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    }
    if (!res.body) {
        throw new Error("Download response has no body")
    }
    const fileStream = createWriteStream(dest)
    try {
        await new Promise<void>((resolve, reject) => {
            Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>)
                .pipe(fileStream)
                .on("finish", () => resolve())
                .on("error", reject)
        })
    } catch (err) {
        fileStream.destroy()
        await fs.rm(dest, {force: true}).catch(() => {})
        throw err
    }
}

async function findMacOSBinary(cacheDir: string): Promise<string> {
    const entries = await fs.readdir(cacheDir)
    for (const entry of entries) {
        if (!entry.endsWith(".app")) continue
        const macosDir = path.join(cacheDir, entry, "Contents", "MacOS")
        try {
            const binaries = await fs.readdir(macosDir)
            if (binaries.length === 0) {
                throw new Error("No macOS binary found in bundle")
            }
            return path.join(macosDir, binaries[0])
        } catch {
            // not a valid .app, continue
        }
    }
    throw new Error("No .app bundle found after macOS extraction")
}

async function getBinaryPath(cacheDir: string, type: AssetType, assetFilename: string): Promise<string> {
    if (type === "appimage") {
        return path.join(cacheDir, assetFilename)
    }
    if (type === "macos") {
        return findMacOSBinary(cacheDir)
    }
    return path.join(cacheDir, "AgentSpyglass.exe")
}

async function extractAsset(assetPath: string, cacheDir: string, type: AssetType): Promise<void> {
    if (type === "appimage") {
        await fs.chmod(assetPath, 0o755)
        return
    }

    if (type === "macos") {
        try {
            const {execFileSync} = await import("node:child_process")
            execFileSync("tar", ["-xzf", assetPath, "-C", cacheDir], {stdio: "pipe"})
        } catch (err) {
            throw new Error(`Extraction failed: ${err instanceof Error ? err.message : err}`)
        }
        await fs.rm(assetPath).catch(() => {})
        return
    }

    if (type === "windows-exe") {
        await fs.rename(assetPath, path.join(cacheDir, "AgentSpyglass.exe"))
        return
    }
}

async function pruneOldVersions(currentVersion: string): Promise<void> {
    let entries: string[]
    try {
        entries = await fs.readdir(CACHE_BASE)
    } catch {
        return
    }
    for (const entry of entries) {
        if (entry === currentVersion) continue
        const dirPath = path.join(CACHE_BASE, entry)
        try {
            const stat = await fs.stat(dirPath)
            if (stat.isDirectory()) {
                await fs.rm(dirPath, {recursive: true, force: true})
            }
        } catch {
            // ignore cleanup errors
        }
    }
}

async function doEnsureDesktopApp(release: GitHubRelease): Promise<string> {
    const version = sanitizeVersion(release.tag_name)
    const cacheDir = path.join(CACHE_BASE, version)
    const markerPath = path.join(cacheDir, ".version")

    // Check cache
    try {
        await fs.access(markerPath)
        const asset = matchAsset(release)
        const assetFilename = sanitizeAssetFilename(asset.name)
        const binPath = await getBinaryPath(cacheDir, asset.type, assetFilename)
        await fs.access(binPath)
        return binPath
    } catch (err: unknown) {
        const isENOENT = err != null && typeof err === "object" && "code" in err && (err as {code: string}).code === "ENOENT"
        const isMacBundleMissing = err instanceof Error && err.message.includes("No .app bundle found")

        if (isENOENT || isMacBundleMissing) {
            // not cached or corrupt, proceed to download
        } else {
            throw err
        }
    }

    // Download + extract
    const asset = matchAsset(release)
    const assetFilename = sanitizeAssetFilename(asset.name)
    const assetPath = path.join(cacheDir, assetFilename)

    await fs.mkdir(cacheDir, {recursive: true})
    await downloadFile(asset.url, assetPath)
    await extractAsset(assetPath, cacheDir, asset.type)
    await fs.writeFile(markerPath, version)

    // Prune old versions to avoid unbounded disk growth
    await pruneOldVersions(version)

    return await getBinaryPath(cacheDir, asset.type, assetFilename)
}

export async function ensureDesktopApp(): Promise<string> {
    const release = await fetchLatestRelease()
    const version = sanitizeVersion(release.tag_name)

    const existing = locks.get(version)
    if (existing) return existing

    const promise = doEnsureDesktopApp(release)
    locks.set(version, promise)
    try {
        return await promise
    } finally {
        locks.delete(version)
    }
}
