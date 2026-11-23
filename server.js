// Load local settings before storage, server and Discord initialization.
// Existing environment variables take precedence over the file.
try {
  process.loadEnvFile(process.env.DOTENV_CONFIG_PATH || require("path").join(__dirname, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const { startApplication } = require("./server/app");

startApplication({ rootDir: __dirname });
