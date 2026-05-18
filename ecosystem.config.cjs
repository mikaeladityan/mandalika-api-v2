module.exports = {
    apps: [
        {
            name: "api-erp",
            script: "./dist/src/server.js",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            max_memory_restart: "500M",
            env: {
                NODE_ENV: "production",
            },
        },
        {
            name: "api-erp-worker",
            script: "./dist/src/worker.js",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            max_memory_restart: "500M",
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
