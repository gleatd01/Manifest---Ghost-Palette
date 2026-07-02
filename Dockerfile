# Stage 1: Build the Svelte Frontend
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Catch the argument passed from GitHub and expose it as an environment variable for Vite
ARG GITHUB_REF_NAME=local-dev
ENV GITHUB_REF_NAME=$GITHUB_REF_NAME

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
