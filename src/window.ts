import path from "node:path"
import {type ChildProcess, spawn} from "node:child_process"
import {ensureDesktopApp} from "./download"

let windowProcess: ChildProcess | undefined;
export async function openWindow(pluginDir: string) {
    if (windowProcess && !windowProcess.killed) return;

    const devMode = process.env.AGENTSPYGLASS_DEV === "1";
    if (devMode) {
        const desktopDir = path.join(pluginDir, "..", "agentspyglass");
        windowProcess = spawn("npm", ["run", "tauri", "dev"], {
            cwd: desktopDir,
            stdio: "ignore",
            detached: true,
        });
    } else {
        const binPath = await ensureDesktopApp()
        windowProcess = spawn(binPath, [], {stdio: "ignore", detached: true})
    }

    windowProcess.unref();
}

export function stopWindow() {
    windowProcess?.kill();
    windowProcess = undefined;
}
