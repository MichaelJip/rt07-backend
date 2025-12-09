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
  ],
};
