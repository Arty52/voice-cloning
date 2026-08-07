FROM node:24.15-alpine

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

EXPOSE 4340

CMD ["npm", "run", "dev"]
