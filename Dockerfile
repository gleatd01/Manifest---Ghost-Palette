# Stage 1: Build the Svelte Frontend
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# This compiles Svelte to static files in the /dist directory
RUN npm run build 

# Stage 2: Run the Production Server
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
# Only install the backend dependencies
RUN npm install --production 
COPY server.js .
# Bring over the compiled Svelte files from Stage 1
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.js"]