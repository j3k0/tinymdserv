# Use Node.js LTS (Long Term Support) as base image
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and templates
COPY app.js ./
COPY templates ./templates

# Expose the default ports (80 for HTTP, 443 for HTTPS)
EXPOSE 80 443

# Set default directories
ENV DOCS_DIR=/app/docs
ENV TEMPLATES_DIR=/app/templates

# Create a volume for the docs directory
VOLUME [ "/app/docs", "/app/templates" ]

# Start the server
# Users can override these defaults using docker run command arguments
ENTRYPOINT ["node", "app.js"]
CMD ["--port", "80"] 