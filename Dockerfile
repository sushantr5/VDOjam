FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /data \
  && addgroup -S vdojam && adduser -S vdojam -G vdojam \
  && chown -R vdojam:vdojam /data /app

USER vdojam

EXPOSE 3000
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
