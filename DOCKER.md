# Docker Setup for Paubox MCP

This document provides instructions for containerizing and running the Paubox MCP application using Docker.

## Prerequisites

- Docker installed on your system
- Docker Compose (usually comes with Docker Desktop)

## Quick Start

### Production Build

1. **Build and run the production container:**
   ```bash
   docker-compose up --build
   ```

2. **Access the application:**
   - Open your browser and navigate to `http://localhost:3000`

### Development Build

1. **Run the development container with hot reloading:**
   ```bash
   docker-compose --profile dev up --build app-dev
   ```

2. **Access the development application:**
   - Open your browser and navigate to `http://localhost:3001`

## Manual Docker Commands

### Production

**Build the image:**
```bash
docker build -t paubox-mcp .
```

**Run the container:**
```bash
docker run -p 3000:3000 paubox-mcp
```

### Development

**Build the development image:**
```bash
docker build -f Dockerfile.dev -t paubox-mcp-dev .
```

**Run the development container:**
```bash
docker run -p 3001:3000 -v $(pwd):/app -v /app/node_modules -v /app/.next paubox-mcp-dev
```

## Docker Compose Services

### Production Service (`app`)
- **Port:** 3000
- **Environment:** Production
- **Features:** Optimized build, health checks, restart policy

### Development Service (`app-dev`)
- **Port:** 3001
- **Environment:** Development
- **Features:** Hot reloading, volume mounts for live code changes

## Health Checks

The application includes a health check endpoint at `/api/health` that returns:
- Application status
- Timestamp
- Uptime information

## Environment Variables

The following environment variables are set in the containers:

- `NODE_ENV`: Set to `production` or `development`
- `NEXT_TELEMETRY_DISABLED`: Set to `1` to disable Next.js telemetry
- `PORT`: Set to `3000`
- `HOSTNAME`: Set to `0.0.0.0` for container networking

## Troubleshooting

### Common Issues

1. **Port already in use:**
   ```bash
   # Check what's using the port
   lsof -i :3000
   # Kill the process or use a different port
   ```

2. **Build fails:**
   ```bash
   # Clean Docker cache
   docker system prune -a
   # Rebuild without cache
   docker-compose build --no-cache
   ```

3. **Permission issues:**
   ```bash
   # Fix file permissions
   sudo chown -R $USER:$USER .
   ```

### Logs

**View application logs:**
```bash
docker-compose logs -f app
```

**View development logs:**
```bash
docker-compose logs -f app-dev
```

## Production Deployment

For production deployment, consider:

1. **Using a reverse proxy (nginx):**
   ```yaml
   # Add to docker-compose.yml
   nginx:
     image: nginx:alpine
     ports:
       - "80:80"
     volumes:
       - ./nginx.conf:/etc/nginx/nginx.conf
     depends_on:
       - app
   ```

2. **Environment-specific configurations:**
   ```bash
   # Create environment-specific compose files
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
   ```

3. **Health monitoring:**
   - The application includes health checks
   - Monitor the `/api/health` endpoint
   - Set up proper logging and monitoring

## Security Considerations

- The production container runs as a non-root user (`nextjs`)
- Health checks are configured for monitoring
- Environment variables are properly isolated
- The `.dockerignore` file excludes sensitive files

## Performance Optimization

- Multi-stage builds reduce final image size
- Standalone output minimizes dependencies
- Alpine Linux base image for smaller footprint
- Proper layer caching for faster rebuilds
