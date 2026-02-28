const fs = require("fs");
const express = require("express");
const { spawn } = require("child_process");
const httpProxy = require("http-proxy");

const app = express();
const PORT = 8001;

const UUID = process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913";
const DOMAIN = process.env.ARGO_DOMAIN;
const ARGO_AUTH = process.env.ARGO_AUTH;

if (!DOMAIN || !ARGO_AUTH) {
  console.error("ARGO_DOMAIN or ARGO_AUTH not set");
  process.exit(1);
}

/* ---------------- 检测二进制 ---------------- */

function ensureBinary(path, name) {
  if (!fs.existsSync(path)) {
    console.error(`${name} not found at ${path}`);
    process.exit(1);
  }
  console.log(`[DEBUG] ${name} found`);
}

const XRAY_PATH = "/usr/local/bin/xray/xray";
const CLOUDFLARED_PATH = "/usr/local/bin/cloudflared";

/* ---------------- Xray ---------------- */

function createXrayConfig() {
  const config = {
    log: { loglevel: "warning" },
    inbounds: [
      {
        port: 3001,
        protocol: "vless",
        settings: { clients: [{ id: UUID }], decryption: "none" },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: { path: "/vless-argo" }
        }
      }
    ],
    outbounds: [{ protocol: "freedom" }]
  };

  fs.writeFileSync("/tmp/config.json", JSON.stringify(config, null, 2));
  console.log("[DEBUG] Xray config created");
}

function startXray() {
  console.log("[DEBUG] Starting Xray...");
  const xray = spawn(XRAY_PATH, ["run", "-c", "/tmp/config.json"]);

  xray.stdout.on("data", d => console.log("[XRAY]", d.toString()));
  xray.stderr.on("data", d => console.error("[XRAY-ERR]", d.toString()));
}

/* ---------------- Cloudflared ---------------- */

function startCloudflared() {
  console.log("[DEBUG] Starting cloudflared...");

  const args = [
    "tunnel",
    "--edge-ip-version",
    "auto",
    "--protocol",
    "http2",
    "run",
    "--token",
    ARGO_AUTH
  ];

  const cf = spawn(CLOUDFLARED_PATH, args);

  cf.stdout.on("data", d => console.log("[CLOUDFLARED]", d.toString()));
  cf.stderr.on("data", d => console.error("[CLOUDFLARED-ERR]", d.toString()));
}

/* ---------------- WS Proxy ---------------- */

const proxy = httpProxy.createProxyServer({
  target: "http://127.0.0.1:3001",
  ws: true
});

app.use((req, res, next) => {
  if (req.url === "/vless-argo") proxy.web(req, res);
  else next();
});

app.get("/test", (req, res) => res.send("ok"));
app.get("/", (req, res) => res.send("running"));

app.get("/sub", (req, res) => {
  const link =
    `vless://${UUID}@${DOMAIN}:443?type=ws&security=tls&host=${DOMAIN}&path=%2Fvless-argo#Argo`;
  res.send(Buffer.from(link).toString("base64"));
});

/* ---------------- 启动 ---------------- */

const server = app.listen(PORT, () => {
  console.log(`[DEBUG] HTTP server running on ${PORT}`);

  ensureBinary(XRAY_PATH, "Xray");
  ensureBinary(CLOUDFLARED_PATH, "cloudflared");

  createXrayConfig();
  startXray();
  startCloudflared();
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/vless-argo") proxy.ws(req, socket, head);
});
