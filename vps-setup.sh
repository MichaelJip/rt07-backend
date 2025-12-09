#!/bin/bash

# RT Backend - VPS Initial Setup Script
# Run this script on your VPS to install all required dependencies

set -e

echo "======================================"
echo "RT Backend - VPS Setup Script"
echo "======================================"
echo ""

# Update system packages
echo "📦 Updating system packages..."
sudo apt update
sudo apt upgrade -y

# Install Node.js
echo ""
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node.js installation
echo ""
echo "✅ Node.js version:"
node --version
echo "✅ npm version:"
npm --version

# Install PM2
echo ""
echo "📦 Installing PM2 (Process Manager)..."
sudo npm install -g pm2

# Verify PM2 installation
echo ""
echo "✅ PM2 version:"
pm2 --version

# Install Git
echo ""
echo "📦 Installing Git..."
sudo apt install -y git

# Verify Git installation
echo ""
echo "✅ Git version:"
git --version

# Install MongoDB
echo ""
echo "📦 Installing MongoDB..."
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
echo ""
echo "🚀 Starting MongoDB..."
sudo systemctl start mongod
sudo systemctl enable mongod

# Verify MongoDB status
echo ""
echo "✅ MongoDB status:"
sudo systemctl status mongod --no-pager

# Create application directory
echo ""
echo "📁 Creating application directory..."
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www

# Configure firewall
echo ""
echo "🔒 Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
echo "y" | sudo ufw enable

# Setup PM2 to start on boot
echo ""
echo "⚙️  Configuring PM2 to start on system boot..."
pm2 startup | grep -o 'sudo.*' | bash

echo ""
echo "======================================"
echo "✅ VPS Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Clone your repository: cd /var/www && git clone <your-repo-url> rt-backend"
echo "2. Navigate to project: cd rt-backend"
echo "3. Create .env file with your environment variables"
echo "4. Install dependencies: npm install"
echo "5. Build the project: npm run build"
echo "6. Start with PM2: pm2 start ecosystem.config.js --env production"
echo "7. Save PM2 config: pm2 save"
echo ""
echo "Your VPS IP: $(hostname -I | awk '{print $1}')"
echo ""
