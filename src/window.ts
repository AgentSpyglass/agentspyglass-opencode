import path from "node:path"
import {type ChildProcess, spawn} from "node:child_process"

let windowProcess: ChildProcess | undefined;
export async function openWindow(pluginDir: string) {
    if (windowProcess && !windowProcess.killed) return;

    const devMode = process.env.AGENTSPYGLASS_DEV === "1";
    const desktopDir = path.join(pluginDir, "..", "agentspyglass");
    if (devMode) {
        windowProcess = spawn("npm", ["run", "tauri", "dev"], {
            cwd: desktopDir,
            stdio: "ignore",
            detached: true,
        });
    } else {
        const binName = process.platform === "win32" ? "agentspyglass-window.exe" : "agentspyglass-window";
        const binPath = path.join(desktopDir, "src-tauri", "target", "release", binName);
        windowProcess = spawn(binPath, [], {stdio: "ignore", detached: true})
    }

    windowProcess.unref();
}

export function stopWindow() {
    windowProcess?.kill();
    windowProcess = undefined;
}
