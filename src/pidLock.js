const fs = require("fs");
const path = require("path");

function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePidLock(lockFileRelative = ".tele-translate.pid") {
  const lockPath = path.join(process.cwd(), lockFileRelative);

  if (fs.existsSync(lockPath)) {
    try {
      const existingPid = Number(String(fs.readFileSync(lockPath, "utf8")).trim());
      if (isProcessAlive(existingPid)) {
        return { acquired: false, lockPath, existingPid };
      }
    } catch {
      // ignore and overwrite stale/broken lock
    }
  }

  fs.writeFileSync(lockPath, String(process.pid), "utf8");

  const cleanup = () => {
    try {
      if (fs.existsSync(lockPath)) {
        const pidInFile = Number(String(fs.readFileSync(lockPath, "utf8")).trim());
        if (pidInFile === process.pid) fs.unlinkSync(lockPath);
      }
    } catch {
      // ignore
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  return { acquired: true, lockPath };
}

module.exports = { acquirePidLock };


