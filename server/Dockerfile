FROM node:22-alpine

WORKDIR /app
COPY server/mongo-api/package.json server/mongo-api/package-lock.json ./server/mongo-api/
RUN npm ci --omit=dev --prefix ./server/mongo-api
COPY server/mongo-api/server.js ./server/mongo-api/server.js
COPY assets ./assets
COPY ["unblocked zone.html", "./unblocked zone.html"]

WORKDIR /app/server/mongo-api
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "start"]
