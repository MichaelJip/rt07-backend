module.exports = {
  apps: [
    {
      name: "rt-backend",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      autorestart: true,
      max_memory_restart: "1G",
      watch: false,
    },
    {
      name: "webhook-server",
      script: "./webhook-server.js",
      instances: 1,
      env: {
        NODE_ENV: "production",
        WEBHOOK_SECRET: "your-webhook-secret-change-this",
      },
      error_file: "./logs/webhook-err.log",
      out_file: "./logs/webhook-out.log",
      time: true,
      autorestart: true,
      watch: false,
    },
  ],
};
