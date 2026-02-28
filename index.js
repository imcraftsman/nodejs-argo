const express = require("express");
const app = express();
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const FILE_PATH = ".tmp";
const PORT = process.env.PORT || 8001;
const UUID = process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913";
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const ARGO_AUTH = process.env.ARGO_AUTH || "";
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";

const CFIP = process.env.CFIP || ARGO_DOMAIN;
const CFPORT = 443;

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
}

const XRAY_PATH = path.join(FILE_PATH, "xray");
const CONFIG_PATH = path.join(FILE_PATH, "config.json");

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

function getArch() {
  return os.arch().includes("arm") ? "arm64" : "amd64";
}

async function downloadXray() {
  const arch = getArch();
  const url =
    arch === "arm64"
      ? "https://arm64.ssss.nyc.mn/web"
      : "https://amd64.ssss.nyc.mn/web";

  log("Downloading Xray from: " + url);

  const response = await axios({
    method: "get",
    url,
    responseType: "stream",
  });

  const writer = fs.createWriteStream(XRAY_PATH);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => {
      fs.chmodSync(XRAY_PATH, 0o755);
      const size = fs.statSync(XRAY_PATH).size;
      log("Xray downloaded. Size: " + size);
      resolve();
    });
    writer.on("error", reject);
  });
}

function generateConfig() {
  const config = {
    log: {
      loglevel: "debug"
    },
    inbounds: [
      {
        port: ARGO_PORT,
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }],
          decryption: "none"
        },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: {
            path: "/vless-argo"
          }
        }
      }
    ],
    outbounds: [
      {
        protocol: "freedom"
      }
    ]
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  log("Config generated:");
  console.log(JSON.stringify(config, null, 2));
}

function startXray() {
  log("Starting Xray...");

  const child = exec(`${XRAY_PATH} -c ${CONFIG_PATH}`);

  child.stdout.on("data", (data) => {
    console.log("[XRAY STDOUT]", data.toString());
  });

  child.stderr.on("data", (data) => {
    console.log("[XRAY STDERR]", data.toString());
  });

  child.on("exit", (code) => {
    console.log("[XRAY EXIT]", code);
  });
}

function startCloudflare() {
  if (!ARGO_AUTH) {
    log("No ARGO_AUTH provided, skipping tunnel.");
    return;
  }

  log("Starting Cloudflare Tunnel...");

  exec(
    `cloudflared tunnel --edge-ip-version auto --protocol http2 run --token ${ARGO_AUTH}`,
    (err, stdout, stderr) => {
      if (err) console.error(err);
      console.log(stdout);
      console.error(stderr);
    }
  );
}

async function bootstrap() {
  try {
    await downloadXray();
    generateConfig();
    startXray();
    startCloudflare();
  } catch (e) {
    console.error("BOOT ERROR:", e);
  }
}

bootstrap();

app.get("/sub", (req, res) => {
  const node = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${ARGO_DOMAIN}&type=ws&host=${ARGO_DOMAIN}&path=%2Fvless-argo#debug-node`;
  const encoded = Buffer.from(node).toString("base64");
  res.send(encoded);
});

app.get("/test", (req, res) => {
  res.send("OK");
});

app.listen(PORT, () => {
  log("HTTP server running on port " + PORT);
});
