const express = require('express');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'your-webhook-secret-change-this';

app.use(express.json());

// Verify GitHub webhook signature
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

app.post('/webhook', (req, res) => {
  // Verify signature
  if (!verifySignature(req)) {
    console.log('Invalid signature');
    return res.status(401).send('Invalid signature');
  }

  const event = req.headers['x-github-event'];

  // Only deploy on push events to main branch
  if (event === 'push' && req.body.ref === 'refs/heads/main') {
    console.log('Received push to main branch, deploying...');

    // Run deployment script
    exec('cd /var/www/rt-backend && ./deploy.sh', (error, stdout, stderr) => {
      if (error) {
        console.error(`Deployment error: ${error}`);
        return;
      }
      console.log(`Deployment output: ${stdout}`);
      if (stderr) console.error(`Deployment stderr: ${stderr}`);
    });

    res.status(200).send('Deployment triggered');
  } else {
    res.status(200).send('No deployment needed');
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('Webhook server is running');
});

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
