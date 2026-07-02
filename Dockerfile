# Stage 1: Build the Svelte Frontend
FROM node:18-alpine AS build
WORKDIR /app

# 1. Place the ARG and ENV at the top of the stage so Vite has access to it immediately
ARG GITHUB_REF_NAME=local-dev
ENV GITHUB_REF_NAME=$GITHUB_REF_NAME

# 2. Run your dependency setup and copies
COPY package*.json ./
RUN npm install
COPY . .

# 3. Compile the frontend with the variables baked in
RUN npm run build 

# Stage 2: Run the Production Server
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production 
COPY server.js .
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.js"]
