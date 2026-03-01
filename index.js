const fs = require("fs");
const express = require("express");
const { spawn } = require("child_process");
const httpProxy = require("http-proxy");
const os = require("os");

const app = express();
const PORT = 8001;
const VERSION = "v1.3.0";

const UUID = process.env.UUID || "5336c0bb-c34a-4756-8dea-b6a6ea1bc0da";
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
    log: {
      loglevel: "warning"   // 优化1：关闭 debug
    },
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
          wsSettings: { path: "/vless-argo" }
        }
      }
    ],
    outbounds: [
      {
        protocol: "freedom",
        settings: {},
        streamSettings: {
          sockopt: {
            tcpFastOpen: true,
            tcpNoDelay: true
          }
        }
      }
    ]
  };

  fs.writeFileSync("/tmp/config.json", JSON.stringify(config, null, 2));
  console.log(`[INFO] Xray config created (version ${VERSION})`);
}

function startXray() {
  console.log(`[INFO] Starting Xray (version ${VERSION})...`);
  const xray = spawn(XRAY_PATH, ["run", "-c", "/tmp/config.json"]);

  xray.stdout.on("data", d => console.log("[XRAY]", d.toString()));
  xray.stderr.on("data", d => console.error("[XRAY-ERR]", d.toString()));

  xray.on("exit", (code, signal) => {
    console.error(`[XRAY] exited with code ${code}, signal ${signal}, restarting...`);
    setTimeout(startXray, 2000);
  });
}

/* ---------------- Cloudflared ---------------- */

function startCloudflared() {
  console.log(`[INFO] Starting cloudflared (version ${VERSION})...`);

  const args = [
    "tunnel",
    "--edge-ip-version", "auto",
    "--protocol", "http2",
    "--no-autoupdate",           // 优化3：禁止自动更新
    "run",
    "--token", ARGO_AUTH
  ];

  const cf = spawn(CLOUDFLARED_PATH, args);

  cf.stdout.on("data", d => console.log("[CLOUDFLARED]", d.toString()));
  cf.stderr.on("data", d => console.error("[CLOUDFLARED-ERR]", d.toString()));

  cf.on("exit", (code, signal) => {
    console.error(`[CLOUDFLARED] exited with code ${code}, signal ${signal}, restarting...`);
    setTimeout(startCloudflared, 3000);
  });
}

/* ---------------- WS Proxy ---------------- */

const proxy = httpProxy.createProxyServer({
  target: "http://127.0.0.1:3001",
  ws: true
});

app.use((req, res, next) => {
  if (req.url.startsWith("/vless-argo")) proxy.web(req, res);
  else next();
});

/* ---------------- 性能监控接口 ---------------- */

app.get("/metrics", (req, res) => {
  const memory = process.memoryUsage();
  const cpuLoad = os.loadavg();

  res.json({
    version: VERSION,
    uptime_seconds: process.uptime(),
    memory_mb: {
      rss: (memory.rss / 1024 / 1024).toFixed(2),
      heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2),
      heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2)
    },
    cpu_load_1m: cpuLoad[0],
    cpu_load_5m: cpuLoad[1],
    cpu_load_15m: cpuLoad[2]
  });
});

/* ---------------- HTTP 接口 ---------------- */

app.get("/test", (req, res) => res.send(`ok (version ${VERSION})`));
app.get("/health", (req, res) => res.send(`running (version ${VERSION})`));
app.get("/", (req, res) => res.send(`running (version ${VERSION})`));

app.get("/sub", (req, res) => {
  const link =
    `vless://${UUID}@${DOMAIN}:443?type=ws&security=tls&host=${DOMAIN}&path=%2Fvless-argo#Argo`;
  res.send(Buffer.from(link).toString("base64"));
});

/* ---------------- 启动 ---------------- */

const server = app.listen(PORT, () => {
  console.log(`[INFO] HTTP server running on ${PORT} (version ${VERSION})`);

  ensureBinary(XRAY_PATH, "Xray");
  ensureBinary(CLOUDFLARED_PATH, "cloudflared");

  createXrayConfig();
  startXray();
  startCloudflared();
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/vless-argo")) {
    proxy.ws(req, socket, head);
  }
});
