# Node 26 is the current LTS (supported until Oct 2027); Dependabot proposes newer images
FROM node:26-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    PLUGIN_DIR=/plugin

# runs as the image's "node" user (uid 1000), the same uid the itzg Minecraft images use
USER node
EXPOSE 8080
VOLUME ["/data", "/plugin"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "src/server.js"]
