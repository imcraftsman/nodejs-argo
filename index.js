const fs = require("fs");
const express = require("express");
const { spawn } = require("child_process");
const os = require("os");

const app = express();

const VERSION = "v2.1";

/* ==============================
   环境变量
============================== */

const PORT = process.env.PORT || 8000;

const UUID = process.env.UUID || "auto-uuid-not-set";

const DOMAIN = process.env.ARGO_DOMAIN;
const ARGO_AUTH = process.env.ARGO_AUTH;

const WS_PATH = process.env.WS_PATH || "/vless-argo";

const SUB_ENABLE =
  process.env.SUB_ENABLE === "false"
    ? false
    : true;

/* ==============================
   校验
============================== */

if (!DOMAIN || !ARGO_AUTH) {
  console.error("ARGO_DOMAIN or ARGO_AUTH not set");
  process.exit(1);
}

/* ==============================
   二进制路径
============================== */

const XRAY_PATH = "/usr/local/bin/xray/xray";
const CLOUDFLARED_PATH = "/usr/local/bin/cloudflared";

/* ==============================
   检查文件
============================== */

function ensureBinary(path, name) {

  if (!fs.existsSync(path)) {

    console.error(`${name} not found at ${path}`);

    process.exit(1);

  }

  console.log(`[OK] ${name} found`);

}

/* ==============================
   生成 Xray 配置
============================== */

function createXrayConfig() {

  const config = {

    log: {
      loglevel: "warning"
    },

    inbounds: [

      {
        port: 8001,

        protocol: "vless",

        settings: {

          clients: [
            {
              id: UUID
            }
          ],

          decryption: "none"
        },

        streamSettings: {

          network: "ws",

          security: "none",

          wsSettings: {

            path: WS_PATH

          }

        }

      }

    ],

    outbounds: [

      {
        protocol: "freedom",
        settings: {}
      }

    ]

  };

  fs.writeFileSync("/tmp/config.json", JSON.stringify(config, null, 2));

  console.log("[INFO] Xray config created");

}

/* ==============================
   启动 Xray
============================== */

function startXray() {

  console.log("[INFO] Starting Xray");

  const xray = spawn(XRAY_PATH, [
    "run",
    "-config",
    "/tmp/config.json"
  ]);

  xray.stdout.on("data", d => {
    console.log("[XRAY]", d.toString());
  });

  xray.stderr.on("data", d => {
    console.error("[XRAY-ERR]", d.toString());
  });

  xray.on("exit", (code, signal) => {

    console.error(`[XRAY] exited code=${code}`);

    setTimeout(startXray, 3000);

  });

}

/* ==============================
   启动 Cloudflare Tunnel
============================== */

function startCloudflared() {

  console.log("[INFO] Starting cloudflared");

  const args = [

    "tunnel",

    "--edge-ip-version",
    "auto",

    "--protocol",
    "http2",

    "--no-autoupdate",

    "run",

    "--token",
    ARGO_AUTH

  ];

  const cf = spawn(CLOUDFLARED_PATH, args);

  cf.stdout.on("data", d => {
    console.log("[CLOUDFLARED]", d.toString());
  });

  cf.stderr.on("data", d => {
    console.error("[CLOUDFLARED-ERR]", d.toString());
  });

  cf.on("exit", (code, signal) => {

    console.error(`[CLOUDFLARED] exited code=${code}`);

    setTimeout(startCloudflared, 5000);

  });

}

/* ==============================
   系统信息
============================== */

app.get("/metrics", (req, res) => {

  const memory = process.memoryUsage();

  res.json({

    version: VERSION,

    uptime: process.uptime(),

    memory_mb: {
      rss: (memory.rss / 1024 / 1024).toFixed(2),
      heap: (memory.heapUsed / 1024 / 1024).toFixed(2)
    },

    load: os.loadavg()

  });

});

/* ==============================
   健康检测
============================== */

app.get("/test", (req, res) => {

  res.send(`ok (${VERSION})`);

});

app.get("/health", (req, res) => {

  res.send(`running (${VERSION})`);

});

/* ==============================
   订阅
============================== */

if (SUB_ENABLE) {

  app.get("/sub", (req, res) => {

    const link =
`vless://${UUID}@${DOMAIN}:443?type=ws&security=tls&host=${DOMAIN}&path=${encodeURIComponent(WS_PATH)}#Argo`;

    res.send(Buffer.from(link).toString("base64"));

  });

}

/* ==============================
   启动 HTTP API
============================== */

app.listen(PORT, () => {

  console.log(`API server running on ${PORT}`);

  ensureBinary(XRAY_PATH, "Xray");

  ensureBinary(CLOUDFLARED_PATH, "cloudflared");

  createXrayConfig();

  startXray();

  startCloudflared();

});
