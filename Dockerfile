# ---------- Stage 1: cloudflared ----------
FROM ghcr.io/cloudflare/cloudflared:latest AS cloudflared

# ---------- Stage 2: main image ----------
FROM node:20-slim

WORKDIR /app

# 复制 cloudflared 到镜像
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared

# 下载并固定 Xray（二进制在构建期完成）
RUN apt-get update && apt-get install -y curl unzip && \
    mkdir -p /usr/local/bin/xray && \
    curl -L -o /tmp/xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    unzip /tmp/xray.zip -d /usr/local/bin/xray && \
    chmod +x /usr/local/bin/xray/xray && \
    rm -rf /tmp/xray.zip && \
    apt-get clean

# 复制 Node 项目
COPY package*.json ./
RUN npm install --production
COPY index.js ./

EXPOSE 8001

CMD ["node", "index.js"]
