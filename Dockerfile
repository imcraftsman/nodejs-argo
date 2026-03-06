FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.js .

# 安装 xray
RUN apk add --no-cache unzip curl

RUN curl -L https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip -o xray.zip \
 && unzip xray.zip \
 && mkdir -p /usr/local/bin/xray \
 && mv xray /usr/local/bin/xray/ \
 && chmod +x /usr/local/bin/xray/xray

# 安装 cloudflared
RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 -o /usr/local/bin/cloudflared \
 && chmod +x /usr/local/bin/cloudflared

EXPOSE 8001

CMD ["node", "index.js"]
