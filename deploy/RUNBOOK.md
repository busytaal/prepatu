# Deploy — VPS Runbook

## First-time setup

```bash
# 1. On the VPS, create the deploy directory
sudo mkdir -p /opt/prepatu/deploy
sudo chown $USER:$USER /opt/prepatu/deploy

# 2. Copy the compose files
scp deploy/docker-compose.yml user@your-vps:/opt/prepatu/deploy/
scp -r deploy/observability user@your-vps:/opt/prepatu/deploy/

# 3. Create the .env file with secrets (never commit this file)
cat > /opt/prepatu/deploy/.env << 'EOF'
GHCR_IMAGE=ghcr.io/busytaal/prepatu-cloud:latest
POSTGRES_PASSWORD=<strong-random-password>
JWT_SECRET=<64-byte-hex>
PUBLIC_BASE_URL=wss://api.yourdomain.com
METRICS_TOKEN=<random-token>
MASTER_DEEPGRAM_KEY=
MASTER_OPENROUTER_KEY=
MASTER_CARTESIA_KEY=
EOF

# 4. Log in to GHCR so docker can pull the image
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-username> --password-stdin

# 5. Start the stack
cd /opt/prepatu/deploy
docker compose up -d
```

## Starting the observability stack

```bash
cd /opt/prepatu/deploy
docker compose -f docker-compose.yml -f observability/docker-compose.yml up -d
```

Set `GRAFANA_PASSWORD` in your `.env` before starting.

## Accessing Grafana (SSH tunnel)

Grafana is NOT exposed on a public port for security. Use an SSH tunnel:

```bash
# On your local machine:
ssh -L 3000:localhost:3000 user@your-vps -N
# Then open: http://localhost:3000  (admin / <GRAFANA_PASSWORD>)
```

## Adding GitHub Secrets

In your GitHub repo → Settings → Secrets → Actions, add:

| Secret | Value |
|--------|-------|
| `VPS_HOST` | IP or hostname of your VPS |
| `VPS_USER` | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | Contents of the deploy user's private SSH key |

## Generate a deploy SSH key pair

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/prepatu_deploy
# Add the public key to the VPS:
ssh-copy-id -i ~/.ssh/prepatu_deploy.pub user@your-vps
# Paste the private key into GitHub secret VPS_SSH_KEY
```

## Postgres backup (cron)

```bash
# Add to crontab on the VPS:
0 3 * * * docker exec deploy-postgres-1 pg_dump -U prepatu prepatu_cloud | gzip > /opt/prepatu/backups/cloud-$(date +\%F).sql.gz
# Keep 14 days
find /opt/prepatu/backups -name "*.sql.gz" -mtime +14 -delete
```
