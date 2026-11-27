# Node 26 is the current LTS; pinned to one exact image, Dependabot proposes newer ones
FROM node:26.12.1-alpine3.24

# built from the whole repo (compose: context ./mc-site), so the admin page and the site's styles and
# scripts it uses come along: the API serves the admin page itself, only to the home network and VPN
WORKDIR /app
COPY api/package.json ./
COPY api/src ./src
COPY admin ./admin
COPY site/scripts ./site/scripts
COPY site/styles ./site/styles
COPY site/fonts ./site/fonts
COPY site/images ./site/images

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
