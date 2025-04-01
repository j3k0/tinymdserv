# Use Node.js LTS (Long Term Support) as base image
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY app.js app.js

# Expose the default ports (80 for HTTP, 443 for HTTPS)
EXPOSE 80

# Set default document directory
ENV DOCS_DIR=/docs

# Create a volume for the docs directory
VOLUME [ "/docs" ]

# Start the server
# Users can override these defaults using docker run command arguments
ENTRYPOINT ["node", "app.js"]
CMD ["--dir", "/docs", "--port", "80"] 