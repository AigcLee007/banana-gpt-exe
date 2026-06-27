# Agent Notes

## Server Deployment: m.aittco.com

This project is deployed on the server by pulling the repository and rebuilding a local Docker image.

Important: the Dockerfile is not in the repository root. Use `deploy/Dockerfile`.

### Server Facts

- Project directory: `/opt/banana-gpt-exe`
- Container name: `gpt-image-playground`
- Image tag: `gpt-image-playground:latest`
- Container port: `80`
- Host binding: `127.0.0.1:8080`
- Public domain: `https://m.aittco.com`
- Nginx should proxy the site to `127.0.0.1:8080`

### Update Commands

Run these commands on the server:

```bash
cd /opt/banana-gpt-exe

git pull origin main

docker build -f deploy/Dockerfile -t gpt-image-playground:latest .

docker stop gpt-image-playground
docker rm gpt-image-playground

docker run -d \
  --name gpt-image-playground \
  --restart unless-stopped \
  -p 127.0.0.1:8080:80 \
  -e DEFAULT_API_URL=https://vip.aittco.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  -e API_PROXY_URL=https://vip.aittco.com/v1 \
  gpt-image-playground:latest

docker ps --filter "name=gpt-image-playground"
```

### Verify Logs

```bash
docker logs --tail=100 gpt-image-playground
```

### Common Mistake

Do not run:

```bash
docker build -t gpt-image-playground:latest .
```

That fails because the root directory does not contain `Dockerfile`.

Use this instead:

```bash
docker build -f deploy/Dockerfile -t gpt-image-playground:latest .
```
