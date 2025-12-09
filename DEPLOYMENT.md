# RT Backend - VPS Deployment Guide

This guide will help you deploy the RT Backend application to your VPS server.

## Prerequisites

Before deploying, ensure your VPS has the following installed:

1. **Node.js** (v16 or higher)
2. **npm** (comes with Node.js)
3. **PM2** (process manager)
4. **Git**
5. **MongoDB** (or access to a MongoDB instance)

## Initial VPS Setup

### 1. Install Node.js and npm

```bash
# Update package list
sudo apt update

# Install Node.js (using NodeSource repository)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Install PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify installation
pm2 --version
```

### 3. Install MongoDB (if not already installed)

```bash
# Import MongoDB public key
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -

# Create list file for MongoDB
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Update packages
sudo apt update

# Install MongoDB
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### 4. Install Git

```bash
sudo apt install git
```

## First Time Deployment

### 1. Clone the Repository

```bash
# Navigate to your desired directory
cd /var/www  # or your preferred location

# Clone the repository
git clone <your-repository-url> rt-backend
cd rt-backend
```

### 2. Set Up Environment Variables

```bash
# Create .env file
nano .env
```

Add your environment variables:

```env
DATABASE_URL=mongodb://localhost:27017/rt-database
SECRET=your-secret-key-here
```

Save and exit (CTRL+X, then Y, then Enter).

### 3. Install Dependencies

```bash
npm install
```

### 4. Build the Application

```bash
npm run build
```

### 5. Create Logs Directory

```bash
mkdir -p logs
```

### 6. Start the Application with PM2

```bash
# Start the application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Set PM2 to start on system boot
pm2 startup
# Follow the instructions shown in the output
```

### 7. Configure Firewall (if applicable)

```bash
# Allow port 3000 (or your configured port)
sudo ufw allow 3000/tcp

# If you're using nginx as reverse proxy
sudo ufw allow 'Nginx Full'
```

## Subsequent Deployments

After the initial setup, you can use the deployment script for updates:

```bash
# Navigate to project directory
cd /var/www/rt-backend

# Make deploy script executable (first time only)
chmod +x deploy.sh

# Run deployment script
./deploy.sh
```

Or manually:

```bash
# Pull latest changes
git pull origin main

# Install dependencies
npm install

# Build
npm run build

# Restart PM2
pm2 restart ecosystem.config.js --env production
```

## PM2 Commands

Useful PM2 commands for managing your application:

```bash
# View application status
pm2 status

# View logs
pm2 logs rt-backend

# View logs in real-time
pm2 logs rt-backend --lines 100

# Stop application
pm2 stop rt-backend

# Restart application
pm2 restart rt-backend

# Delete application from PM2
pm2 delete rt-backend

# Monitor resources
pm2 monit
```

## Setting Up Nginx Reverse Proxy (Optional but Recommended)

### 1. Install Nginx

```bash
sudo apt install nginx
```

### 2. Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/rt-backend
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain or VPS IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Serve static files
    location /uploads {
        alias /var/www/rt-backend/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3. Enable the Site

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/rt-backend /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 4. SSL Certificate (Optional - with Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

## Environment Variables

Make sure these environment variables are set in your `.env` file:

- `DATABASE_URL` - MongoDB connection string
- `SECRET` - JWT secret key for authentication

## Troubleshooting

### Application won't start

1. Check logs: `pm2 logs rt-backend`
2. Verify MongoDB is running: `sudo systemctl status mongod`
3. Check environment variables: `cat .env`
4. Verify build directory exists: `ls -la dist/`

### Port already in use

```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>
```

### MongoDB connection issues

```bash
# Check MongoDB status
sudo systemctl status mongod

# Restart MongoDB
sudo systemctl restart mongod

# Check MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log
```

### Permission issues

```bash
# Fix ownership of project directory
sudo chown -R $USER:$USER /var/www/rt-backend

# Fix uploads directory permissions
chmod -R 755 uploads/
```

## Monitoring and Maintenance

### View Application Logs

```bash
pm2 logs rt-backend
```

### Monitor System Resources

```bash
pm2 monit
```

### Database Backup

```bash
# Create backup
mongodump --db rt-database --out /backup/mongodb/$(date +%Y%m%d)

# Restore backup
mongorestore --db rt-database /backup/mongodb/20231201/rt-database
```

## Update Checklist

Before each deployment:

- [ ] Test changes locally
- [ ] Commit and push to repository
- [ ] SSH into VPS
- [ ] Navigate to project directory
- [ ] Run deployment script or manual deployment steps
- [ ] Verify application is running: `pm2 status`
- [ ] Check logs for errors: `pm2 logs rt-backend`
- [ ] Test API endpoints

## Support

If you encounter issues during deployment, check:
1. PM2 logs: `pm2 logs rt-backend`
2. Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. MongoDB logs: `sudo tail -f /var/log/mongodb/mongod.log`
