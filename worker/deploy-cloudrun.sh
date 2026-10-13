#!/usr/bin/env bash
# Uso: PROJECT=meu-projeto BUCKET=icomtv-estudio-campanhas ./deploy-cloudrun.sh
set -euo pipefail
REGION=${REGION:-southamerica-east1}
gcloud config set project "$PROJECT"
gcloud run deploy estudio-campanhas --source . --region "$REGION" \
  --memory 4Gi --cpu 2 --timeout 3600 --no-cpu-throttling \
  --min-instances 1 --max-instances 1 \
  --set-env-vars CLAUDE_MODEL=${CLAUDE_MODEL:-claude-opus-5-5} \
  --set-secrets ANTHROPIC_API_KEY=anthropic-key:latest,EQUIPE=estudio-equipe:latest \
  --add-volume name=dados,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount volume=dados,mount-path=/data \
  --allow-unauthenticated
echo "Pronto. O acesso é protegido pelo login da equipe (variável EQUIPE)."
