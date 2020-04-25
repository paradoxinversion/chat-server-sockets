const path = require("path");

module.exports = (() => {
  let config = {};

  /**
   * Returns Node's current environment variable.
   * @returns {string} Node's environment variable
   */
  const getEnv = () => {
    return process.env.NODE_ENV;
  };

  /**
   * Creates a configuration object
   * @returns {Object} An object with app configuration
   */
  const makeConfig = () => {
    if (getEnv() === "development") {
      require("dotenv").config();
    } else if (getEnv() === "production") {
      require("dotenv").config({
        path: path.resolve(process.cwd(), ".env.production"),
      });
    }

    config = {
      server: {
        port: process.env.SERVER_PORT,
        cookieName: process.env.COOKIE_NAME,
        allowedOrigins: process.env.ALLOWED_ORIGINS,
        socketPath: process.env.SOCKETIO_PATH,
      },
      admin: {
        username: process.env.DEFAULT_ADMIN_USERNAME,
        password: process.env.DEFAULT_ADMIN_PASSWORD,
      },
    };
    return config;
  };

  const getConfig = () => {
    return config;
  };

  makeConfig();
  return {
    getEnv,
    getConfig,
  };
})();
