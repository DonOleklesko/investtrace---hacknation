FROM node:24-alpine
WORKDIR /app
COPY package.json ./
# SDK Anthropic jest opcjonalny – bez niego działa analiza regułowa
RUN npm install --omit=dev --no-audit --no-fund || true
COPY . .
ENV HOST=0.0.0.0 PORT=3000 INVESTTRACE_DB=/data/investtrace.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
