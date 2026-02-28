const fs = require("fs");
const https = require("https");
const express = require("express");
const { spawn } = require("child_process");
const http = require("http");
const httpProxy = require("http-proxy");

const app = express();

/* ===============================
   基础变量
================================ */

const PORT = process.env.PORT || 8001;   // Node
const XRAY_PORT = 3001;                  // Xray 内部端口
const XRAY_PATH = "/tmp/xray";
const CONFIG_PATH = "/tmp/config.json";

const UUID = process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913";
const DOMAIN = process.env.DOMAIN || "example.com";
const XRAY_DOWNLOAD_URL =
  process.env.XRAY_URL || "https://amd64.ssss.nyc.mn/web";

/* ===============================
   下载 Xray
================================ */

function downloadXray(url) {
  return new Promise((resolve, reject) => {
    console.log("[DEBUG] Downloading Xray:", url);

    const file = fs.createWriteStream(XRAY_PATH);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject("Download failed: " + res.statusCode);
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            fs.chmodSync(XRAY_PATH, 0o755);
            console.log(
              "[DEBUG] Xray downloaded. Size:",
              fs.statSync(XRAY_PATH).size
            );
            resolve();
          });
        });
      })
      .on("error", reject);
  });
}

/* ===============================
   生成 Xray 配置
================================ */

function generateConfig() {
  const config = {
    log: { loglevel: "debug" },
    inbounds: [
      {
        port: XRAY_PORT,
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }],
          decryption: "none",
        },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: {
            path: "/vless-argo",
          },
        },
      },
    ],
    outbounds: [{ protocol: "freedom" }],
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log("[DEBUG] Xray config:");
  console.log(JSON.stringify(config, null, 2));
}

/* ===============================
   启动 Xray
================================ */

function startXray() {
  console.log("[DEBUG] Starting Xray...");
  const xray = spawn(XRAY_PATH, ["run", "-config", CONFIG_PATH]);

  xray.stdout.on("data", (data) =>
    console.log("[XRAY]", data.toString())
  );
  xray.stderr.on("data", (data) =>
    console.error("[XRAY-ERR]", data.toString())
  );
  xray.on("close", (code) =>
    console.log("[XRAY EXIT]", code)
  );
}

/* ===============================
   订阅接口
================================ */

app.get("/sub", (req, res) => {
  console.log("[DEBUG] /sub requested");

  const node = `vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&type=ws&host=${DOMAIN}&path=%2Fvless-argo#nf-node`;

  res.send(Buffer.from(node).toString("base64"));
});

/* ===============================
   测试接口
================================ */

app.get("/test", (req, res) => {
  res.send("ok-v1");
});

/* ===============================
   创建 HTTP Server + WS 代理
================================ */

const server = http.createServer(app);

const proxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${XRAY_PORT}`,
  ws: true,
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/vless-argo") {
    console.log("[DEBUG] WS upgrade → proxy to Xray");
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

/* ===============================
   启动流程
================================ */

async function bootstrap() {
  try {
    console.log("[INFO] Booting container...");

    await downloadXray(XRAY_DOWNLOAD_URL);
    generateConfig();
    startXray();

    server.listen(PORT, () => {
      console.log("[DEBUG] HTTP server running on", PORT);
    });
  } catch (err) {
    console.error("[FATAL]", err);
  }
}

bootstrap();
