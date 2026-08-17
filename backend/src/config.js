import 'dotenv/config';

const requiredInProduction = ['SESSION_SECRET', 'INTERNAL_API_KEY', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
if (process.env.NODE_ENV === 'production') {
  for (const name of requiredInProduction) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  }
}

export const config = {
  port: Number(process.env.PORT || 3001),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  publicApiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3001',
  sessionSecret: process.env.SESSION_SECRET || 'development-only-secret-change-me',
  internalApiKey: process.env.INTERNAL_API_KEY || 'development-internal-key',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  discordCallbackUrl: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3001/auth/discord/callback',
  databasePath: process.env.DATABASE_PATH || './data/shadow-rp.sqlite',
  nodeEnv: process.env.NODE_ENV || 'development',
  devAuth: process.env.DEV_AUTH === 'true'
};
