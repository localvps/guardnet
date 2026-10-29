// GuardNet - production process definitions
// Secrets are read from files, never inlined here.
module.exports = {
  apps: [
    {
      name: 'guardnet',
      script: 'src/index.js',
      cwd: process.env.GUARDNET_CWD || '/home/guardnet/backend',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        // WebRTC: 100% self-hosted coturn on this host. No Google/Cloudflare STUN,
        // no public TURN - the app keeps working on a fully national network.
        WEBRTC_STUN_URLS: process.env.WEBRTC_STUN_URLS || 'stun:xxxxxx:3478',
        WEBRTC_TURN_URLS: process.env.WEBRTC_TURN_URLS || 'turn:xxxxxx:3478?transport=udp,turn:xxxxxx:3478?transport=tcp,turns:xxxxxx:5349?transport=tcp',
        WEBRTC_TURN_USER: 'guardnet',
        WEBRTC_TURN_SECRET_FILE: process.env.WEBRTC_TURN_SECRET_FILE || '/root/.turn-secret',
        WEBRTC_TURN_TTL: '3600',
        WEBRTC_FORCE_TURN: '1',
      },
    },
  ],
};