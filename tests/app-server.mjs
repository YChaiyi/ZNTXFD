import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const projectRoot = process.cwd();
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

let built = false;

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_ENV;
  if (!("ZNT_CONTENT_DIR" in extra)) delete env.ZNT_CONTENT_DIR;
  return env;
}

export function buildApp() {
  if (built) return;
  execFileSync(process.execPath, [nextBin, "build"], {
    cwd: projectRoot,
    env: cleanEnv(),
    stdio: "pipe",
    encoding: "utf8",
  });
  built = true;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startApp(t, { contentDir, env: extraEnv = {} }) {
  buildApp();
  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: projectRoot,
    env: cleanEnv({ ZNT_CONTENT_DIR: contentDir, ...extraEnv }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  }));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early (${child.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status < 500) break;
    } catch {
      // Server not accepting connections yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`next start did not become ready:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { baseUrl };
}
