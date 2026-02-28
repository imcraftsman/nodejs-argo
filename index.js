const fs = require("fs");
const https = require("https");
const express = require("express");
const { spawn } = require("child_process");
const httpProxy = require("http-proxy");

const app = express();

const PORT = 8001;
const XRAY_PATH = "/tmp/xray";
const XRAY_CONFIG = "/tmp/config.json";
const CLOUDFLARED_PATH = "/tmp/cloudflared";

const UUID = process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913";
const DOMAIN = process.env.DOMAIN;
const ARGO_AUTH = process.env.ARGO_AUTH;

if (!DOMAIN) {
  console.error("DOMAIN env not set");
  process.exit(1);
}

if (!ARGO_AUTH) {
  console.error("ARGO_AUTH not set");
  process.exit(1);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(`Download failed: ${url}`);
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          fs.chmodSync(dest, 0o755);
          resolve();
        });
      });
    }).on("error", reject);
  });
}

async function downloadXray() {
  console.log("[DEBUG] Downloading Xray...");
  await downloadFile(
    "https://amd64.ssss.nyc.mn/web",
    XRAY_PATH
  );
  console.log("[DEBUG] Xray ready");
}

function createXrayConfig() {
  const config = {
    log: { loglevel: "debug" },
    inbounds: [
      {
        port: 3001,
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

  fs.writeFileSync(XRAY_CONFIG, JSON.stringify(config, null, 2));
}

function startXray() {
  console.log("[DEBUG] Starting Xray...");
  const xray = spawn(XRAY_PATH, ["run", "-c", XRAY_CONFIG]);

  xray.stdout.on("data", (d) =>
    console.log("[XRAY]", d.toString())
  );

  xray.stderr.on("data", (d) =>
    console.error("[XRAY-ERR]", d.toString())
  );
}

async function downloadCloudflared() {
  console.log("[DEBUG] Downloading cloudflared...");
  await downloadFile(
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    CLOUDFLARED_PATH
  );
  console.log("[DEBUG] cloudflared ready");
}

function startCloudflared() {
  console.log("[DEBUG] Starting cloudflared...");
  const cf = spawn(CLOUDFLARED_PATH, [
    "tunnel",
    "--edge-ip-version",
    "auto",
    "--protocol",
    "http2",
    "run",
    "--token",
    ARGO_AUTH
  ]);

  cf.stdout.on("data", (d) =>
    console.log("[CLOUDFLARED]", d.toString())
  );

  cf.stderr.on("data", (d) =>
    console.error("[CLOUDFLARED-ERR]", d.toString())
  );
}

const proxy = httpProxy.createProxyServer({
  target: "http://127.0.0.1:3001",
  ws: true
});

app.use((req, res, next) => {
  if (req.url === "/vless-argo") {
    proxy.web(req, res);
  } else {
    next();
  }
});

app.get("/test", (req, res) => {
  res.send("ok");
});

app.get("/sub", (req, res) => {
  const link =
    `vless://${UUID}@${DOMAIN}:443` +
    `?type=ws&security=tls&host=${DOMAIN}` +
    `&path=%2Fvless-argo#Argo`;

  const base64 = Buffer.from(link).toString("base64");
  res.send(base64);
});

const server = app.listen(PORT, async () => {
  console.log(`[DEBUG] HTTP server running on ${PORT}`);

  await downloadXray();
  createXrayConfig();
  startXray();

  await downloadCloudflared();
  startCloudflared();
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/vless-argo") {
    proxy.ws(req, socket, head);
  }
});
