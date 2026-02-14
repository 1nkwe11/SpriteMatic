import fs from "fs";
import path from "path";
import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import { env } from "../config/env.js";
import { logger, logSession } from "./logger.js";

type PacketCaptureHandle = {
  pcapPath: string;
  stop: () => Promise<void>;
};

const splitArgs = (value: string) => {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
};

export const startPacketCapture = (): PacketCaptureHandle | null => {
  if (!env.ENABLE_TCPDUMP) {
    logger.info("packet_capture_disabled");
    return null;
  }

  const pcapPath = path.join(logSession.directory, env.TCPDUMP_FILE_NAME);
  const stdoutPath = path.join(logSession.directory, "tcpdump.stdout.log");
  const stderrPath = path.join(logSession.directory, "tcpdump.stderr.log");
  const stdoutStream = fs.createWriteStream(stdoutPath, { flags: "a", encoding: "utf8" });
  const stderrStream = fs.createWriteStream(stderrPath, { flags: "a", encoding: "utf8" });

  const args: string[] = ["-U", "-w", pcapPath];
  if (env.TCPDUMP_INTERFACE) {
    args.push("-i", env.TCPDUMP_INTERFACE);
  }
  if (env.TCPDUMP_EXTRA_ARGS) {
    args.push(...splitArgs(env.TCPDUMP_EXTRA_ARGS));
  }
  if (env.TCPDUMP_FILTER) {
    args.push(...splitArgs(env.TCPDUMP_FILTER));
  }

  let proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const closeStreams = () =>
    Promise.all([
      new Promise<void>((resolve) => stdoutStream.end(() => resolve())),
      new Promise<void>((resolve) => stderrStream.end(() => resolve()))
    ]).then(() => undefined);

  try {
    proc = spawn(env.TCPDUMP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    void closeStreams();
    logger.error("packet_capture_spawn_failed", {
      tcpdumpPath: env.TCPDUMP_PATH,
      args,
      error
    });
    return null;
  }

  const child = proc;
  if (!child) {
    void closeStreams();
    logger.error("packet_capture_spawn_failed", {
      tcpdumpPath: env.TCPDUMP_PATH,
      args,
      error: "tcpdump process did not start"
    });
    return null;
  }
  child.stdout.pipe(stdoutStream);
  child.stderr.pipe(stderrStream);

  child.on("error", (error) => {
    logger.error("packet_capture_runtime_error", {
      tcpdumpPath: env.TCPDUMP_PATH,
      args,
      error
    });
  });

  child.on("close", (code, signal) => {
    closed = true;
    logger.info("packet_capture_exited", {
      code,
      signal,
      pcapPath
    });
    void closeStreams();
  });

  logger.info("packet_capture_started", {
    tcpdumpPath: env.TCPDUMP_PATH,
    args,
    pcapPath,
    stdoutPath,
    stderrPath
  });

  return {
    pcapPath,
    stop: async () => {
      if (closed) {
        if (!closePromise) {
          closePromise = closeStreams();
        }
        await closePromise;
        return;
      }

      if (!closePromise) {
        closePromise = new Promise<void>((resolve) => {
          child.once("close", () => resolve());
        });
      }

      try {
        child.kill("SIGTERM");
      } catch (error) {
        logger.warn("packet_capture_stop_failed", { error });
      }

      await closePromise;
    }
  };
};
