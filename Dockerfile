# Lean OS: imagen para Fly.io (multi-etapa).

# Etapa 1: compila el cliente (dist/) con todas las dependencias.
FROM node:22-slim AS construccion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json build.ts ./
COPY src ./src
RUN npm run build

# Etapa 2: imagen final, solo dependencias de producción.
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/servidor ./src/servidor
COPY src/compartido ./src/compartido
COPY src/cliente/sw-logica.ts ./src/cliente/sw-logica.ts
COPY scripts ./scripts
COPY --from=construccion /app/dist ./dist
# /data es el volumen con la base SQLite y los respaldos. El arranque corrige su dueño (Fly lo monta como root)
# y baja al usuario sin privilegios "node" antes de ejecutar la app (ver scripts/entrada.sh).
RUN mkdir -p /data && chown -R node:node /data /app && chmod +x scripts/entrada.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(async r=>{process.exit(r.ok&&(await r.text())==='ok'?0:1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/scripts/entrada.sh"]
CMD ["node", "src/servidor/main.ts"]
