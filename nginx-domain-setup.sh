#!/bin/bash

# RT Backend - Nginx and Domain Setup Script
# Run this script after you've pointed your domain to your VPS IP

set -e

# Get domain from user
read -p "Enter your domain name (e.g., api.example.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Domain name is required!"
    exit 1
fi

echo "======================================"
echo "Setting up Nginx for: $DOMAIN"
echo "======================================"
echo ""

# Install Nginx
echo "📦 Installing Nginx..."
sudo apt update
sudo apt install -y nginx

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Create Nginx configuration
echo ""
echo "⚙️  Creating Nginx configuration..."
sudo tee /etc/nginx/sites-available/rt-backend > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Serve static files (uploads)
    location /uploads {
        alias /var/www/rt-backend/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable the site
echo ""
echo "🔗 Enabling site configuration..."
sudo ln -sf /etc/nginx/sites-available/rt-backend /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
echo ""
echo "🔍 Testing Nginx configuration..."
sudo nginx -t

# Reload Nginx
echo ""
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

# Configure firewall
echo ""
echo "🔒 Configuring firewall..."
sudo ufw allow 'Nginx Full'

# Install Certbot for SSL
echo ""
echo "📦 Installing Certbot (for SSL certificate)..."
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
echo ""
echo "🔐 Obtaining SSL certificate..."
echo "⚠️  Make sure your domain DNS is pointing to this server IP: $(hostname -I | awk '{print $1}')"
echo ""
read -p "Press Enter to continue with SSL setup (or Ctrl+C to cancel)..."

sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email || {
    echo ""
    echo "⚠️  SSL certificate installation failed. This is normal if:"
    echo "   - Your domain DNS hasn't propagated yet (can take up to 48 hours)"
    echo "   - Your domain isn't pointing to this server"
    echo ""
    echo "You can run the SSL setup manually later with:"
    echo "   sudo certbot --nginx -d $DOMAIN"
    echo ""
}

# Setup auto-renewal
echo ""
echo "⚙️  Setting up SSL certificate auto-renewal..."
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

echo ""
echo "======================================"
echo "✅ Nginx Setup Complete!"
echo "======================================"
echo ""
echo "Your application should now be accessible at:"
echo "  http://$DOMAIN"
if sudo certbot certificates 2>/dev/null | grep -q "Certificate Name: $DOMAIN"; then
    echo "  https://$DOMAIN (SSL enabled)"
fi
echo ""
echo "To check Nginx status: sudo systemctl status nginx"
echo "To view Nginx logs: sudo tail -f /var/log/nginx/error.log"
echo "To renew SSL manually: sudo certbot renew"
echo ""
