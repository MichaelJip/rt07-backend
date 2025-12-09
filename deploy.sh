#!/bin/bash

# RT Backend Deployment Script
# This script automates the deployment process to your VPS

set -e

echo "🚀 Starting deployment..."

# Pull latest changes
echo "📦 Pulling latest changes from git..."
git pull origin main

# Install dependencies
echo "📚 Installing dependencies..."
npm install --production=false

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Create logs directory if it doesn't exist
mkdir -p logs

# Restart PM2 process
echo "♻️  Restarting PM2 process..."
pm2 restart ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

echo "✅ Deployment completed successfully!"
echo "📊 Check logs with: pm2 logs rt-backend"
