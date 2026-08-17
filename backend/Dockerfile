FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /app/data
ENV NODE_ENV=production DATABASE_PATH=/app/data/shadow-rp.sqlite PORT=3001
EXPOSE 3001
CMD ["node", "src/server.js"]
